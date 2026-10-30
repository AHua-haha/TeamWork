import type {RowDataPacket} from 'mysql2/promise';
import type {DataConnection} from '../../data-transaction.js';
import {AppError} from '../../errors.js';

export const schema=[
  `CREATE TABLE IF NOT EXISTS workspace_member_baselines (workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, data JSON NOT NULL) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS workspaces (
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    directory VARCHAR(1024) NOT NULL,
    directory_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    created_at BIGINT NOT NULL
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS workspace_models (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    data JSON NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
];
export const tables=['workspace_member_baselines','workspaces','workspace_models'] as const;

/** Idempotent retirement of obsolete context history. Preserve only member acceptance fallback. */
export async function retireContextHistory(db:DataConnection):Promise<void>{
  const [tables]=await db.query<RowDataPacket[]>('SHOW TABLES');
  if(tables.some(row=>Object.values(row)[0]==='workspace_git_baselines')){
    const [invalid]=await db.query<RowDataPacket[]>(`SELECT workspace_id FROM workspace_git_baselines WHERE
      COALESCE(JSON_EXTRACT(data,'$.version'),0) <> 1 OR COALESCE(JSON_TYPE(JSON_EXTRACT(data,'$.data.members')),'NULL') <> 'OBJECT'`);
    if(invalid.length)throw new AppError('corrupt_data','Cannot retire context baselines with unreadable member acceptance records',500);
    await db.query(`INSERT IGNORE INTO workspace_member_baselines (workspace_id,data)
      SELECT workspace_id,JSON_OBJECT('version',1,'data',JSON_OBJECT('members',JSON_EXTRACT(data,'$.data.members'))) FROM workspace_git_baselines`);
    await db.query('DROP TABLE workspace_git_baselines');
  }
  for(const table of ['context_files','context_versions','context_records','context_blobs']) await db.query(`DROP TABLE IF EXISTS ${table}`);
  const [columns]=await db.query<RowDataPacket[]>('SHOW COLUMNS FROM workspaces');
  if(columns.some(column=>column.Field==='seq')) await db.query('ALTER TABLE workspaces DROP COLUMN seq');
}
