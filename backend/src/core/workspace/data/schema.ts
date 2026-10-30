import type {RowDataPacket} from 'mysql2/promise';
import type {DataConnection} from '../../data-transaction.js';

export const schema=[
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
export const tables=['workspaces','workspace_models'] as const;

/** Remove retired history stores; active member configuration already lives in Team data. */
export async function retireContextHistory(db:DataConnection):Promise<void>{
  for(const table of ['context_files','context_versions','context_records','context_blobs','workspace_git_baselines','workspace_member_baselines']) await db.query(`DROP TABLE IF EXISTS ${table}`);
  const [columns]=await db.query<RowDataPacket[]>('SHOW COLUMNS FROM workspaces');
  if(columns.some(column=>column.Field==='seq')) await db.query('ALTER TABLE workspaces DROP COLUMN seq');
}
