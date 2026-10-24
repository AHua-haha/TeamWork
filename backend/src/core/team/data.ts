import { imageContent, validateChatImages, type PreparedChatImage } from './chat-images.js';
import { interruptedCompactionContext, validateCompactionState, type CompactionState } from '../agent/compaction.js';
import { adoptRecordedContext, type GroupContextMessage } from '../agent/context.js';
import { finalAnswer } from '../agent/final-answer.js';
import { parseMemberResponse } from './member-response.js';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { MySqlStorage } from '../../storage/mysql.js';
import type { UserMessage } from '@earendil-works/pi-ai';
import { decode, encode, validateAuthor, validateChangeRecord, validateEntries, validateRun } from '../codec.js';
import type { Author, ChangeRecord, ContextCommit, ContextStore, FileAction, IndexedFile, StoredVersion, WorkspaceRecord } from '../workspace/context-base.js';
import type { MemberRecord, NewMember, StoredMember, TeamStore, MemberActivation, MemberActivationState } from './team.js';
import { defaultRunSettings, workspaceModels, type WorkspaceModels, type StoredWorkspaceModels } from '../workspace/workspace-models.js';
import type { WorkspaceBootstrap } from '../workspace-bootstrap.js';
import { generatedSource } from './member-config-format.js';
import { AppError, identity, position, type CompletedMessage, type ContextEntry, type ContextHistory, type CurrentState, type FollowSnapshot, type RunState, type RunStatus } from '../agent/types.js';

import { defaultMentionLimit, groupEntry, groupSender, mentionLimit, validateChatMessage, validateTimelineEntry, type ChatPublication, type ChatMessage, type ChatSnapshot, type ChatStore, type StoredChatMessage, type FinalReference, type TimelineEntry, type TimelineSnapshot, type ChatAcceptance, type ChatReset } from './group-chat.js';

type Db = Pool | PoolConnection;
export type ConfigScope = 'app' | 'catalog' | 'connection' | 'model_cache' | 'agent';
export interface StoredConfig<T = unknown> { id: string; revision: number; value: T }
async function rows(db: Db, sql: string, values: (string | number | null)[] = []): Promise<RowDataPacket[]> {
  return (await db.execute<RowDataPacket[]>(sql, values))[0];
}

/** Multi-row insert in batches, as `INSERT ... VALUES ?`. */
async function insertRows(db: Db, sql: string, values: (string | number | null)[][]): Promise<void> {
  for (let start = 0; start < values.length; start += 500) await db.query(sql, [values.slice(start, start + 500)]);
}

/** LIMIT takes a validated literal; prepared LIMIT placeholders are unreliable in mysql2. */
function limitClause(limit: number): string {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new AppError('invalid_input', 'Invalid limit');
  return ` LIMIT ${limit}`;
}

const duplicate = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY';
const workspaceRow = (row: RowDataPacket): WorkspaceRecord => ({ workspaceId: row.id as string, name: row.name as string, directory: row.directory as string, createdAt: Number(row.created_at) });
const memberRow = (row: RowDataPacket): StoredMember => ({ id: row.id as string, workspaceId: row.workspace_id as string, revision: Number(row.revision), value: decode<MemberRecord>(row.data, () => undefined) });
/** A duplicate key on a member row, named by the key that was violated. */
function memberConflict(error: unknown): unknown {
  if (!duplicate(error)) return error;
  const message = String((error as { message?: unknown }).message);
  if (message.includes('members_lead')) return new AppError('lead_exists', 'The workspace already has a lead', 409);
  if (message.includes('members_name')) return new AppError('member_exists', 'Another member of this team has that name', 409);
  return new AppError('conflict', 'Identity already exists', 409);
}
const versionRow = (row: RowDataPacket): StoredVersion => ({
  fileId: row.file_id as string, seq: Number(row.seq), revision: row.revision as string | null, action: row.action as FileAction,
  path: row.path as string, fromPath: row.from_path as string | null, hash: row.hash as string | null, size: row.size === null ? null : Number(row.size),
  time: Number(row.time), author: decode<Author>(row.author, validateAuthor), reason: row.reason as string | null,
});

const schema = [
  `CREATE TABLE IF NOT EXISTS workspace_git_baselines (workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, data JSON NOT NULL) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS agents (
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    context_format TINYINT UNSIGNED NOT NULL DEFAULT 1,
    context JSON NOT NULL, context_revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    history_position BIGINT UNSIGNED NOT NULL DEFAULT 0,
    active_run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    latest_run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS runs (
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    agent_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    state JSON NOT NULL, FOREIGN KEY (agent_id) REFERENCES agents(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS messages (
    agent_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    position BIGINT UNSIGNED NOT NULL,
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    entry JSON NOT NULL, PRIMARY KEY(agent_id, position), UNIQUE KEY(agent_id, id),
    FOREIGN KEY (agent_id) REFERENCES agents(id), FOREIGN KEY (run_id) REFERENCES runs(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS context_compactions (
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    agent_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    active_agent_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL UNIQUE,
    history_after BIGINT UNSIGNED NOT NULL, state JSON NOT NULL,
    FOREIGN KEY(agent_id) REFERENCES agents(id), FOREIGN KEY(run_id) REFERENCES runs(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS config_records (
    scope VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    data JSON NOT NULL,
    PRIMARY KEY(scope, id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS workspaces (
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    directory VARCHAR(1024) NOT NULL,
    directory_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS chat_images (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    metadata JSON NOT NULL, content MEDIUMBLOB NOT NULL,
    PRIMARY KEY(workspace_id, id), FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS workspace_models (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    data JSON NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS context_blobs (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    content MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    size INT UNSIGNED NOT NULL,
    PRIMARY KEY(workspace_id, hash),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS context_versions (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    file_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    seq BIGINT UNSIGNED NOT NULL,
    revision CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    action VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    path VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    path_key VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    from_path VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NULL,
    hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    size INT UNSIGNED NULL,
    time BIGINT NOT NULL,
    author JSON NOT NULL,
    reason TEXT NULL,
    PRIMARY KEY(workspace_id, file_id, seq),
    UNIQUE KEY(workspace_id, revision),
    KEY(workspace_id, path_key, seq),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS context_files (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    path_key VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    path VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    file_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    size INT UNSIGNED NOT NULL,
    mtime_ms DOUBLE NOT NULL,
    PRIMARY KEY(workspace_id, path_key),
    UNIQUE KEY(workspace_id, file_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS context_records (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    seq BIGINT UNSIGNED NOT NULL,
    data JSON NOT NULL,
    PRIMARY KEY(workspace_id, seq),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS members (
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    is_lead TINYINT NULL,
    name_key VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
    ordinal BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
    data JSON NOT NULL,
    UNIQUE KEY members_order (ordinal),
    UNIQUE KEY members_lead (workspace_id, is_lead),
    UNIQUE KEY members_name (workspace_id, name_key),
    FOREIGN KEY (id) REFERENCES agents(id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS member_activation (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    revision VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    time BIGINT UNSIGNED NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS chat_settings (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    position BIGINT UNSIGNED NOT NULL DEFAULT 0, mention_limit INT UNSIGNED NOT NULL DEFAULT 32,
    reset_cursor BIGINT UNSIGNED NOT NULL DEFAULT 0, reset_position BIGINT UNSIGNED NOT NULL DEFAULT 0,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS chat_exchanges (
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    mention_limit INT UNSIGNED NOT NULL, used INT UNSIGNED NOT NULL DEFAULT 0,
    stopped TINYINT NOT NULL DEFAULT 0,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    position BIGINT UNSIGNED NOT NULL, entry JSON NOT NULL,
    PRIMARY KEY (workspace_id, position),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS chat_runs (
    run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    exchange_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    FOREIGN KEY (run_id) REFERENCES runs(id), FOREIGN KEY (exchange_id) REFERENCES chat_exchanges(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS chat_clock (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    position BIGINT UNSIGNED NOT NULL DEFAULT 0, seq BIGINT UNSIGNED NOT NULL DEFAULT 0,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS chat_entries (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    position BIGINT UNSIGNED NOT NULL, run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    data JSON NOT NULL, PRIMARY KEY(workspace_id, id), UNIQUE KEY(workspace_id, position), UNIQUE KEY(run_id),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id), FOREIGN KEY (run_id) REFERENCES runs(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS chat_changes (
    workspace_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    seq BIGINT UNSIGNED NOT NULL, data JSON NOT NULL, PRIMARY KEY(workspace_id, seq),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
  ) ENGINE=InnoDB`,

];

/** All writers lock the agent row first. Follow reads use a repeatable-read snapshot. */
const tables = ['context_compactions', 'chat_changes', 'chat_entries', 'chat_clock', 'chat_runs', 'chat_messages', 'chat_images', 'chat_exchanges', 'chat_settings', 'messages', 'runs', 'members', 'workspace_git_baselines', 'member_activation', 'context_files', 'context_versions', 'context_blobs', 'context_records', 'workspace_models', 'workspaces', 'agents'];

export class TeamData implements ContextStore, TeamStore, ChatStore {
  readonly pool: Pool;
  private lease?: PoolConnection;
  private leaseError?: Error;
  private leaseListener?: (error: Error) => void;
  private readonly lockName: string;

  constructor(readonly storage: MySqlStorage) {
    this.pool = storage.pool;
    this.lockName = `rsi:${createHash('sha256').update('/' + storage.database).digest('hex').slice(0, 56)}`;
  }

  /** Explicit administrative reset. Caller owns its transaction and filesystem recovery. */
  async resetRuntimeRecords(db: PoolConnection): Promise<void> {
    const [existing] = await db.query('SHOW TABLES');
    const available = new Set((existing as Record<string, string>[]).flatMap(row => Object.values(row)));
    for (const table of tables.filter(table => available.has(table))) await db.query(`DELETE FROM ${table}`);
    await db.execute("DELETE FROM config_records WHERE scope = 'agent'");
  }

  async migrate(): Promise<void> {
    for (const statement of schema) await this.pool.query(statement);
    // Add the reset boundary to existing prototype databases as well as fresh schemas.
    const columns = await rows(this.pool, 'SHOW COLUMNS FROM chat_settings');
    for (const column of ['reset_cursor', 'reset_position']) {
      if (!columns.some(row => row.Field === column)) await this.pool.query(`ALTER TABLE chat_settings ADD COLUMN ${column} BIGINT UNSIGNED NOT NULL DEFAULT 0`);
    }
    // Retired transient storage. Completed messages, context and run state are preserved.
    await this.pool.query('DROP TABLE IF EXISTS chunks');
    await this.pool.query('DROP TABLE IF EXISTS live_messages');
    await this.importChatHistory();
    const agentColumns = await rows(this.pool, 'SHOW COLUMNS FROM agents');
    if (!agentColumns.some(row => row.Field === 'context_format')) {
      await this.pool.query('ALTER TABLE agents ADD COLUMN context_format TINYINT UNSIGNED NOT NULL DEFAULT 0');
    }
    if (String(agentColumns.find(row => row.Field === 'context_format')?.Default) !== '1') {
      await this.pool.query('ALTER TABLE agents ALTER COLUMN context_format SET DEFAULT 1');
    }
    // Transition recorded legacy member data once; Agent defines context incorporation, not SQL policy.
    const legacy = await rows(this.pool, 'SELECT a.id, m.workspace_id FROM agents a JOIN members m ON m.id = a.id WHERE a.context_format = 0');
    for (const member of legacy) await this.transaction(async db => {
      const agent = await this.agent(db, member.id, true);
      if (agent.context_format !== 0) return;
      const records = await rows(db, 'SELECT entry FROM messages WHERE agent_id = ? ORDER BY position', [member.id]);
      const recorded = records.map(row => decode<ContextEntry>(row.entry, value => validateEntries([value])));
      const groups = await this.groupContext(db, member.workspace_id, 0);
      const entries = adoptRecordedContext(member.id, member.workspace_id, decode<ContextEntry[]>(agent.context, validateEntries), recorded, groups);
      await db.execute('UPDATE agents SET context = ?, context_revision = context_revision + 1, context_format = 1 WHERE id = ?', [encode(entries), member.id]);
    });
    await this.pool.query('UPDATE agents SET context_format = 1 WHERE context_format = 0');
    await this.pool.query('DROP TABLE IF EXISTS member_context_runs');
    await this.pool.query('DROP TABLE IF EXISTS member_contexts');
    await this.pool.query('DROP TABLE IF EXISTS chat_delivery');
  }

  async acquireRuntime(onLost: (error: Error) => void): Promise<void> {
    if (this.lease) throw new AppError('runtime_conflict', 'This store already has a runtime owner', 409);
    const connection = await this.pool.getConnection();
    try {
      const [result] = await rows(connection, 'SELECT GET_LOCK(?, 0) AS acquired', [this.lockName]);
      if (result?.acquired !== 1) throw new AppError('runtime_conflict', 'Another runtime owns this database', 409);
      this.lease = connection;
      this.leaseError = undefined;
      this.leaseListener = (error: Error) => {
        this.leaseError = error;
        onLost(error);
      };
      connection.on('error', this.leaseListener);
    } catch (error) {
      connection.release();
      throw error;
    }
  }

  assertRuntime(): void {
    if (!this.lease || this.leaseError) throw new AppError('runtime_unavailable', 'Runtime database ownership is unavailable', 503);
  }

  async releaseRuntime(): Promise<void> {
    const lease = this.lease;
    this.lease = undefined;
    if (lease) {
      try { if (!this.leaseError) await lease.execute('SELECT RELEASE_LOCK(?)', [this.lockName]); }
      finally {
        if (this.leaseListener) lease.removeListener('error', this.leaseListener);
        this.leaseListener = undefined;
        lease.release();
      }
    }
  }

  async close(): Promise<void> {
    try { await this.releaseRuntime(); } finally { await this.storage.close(); }
  }

  private async transaction<T>(fn: (connection: PoolConnection) => Promise<T>): Promise<T> {
    try { return await this.storage.transaction(fn); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY') {
        throw new AppError('conflict', 'Identity or position already exists', 409);
      }
      throw error;
    }
  }

  private async agent(db: Db, agentId: string, lock = false): Promise<RowDataPacket> {
    identity(agentId, 'agentId');
    const [agent] = await rows(db, `SELECT * FROM agents WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [agentId]);
    if (!agent) throw new AppError('not_found', 'Agent not found', 404);
    return agent;
  }

  private async run(db: Db, agentId: string, runId: string): Promise<RunState> {
    identity(runId, 'runId');
    const [row] = await rows(db, 'SELECT state FROM runs WHERE id = ? AND agent_id = ?', [runId, agentId]);
    if (!row) throw new AppError('not_found', 'Run not found for this agent', 404);
    return decode<RunState>(row.state, validateRun);
  }

  private async active(db: Db, agent: RowDataPacket, runId: string): Promise<RunState> {
    if (agent.active_run_id !== runId) throw new AppError('run_conflict', 'Run is no longer active', 409);
    return this.run(db, agent.id, runId);
  }

  private async saveRun(db: Db, run: RunState): Promise<void> {
    validateRun(run);
    await db.execute('UPDATE runs SET state = ? WHERE id = ?', [encode(run), run.runId]);
  }

  async createAgent(agentId: string = randomUUID(), entries: ContextEntry[] = []): Promise<CurrentState> {
    identity(agentId, 'agentId');
    validateEntries(entries);
    await this.transaction(async db => {
      await db.execute('INSERT INTO agents (id, context) VALUES (?, ?)', [agentId, encode(entries)]);
      await db.execute('INSERT INTO config_records (scope, id, data) VALUES (?, ?, ?)', ['agent', agentId, encode({})]);
    });
    return this.getState(agentId);
  }

  async listAgents(): Promise<string[]> {
    const result = await rows(this.pool, 'SELECT id FROM agents WHERE id NOT IN (SELECT id FROM members) ORDER BY id');
    return result.map(row => row.id as string);
  }

  private configRow<T>(row: RowDataPacket): StoredConfig<T> {
    return { id: row.id as string, revision: row.revision as number, value: decode<T>(row.data, () => undefined) };
  }

  async getConfig<T>(scope: ConfigScope, id: string): Promise<StoredConfig<T>> {
    identity(id, 'config id');
    const [row] = await rows(this.pool, 'SELECT id, revision, data FROM config_records WHERE scope = ? AND id = ?', [scope, id]);
    if (!row) throw new AppError('not_found', 'Config record not found', 404);
    return this.configRow<T>(row);
  }

  async listConfigs<T>(scope: ConfigScope): Promise<StoredConfig<T>[]> {
    const result = await rows(this.pool, 'SELECT id, revision, data FROM config_records WHERE scope = ? ORDER BY id', [scope]);
    return result.map(row => this.configRow<T>(row));
  }

  async createConfig<T>(scope: ConfigScope, id: string, value: T): Promise<StoredConfig<T>> {
    identity(id, 'config id');
    const data = encode(value);
    try {
      await this.transaction(async db => {
        if (scope === 'agent') {
          await this.agent(db, id);
          // A team member's conversation is not an agent with a config.
          if ((await rows(db, 'SELECT id FROM members WHERE id = ?', [id])).length) throw new AppError('not_found', 'Agent not found', 404);
        }
        await db.execute('INSERT INTO config_records (scope, id, data) VALUES (?, ?, ?)', [scope, id, data]);
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY') throw new AppError('config_conflict', 'Config record already exists', 409);
      throw error;
    }
    return { id, revision: 0, value: decode<T>(data, () => undefined) };
  }

  async updateConfig<T>(scope: ConfigScope, id: string, revision: number, value: T, clearModelCache = false): Promise<StoredConfig<T>> {
    identity(id, 'config id');
    position(revision);
    const data = encode(value);
    await this.transaction(async db => {
      const [result] = await db.execute<ResultSetHeader>('UPDATE config_records SET data = ?, revision = revision + 1 WHERE scope = ? AND id = ? AND revision = ?', [data, scope, id, revision]);
      if (result.affectedRows) {
        if (clearModelCache) await db.execute('DELETE FROM config_records WHERE scope = ? AND id = ?', ['model_cache', id]);
        return;
      }
      const [existing] = await rows(db, 'SELECT id FROM config_records WHERE scope = ? AND id = ?', [scope, id]);
      throw new AppError(existing ? 'config_conflict' : 'not_found', existing ? 'Config revision changed' : 'Config record not found', existing ? 409 : 404);
    });
    return { id, revision: revision + 1, value: decode<T>(data, () => undefined) };
  }

  async deleteConfig(scope: ConfigScope, id: string, revision: number, clearModelCache = false): Promise<void> {
    identity(id, 'config id');
    position(revision);
    await this.transaction(async db => {
      const [result] = await db.execute<ResultSetHeader>('DELETE FROM config_records WHERE scope = ? AND id = ? AND revision = ?', [scope, id, revision]);
      if (result.affectedRows) {
        if (clearModelCache) await db.execute('DELETE FROM config_records WHERE scope = ? AND id = ?', ['model_cache', id]);
        return;
      }
      const [existing] = await rows(db, 'SELECT id FROM config_records WHERE scope = ? AND id = ?', [scope, id]);
      throw new AppError(existing ? 'config_conflict' : 'not_found', existing ? 'Config revision changed' : 'Config record not found', existing ? 409 : 404);
    });
  }

  async configBundle(agentId: string | null): Promise<{ app: StoredConfig | null; agent: StoredConfig | null; catalog: StoredConfig[]; connections: StoredConfig[]; modelCaches: StoredConfig[] }> {
    if (agentId !== null) identity(agentId, 'agentId');
    return this.transaction(async db => {
      if (agentId !== null) await this.agent(db, agentId);
      const [app] = await rows(db, 'SELECT id, revision, data FROM config_records WHERE scope = ? AND id = ?', ['app', 'settings']);
      const [agent] = agentId === null ? [] : await rows(db, 'SELECT id, revision, data FROM config_records WHERE scope = ? AND id = ?', ['agent', agentId]);
      const catalog = await rows(db, 'SELECT id, revision, data FROM config_records WHERE scope = ? ORDER BY id', ['catalog']);
      const connections = await rows(db, 'SELECT id, revision, data FROM config_records WHERE scope = ? ORDER BY id', ['connection']);
      const modelCaches = await rows(db, 'SELECT id, revision, data FROM config_records WHERE scope = ? ORDER BY id', ['model_cache']);
      return { app: app ? this.configRow(app) : null, agent: agent ? this.configRow(agent) : null, catalog: catalog.map(row => this.configRow(row)), connections: connections.map(row => this.configRow(row)), modelCaches: modelCaches.map(row => this.configRow(row)) };
    });
  }

  async getContext(agentId: string): Promise<ContextHistory> {
    const agent = await this.agent(this.pool, agentId);
    return { revision: agent.context_revision, entries: decode<ContextEntry[]>(agent.context, validateEntries) };
  }

  async replaceContext(agentId: string, revision: number, entries: ContextEntry[]): Promise<ContextHistory> {
    position(revision);
    validateEntries(entries);
    const serialized = encode(entries);
    await this.transaction(async db => {
      const agent = await this.agent(db, agentId, true);
      if (agent.context_revision !== revision) throw new AppError('context_conflict', 'Context revision changed', 409);
      await db.execute('UPDATE agents SET context = ?, context_revision = context_revision + 1 WHERE id = ?', [serialized, agentId]);
    });
    return { revision: revision + 1, entries: decode<ContextEntry[]>(serialized, validateEntries) };
  }

  private async append(db: Db, agent: RowDataPacket, runId: string, entry: ContextEntry): Promise<CompletedMessage> {
    validateEntries([entry]);
    const next = agent.history_position + 1;
    position(next);
    const context = decode<ContextEntry[]>(agent.context, validateEntries);
    if (context.some(item => item.messageId === entry.messageId)) throw new AppError('conflict', 'Message identity already exists in context', 409);
    context.push(entry);
    await db.execute('INSERT INTO messages (agent_id, position, id, run_id, entry) VALUES (?, ?, ?, ?, ?)', [agent.id, next, entry.messageId, runId, encode(entry)]);
    await db.execute('UPDATE agents SET history_position = ?, context = ?, context_revision = context_revision + 1 WHERE id = ?', [next, encode(context), agent.id]);
    return { ...entry, agentId: agent.id, runId, position: next };
  }

  async startRun(agentId: string, input: UserMessage, runId: string = randomUUID()): Promise<RunState> {
    identity(runId, 'runId');
    if (input.role !== 'user') throw new AppError('invalid_data', 'Starting a run requires a user message');
    const state: RunState = { agentId, runId, status: 'running', phase: 'model', step: 0, startedAt: Date.now(), endedAt: null, endPosition: null, activeMessageId: null, error: null };
    await this.transaction(async db => {
      const agent = await this.agent(db, agentId, true);
      if (agent.active_run_id) throw new AppError('agent_busy', 'Agent already has an active run', 409);
      await db.execute('INSERT INTO runs (id, agent_id, state) VALUES (?, ?, ?)', [runId, agentId, encode(state)]);
      await this.append(db, agent, runId, { messageId: randomUUID(), message: input, metadata: {} });
      await db.execute('UPDATE agents SET active_run_id = ?, latest_run_id = ? WHERE id = ?', [runId, runId, agentId]);
    });
    return state;
  }

  async beginMessage(agentId: string, runId: string, messageId: string, step: number): Promise<number> {
    identity(messageId, 'messageId');
    return this.transaction(async db => {
      const agent = await this.agent(db, agentId, true);
      const run = await this.active(db, agent, runId);
      if (run.activeMessageId) throw new AppError('conflict', 'A model message is already active', 409);
      await this.saveRun(db, { ...run, phase: 'model', step, activeMessageId: messageId });
      return agent.history_position as number;
    });
  }

  async commitMessage(agentId: string, runId: string, entry: ContextEntry): Promise<CompletedMessage> {
    validateEntries([entry]);
    if (entry.message.role === 'assistant' && !['stop', 'length', 'toolUse'].includes(entry.message.stopReason)) throw new AppError('invalid_data', 'Only finished model responses can be committed');
    return this.transaction(async db => {
      const agent = await this.agent(db, agentId, true);
      const run = await this.active(db, agent, runId);
      if (entry.message.role === 'assistant' && run.activeMessageId !== entry.messageId) throw new AppError('conflict', 'Assistant message identity does not match active message', 409);
      const record = await this.append(db, agent, runId, entry);
      if (run.activeMessageId === entry.messageId) {
        await this.saveRun(db, { ...run, activeMessageId: null, phase: 'tools' });
      }
      return record;
    });
  }

  async beginCompaction(state: CompactionState): Promise<void> {
    validateCompactionState(state);
    if (state.status !== 'preparing') throw new AppError('invalid_data', 'Compaction must start in preparation');
    await this.transaction(async db => {
      const agent = await this.agent(db, state.agentId, true);
      await this.run(db, state.agentId, state.runId);
      await db.execute('INSERT INTO context_compactions (id, agent_id, run_id, active_agent_id, history_after, state) VALUES (?, ?, ?, ?, ?, ?)',
        [state.id, state.agentId, state.runId, state.agentId, agent.history_position, encode(state)]);
    });
  }

  /** Tentative preparation is stable private history, not current model context or a new run. */
  async commitCompactionMessage(record: CompletedMessage): Promise<CompletedMessage> {
    validateEntries([record]);
    identity(record.metadata.compactionId, 'compactionId');
    if (record.metadata.source !== 'context-compaction') throw new AppError('invalid_data', 'Compaction message source is required');
    return this.transaction(async db => {
      const agent = await this.agent(db, record.agentId, true);
      const [row] = await rows(db, 'SELECT state FROM context_compactions WHERE id = ? AND agent_id = ? AND run_id = ? AND active_agent_id = ?', [String(record.metadata.compactionId), record.agentId, record.runId, record.agentId]);
      if (!row || decode<CompactionState>(row.state, validateCompactionState).status !== 'preparing') throw new AppError('context_conflict', 'Compaction is not preparing', 409);
      const position = agent.history_position + 1;
      const entry = {messageId: record.messageId, message: record.message, metadata: record.metadata};
      await db.execute('INSERT INTO messages (agent_id, position, id, run_id, entry) VALUES (?, ?, ?, ?, ?)', [record.agentId, position, record.messageId, record.runId, encode(entry)]);
      await db.execute('UPDATE agents SET history_position = ? WHERE id = ?', [position, record.agentId]);
      return {...record, position};
    });
  }

  async finishCompaction(state: CompactionState, revision: number, entries: ContextEntry[]): Promise<ContextHistory> {
    validateCompactionState(state); position(revision); validateEntries(entries);
    if (state.status === 'preparing') throw new AppError('invalid_data', 'A terminal compaction state is required');
    await this.transaction(async db => {
      const agent = await this.agent(db, state.agentId, true);
      const [row] = await rows(db, 'SELECT state FROM context_compactions WHERE id = ? AND agent_id = ? AND run_id = ? AND active_agent_id = ?', [state.id, state.agentId, state.runId, state.agentId]);
      if (!row || decode<CompactionState>(row.state, validateCompactionState).status !== 'preparing' || agent.context_revision !== revision) throw new AppError('context_conflict', 'Context or compaction state changed', 409);
      await db.execute('UPDATE agents SET context = ?, context_revision = context_revision + 1 WHERE id = ?', [encode(entries), state.agentId]);
      await db.execute('UPDATE context_compactions SET state = ?, active_agent_id = NULL WHERE id = ?', [encode(state), state.id]);
    });
    return {revision: revision + 1, entries: structuredClone(entries)};
  }

  async recoverCompactions(): Promise<void> {
    this.assertRuntime();
    const pending = await rows(this.pool, 'SELECT id, agent_id FROM context_compactions WHERE active_agent_id IS NOT NULL');
    for (const item of pending) await this.transaction(async db => {
      const agent = await this.agent(db, item.agent_id, true);
      const [row] = await rows(db, 'SELECT * FROM context_compactions WHERE id = ? AND active_agent_id IS NOT NULL', [item.id]);
      if (!row) return;
      const state = decode<CompactionState>(row.state, validateCompactionState);
      const records = await rows(db, 'SELECT entry FROM messages WHERE agent_id = ? AND position > ? AND run_id = ? ORDER BY position', [state.agentId, row.history_after, state.runId]);
      const trace = records.map(row => decode<ContextEntry>(row.entry, value => validateEntries([value]))).filter(entry => entry.metadata.compactionId === state.id);
      const error = {code: 'runtime_restarted', message: 'Runtime stopped during context preparation; recorded effects were not replayed'};
      const entries = interruptedCompactionContext({revision: agent.context_revision, entries: decode<ContextEntry[]>(agent.context, validateEntries)}, trace, error);
      await db.execute('UPDATE agents SET context = ?, context_revision = context_revision + 1 WHERE id = ?', [encode(entries), state.agentId]);
      await db.execute('UPDATE context_compactions SET state = ?, active_agent_id = NULL WHERE id = ?', [encode({...state, status: 'failed', endedAt: Date.now(), error}), state.id]);
    });
  }

  async finishRun(agentId: string, runId: string, status: Exclude<RunStatus, 'running'>, error: RunState['error'] = null): Promise<RunState> {
    return this.transaction(async db => {
      const agent = await this.agent(db, agentId, true);
      const existing = await this.run(db, agentId, runId);
      if (existing.status !== 'running') return existing;
      const run = await this.active(db, agent, runId);
      const finished: RunState = { ...run, status, phase: 'finished', activeMessageId: null, endedAt: Date.now(), endPosition: agent.history_position, error };
      await this.saveRun(db, finished);
      await db.execute('UPDATE agents SET active_run_id = NULL WHERE id = ?', [agentId]);
      await this.finishChatEntry(db, finished);
      return finished;
    });
  }

  async recoverInterruptedRuns(beforeFinish?: (run: { agentId: string; runId: string }) => Promise<void>): Promise<void> {
    this.assertRuntime();
    const active = await rows(this.pool, 'SELECT id, active_run_id FROM agents WHERE active_run_id IS NOT NULL');
    for (const agent of active) {
      await beforeFinish?.({ agentId: agent.id, runId: agent.active_run_id });
      await this.finishRun(agent.id, agent.active_run_id, 'interrupted', { code: 'runtime_restarted', message: 'Runtime stopped before the run finished' });
    }
  }

  async getState(agentId: string): Promise<CurrentState> {
    return (await this.followSnapshot(agentId, undefined, 0, false)).state;
  }

  async followSnapshot(agentId: string, runId: string | null | undefined = undefined, after = 0, includeHistory = true): Promise<FollowSnapshot> {
    position(after);
    return this.transaction(async db => {
      identity(agentId, 'agentId');
      const [agent] = await rows(db, 'SELECT id, latest_run_id, history_position, context_revision FROM agents WHERE id = ?', [agentId]);
      if (!agent) throw new AppError('not_found', 'Agent not found', 404);
      const selected = runId === undefined ? agent.latest_run_id : runId;
      const run = selected ? await this.run(db, agentId, selected) : null;
      const upper = run?.endPosition ?? agent.history_position;
      if (after > upper) throw new AppError('invalid_cursor', 'History cursor is ahead of this run', 409);
      const records = includeHistory ? await rows(db, 'SELECT * FROM messages WHERE agent_id = ? AND position > ? AND position <= ? ORDER BY position', [agentId, after, upper]) : [];
      const history = records.map(row => {
        const entry = decode<ContextEntry>(row.entry, value => validateEntries([value]));
        return { ...entry, agentId, runId: row.run_id as string, position: row.position as number };
      });
      return { state: { agentId, contextRevision: agent.context_revision, historyPosition: upper, run }, history };
    });
  }

  /** The completed messages of one run, in order. A run is short, so this does not read the agent's whole history. */
  async runMessages(agentId: string, runId: string): Promise<CompletedMessage[]> {
    identity(agentId, 'agentId');
    identity(runId, 'runId');
    const records = await rows(this.pool, 'SELECT position, entry FROM messages WHERE agent_id = ? AND run_id = ? ORDER BY position', [agentId, runId]);
    return records.map(row => ({ ...decode<ContextEntry>(row.entry, value => validateEntries([value])), agentId, runId, position: row.position as number }));
  }

  /** Original shared content in one repeatable-read view. Agent owns the requested consumption position. */
  async readGroupContext(workspaceId: string, after: number): Promise<GroupContextMessage[]> {
    identity(workspaceId, 'workspaceId'); position(after);
    return this.transaction(db => this.groupContext(db, workspaceId, after));
  }

  private async groupContext(db: Db, workspaceId: string, after: number): Promise<GroupContextMessage[]> {
    const [settings] = await rows(db, 'SELECT position, reset_position FROM chat_settings WHERE workspace_id = ?', [workspaceId]);
    const upper = settings?.position ?? 0;
    if (after > upper) throw new AppError('invalid_cursor', 'Group consumption position is ahead of history', 409);
    const records = await rows(db, 'SELECT entry FROM chat_messages WHERE workspace_id = ? AND position > ? AND position <= ? ORDER BY position', [workspaceId, Math.max(after, settings?.reset_position ?? 0), upper]);
    return Promise.all(records.map(async row => {
      const stored = decode<StoredChatMessage>(row.entry, () => undefined);
      const message = await this.resolveChatMessage(db, stored);
      const images = await Promise.all((message.attachments ?? []).map(image => this.readChatImage(db, workspaceId, image.id)));
      return { position: message.position, sender: groupSender(message), entry: groupEntry(message, images.map(imageContent)),
        ...(stored.finalRef ? { origin: { agentId: stored.finalRef.agentId, messageId: stored.finalRef.messageId } } : {}) };
    }));
  }

  async configureChat(workspaceId: string, value: number): Promise<void> {
    mentionLimit(value);
    await this.transaction(async db => {
      if (!(await rows(db, 'SELECT id FROM workspaces WHERE id = ? FOR UPDATE', [workspaceId])).length) throw new AppError('not_found', 'Workspace not found', 404);
      await db.execute('INSERT INTO chat_settings (workspace_id, mention_limit) VALUES (?, ?) ON DUPLICATE KEY UPDATE mention_limit = VALUES(mention_limit)', [workspaceId, value]);
    });
  }

  async publishChat(input: ChatPublication): Promise<ChatAcceptance> {
    if (input.author.type === 'member' && input.images?.length) throw new AppError('invalid_input', 'Only user publications accept picture attachments');
    if (input.author.type === 'member' && input.recipients.length > 1) throw new AppError('invalid_mentions', 'An agent response can mention at most one member');
    return this.transaction(async db => {
      // Workspace lock serializes publication, budget allocation and stop. Runtime writes lock agents.
      if (!(await rows(db, 'SELECT id FROM workspaces WHERE id = ? FOR UPDATE', [input.workspaceId])).length) throw new AppError('not_found', 'Workspace not found', 404);
      await db.execute('INSERT IGNORE INTO chat_settings (workspace_id) VALUES (?)', [input.workspaceId]);
      const [settings] = await rows(db, 'SELECT * FROM chat_settings WHERE workspace_id = ?', [input.workspaceId]);
      const memberRows = await rows(db, 'SELECT id, data, revision FROM members WHERE workspace_id = ? ORDER BY id', [input.workspaceId]);
      const active = memberRows.filter(row => decode<MemberRecord>(row.data, () => undefined).retiredAt === null);
      const agents = new Map<string, RowDataPacket>();
      for (const member of active) agents.set(member.id, await this.agent(db, member.id, true));
      const sender = input.author.type === 'member' ? agents.get(input.author.memberId) : undefined;
      if (input.author.type === 'member') {
        if (!sender || sender.active_run_id !== input.author.runId) throw new AppError('member_unavailable', 'The sending member is no longer working', 409);
        const [origin] = await rows(db, 'SELECT exchange_id FROM chat_runs WHERE run_id = ?', [input.author.runId]);
        if (!origin || origin.exchange_id !== input.exchangeId) throw new AppError('invalid_input', 'Response does not belong to this exchange');
      }
      for (const recipient of input.recipients) {
        if (input.memberRevisions && Number(active.find(member => member.id === recipient)?.revision) !== input.memberRevisions[recipient]) throw new AppError('config_conflict', 'Recipient configuration changed before activation; retry publication', 409);
        const agent = agents.get(recipient);
        if (!agent) throw new AppError('member_unavailable', 'A mentioned member has retired', 409);
        if (agent.active_run_id) throw new AppError('member_busy', 'A mentioned member is already working; revise or try again when it is free', 409);
      }
      const exchangeId = input.exchangeId ?? randomUUID();
      if (!input.exchangeId) await db.execute('INSERT INTO chat_exchanges (id, workspace_id, mention_limit) VALUES (?, ?, ?)', [exchangeId, input.workspaceId, settings!.mention_limit]);
      const [exchange] = await rows(db, 'SELECT * FROM chat_exchanges WHERE id = ? AND workspace_id = ?', [exchangeId, input.workspaceId]);
      if (!exchange || exchange.stopped) throw new AppError('exchange_stopped', 'This exchange has stopped', 409);
      if (exchange.used + input.recipients.length > exchange.mention_limit) throw new AppError('mention_limit', 'The exchange mention limit is reached; finish with a response without mentions', 409);
      let finalRef: FinalReference | undefined;
      if (sender && input.author.type === 'member') {
        const [record] = await rows(db, 'SELECT id, run_id, position, entry FROM messages WHERE agent_id = ? AND id = ?', [sender.id, input.finalMessageId ?? '']);
        if (!record || record.run_id !== input.author.runId) throw new AppError('invalid_input', 'Final reference must identify the committed response of this activation');
        if (record.position !== sender.history_position) throw new AppError('invalid_input', 'Final reference must identify the latest committed response');
        const candidate = decode<ContextEntry>(record.entry, value => validateEntries([value]));
        const answer = finalAnswer(candidate.message);
        if (!answer) throw new AppError('invalid_input', 'Final reference must identify naturally completed answer text');
        const response = parseMemberResponse(answer.text);
        finalRef = { agentId: sender.id, runId: record.run_id, messageId: record.id, position: record.position, contentIndices: answer.contentIndices, bodyOffset: response.bodyOffset };
        if (await this.finalText(db, finalRef) !== input.text) throw new AppError('invalid_input', 'Final response text does not match its committed reference');
      }
      const entries: TimelineEntry[] = [];
      const message: ChatMessage = { workspaceId: input.workspaceId, messageId: randomUUID(), position: settings!.position + 1, exchangeId, author: input.author, text: input.text, ...(input.images?.length ? { attachments: input.images.map(image => image.metadata) } : {}), recipients: input.recipients, time: Date.now() };
      validateChatMessage(message);
      for (const image of input.images ?? []) await db.execute('INSERT INTO chat_images (workspace_id, id, metadata, content) VALUES (?, ?, ?, ?)', [input.workspaceId, image.metadata.id, encode(image.metadata), image.bytes]);
      await db.execute('INSERT INTO chat_messages (workspace_id, position, entry) VALUES (?, ?, ?)', [input.workspaceId, message.position, encode(finalRef ? { ...message, text: undefined, finalRef } : message)]);
      await db.execute('UPDATE chat_settings SET position = ? WHERE workspace_id = ?', [message.position, input.workspaceId]);
      await db.execute('UPDATE chat_exchanges SET used = used + ? WHERE id = ?', [input.recipients.length, exchangeId]);
      if (sender && input.author.type === 'member') {
        const run = await this.active(db, sender, input.author.runId);
        if (run.activeMessageId) throw new AppError('conflict', 'Finish the private response before publication', 409);
        const finished: RunState = { ...run, status: 'completed', phase: 'finished', endedAt: Date.now(), endPosition: sender.history_position };
        await this.saveRun(db, finished);
        const completedEntry = await this.finishChatEntry(db, finished, finalRef, input.author.name);
        if (!completedEntry) throw new AppError('corrupt_data', 'Member response reservation is missing', 500);
        entries.push(completedEntry);
        await db.execute('UPDATE agents SET active_run_id = NULL WHERE id = ?', [sender.id]);
        sender.active_run_id = null;
      }
      if (input.author.type === 'user') entries.push(await this.writeChatEntry(db, { workspaceId: input.workspaceId, entryId: message.messageId, position: 0, revision: 0, exchangeId, time: message.time, kind: 'user', text: input.text, messageId: message.messageId, ...(message.attachments ? { attachments: message.attachments } : {}) }));
      const runs: RunState[] = [];
      for (const agentId of input.recipients) {
        const run: RunState = { agentId, runId: randomUUID(), status: 'running', phase: 'model', step: 0, startedAt: Date.now(), endedAt: null, endPosition: null, activeMessageId: null, error: null };
        await db.execute('INSERT INTO runs (id, agent_id, state) VALUES (?, ?, ?)', [run.runId, agentId, encode(run)]);
        await db.execute('INSERT INTO chat_runs (run_id, exchange_id) VALUES (?, ?)', [run.runId, exchangeId]);
        await db.execute('UPDATE agents SET active_run_id = ?, latest_run_id = ? WHERE id = ?', [run.runId, run.runId, agentId]);
        const member = memberRows.find(row => row.id === agentId)!;
        const name = decode<MemberRecord>(member.data, () => undefined).name;
        entries.push(await this.writeChatEntry(db, { workspaceId: input.workspaceId, entryId: run.runId, position: 0, revision: 0, exchangeId, time: run.startedAt, kind: 'member', memberId: agentId, name, run, working: { after: agents.get(agentId)!.history_position, through: null }, finalRef: null, text: null }));
        runs.push(run);
      }
      return { message, runs, entries };
    });
  }

  async chatSnapshot(workspaceId: string, after = 0, limit = 100): Promise<ChatSnapshot> {
    identity(workspaceId, 'workspaceId'); position(after);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new AppError('invalid_input', 'limit is 1–500');
    return this.transaction(async db => {
      if (!(await rows(db, 'SELECT id FROM workspaces WHERE id = ?', [workspaceId])).length) throw new AppError('not_found', 'Workspace not found', 404);
      const [settings] = await rows(db, 'SELECT * FROM chat_settings WHERE workspace_id = ?', [workspaceId]);
      const upper = settings?.position ?? 0;
      if (after > upper) throw new AppError('invalid_cursor', 'Chat cursor is ahead of history', 409);
      const resetPosition = settings?.reset_position ?? 0;
      const records = await rows(db, 'SELECT entry FROM chat_messages WHERE workspace_id = ? AND position > ? ORDER BY position' + limitClause(limit), [workspaceId, Math.max(after, resetPosition)]);
      const messages = await Promise.all(records.map(row => this.resolveChatMessage(db, decode<StoredChatMessage>(row.entry, () => undefined))));
      const activity = await rows(db, `SELECT r.state, cr.exchange_id FROM chat_runs cr JOIN runs r ON r.id = cr.run_id JOIN chat_exchanges e ON e.id = cr.exchange_id WHERE e.workspace_id = ? ORDER BY r.id`, [workspaceId]);
      return { workspaceId, position: upper, resetPosition, mentionLimit: settings?.mention_limit ?? defaultMentionLimit, messages, more: (messages.at(-1)?.position ?? Math.max(after, resetPosition)) < upper, runs: activity.map(row => ({ exchangeId: row.exchange_id, run: decode<RunState>(row.state, validateRun) })) };
    });
  }

  /** The clock is locked after agent rows, including on terminal writes. */
  private async writeChatEntry(db: Db, input: TimelineEntry): Promise<TimelineEntry> {
    await db.execute('INSERT INTO chat_clock (workspace_id) VALUES (?) ON DUPLICATE KEY UPDATE workspace_id = VALUES(workspace_id)', [input.workspaceId]);
    const [clock] = await rows(db, 'SELECT position, seq FROM chat_clock WHERE workspace_id = ? FOR UPDATE', [input.workspaceId]);
    const entry: TimelineEntry = { ...input, position: input.position || clock!.position + 1, revision: clock!.seq + 1 };
    validateTimelineEntry(entry);
    const stored = { ...entry, ...(entry.kind === 'member' ? { text: null } : {}) };
    await db.execute('INSERT INTO chat_entries (workspace_id, id, position, run_id, data) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)', [entry.workspaceId, entry.entryId, entry.position, entry.kind === 'member' ? entry.run.runId : null, encode(stored)]);
    await db.execute('INSERT INTO chat_changes (workspace_id, seq, data) VALUES (?, ?, ?)', [entry.workspaceId, entry.revision, encode(stored)]);
    await db.execute('UPDATE chat_clock SET position = ?, seq = ? WHERE workspace_id = ?', [Math.max(clock!.position, entry.position), entry.revision, entry.workspaceId]);
    return entry;
  }

  private async finishChatEntry(db: Db, run: RunState, finalRef?: FinalReference, publishedName?: string): Promise<TimelineEntry | null> {
    const [row] = await rows(db, 'SELECT data FROM chat_entries WHERE run_id = ?', [run.runId]);
    if (!row) return null; // Solo runs have no group entry.
    const entry = decode<TimelineEntry>(row.data, validateTimelineEntry);
    if (entry.kind !== 'member') throw new AppError('corrupt_data', 'Invalid member entry', 500);
    if (entry.run.status !== 'running') return this.resolveTimelineEntry(db, entry);
    return this.writeChatEntry(db, { ...entry, name: publishedName ?? entry.name, run, working: { ...entry.working, through: run.endPosition }, finalRef: finalRef ?? null, text: finalRef ? await this.finalText(db, finalRef) : null });
  }

  private async finalText(db: Db, ref: FinalReference): Promise<string> {
    identity(ref.agentId); identity(ref.runId); identity(ref.messageId); position(ref.position);
    if (ref.bodyOffset !== undefined && (!ref.contentIndices || ref.toolCallId !== undefined)) throw new AppError('corrupt_data', 'Final body offset requires selected text blocks', 500);
    const [row] = await rows(db, 'SELECT id, run_id, entry FROM messages WHERE agent_id = ? AND position = ?', [ref.agentId, ref.position]);
    if (!row || row.id !== ref.messageId || row.run_id !== ref.runId) throw new AppError('corrupt_data', 'Referenced final message is unavailable', 500);
    const entry = decode<ContextEntry>(row.entry, value => validateEntries([value]));
    if (entry.message.role !== 'assistant') throw new AppError('corrupt_data', 'Final reference must identify assistant output', 500);
    // Decode immutable publications accepted before ordinary model completion replaced the response tool.
    if (ref.toolCallId) {
      const call = entry.message.content.find(part => part.type === 'toolCall' && part.id === ref.toolCallId);
      if (call?.type !== 'toolCall' || call.name !== 'final_response' || typeof call.arguments.text !== 'string') throw new AppError('corrupt_data', 'Historical final action is unavailable', 500);
      return call.arguments.text;
    }
    if (ref.contentIndices) {
      const answer = finalAnswer(entry.message);
      if (!answer || JSON.stringify(answer.contentIndices) !== JSON.stringify(ref.contentIndices)) throw new AppError('corrupt_data', 'Final text selection does not match its stored response', 500);
      if (ref.bodyOffset === undefined) return answer.text;
      if (!Number.isSafeInteger(ref.bodyOffset) || ref.bodyOffset < 0 || ref.bodyOffset >= answer.text.length) throw new AppError('corrupt_data', 'Invalid final body offset', 500);
      return answer.text.slice(ref.bodyOffset);
    }
    if (entry.message.content.some(part => part.type === 'toolCall')) throw new AppError('corrupt_data', 'Historical final reference contains tool calls', 500);
    return entry.message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');
  }

  private async readChatImage(db: Db, workspaceId: string, imageId: string): Promise<PreparedChatImage> {
    const [row] = await rows(db, 'SELECT metadata, content FROM chat_images WHERE workspace_id = ? AND id = ?', [workspaceId, imageId]);
    if (!row) throw new AppError('not_found', 'Picture not found', 404);
    const metadata = decode<PreparedChatImage['metadata']>(row.metadata, value => validateChatImages([value]));
    if (!Buffer.isBuffer(row.content) || row.content.length !== metadata.size) throw new AppError('corrupt_data', 'Stored picture size does not match metadata', 500);
    return { metadata, bytes: row.content };
  }

  async chatImage(workspaceId: string, imageId: string): Promise<PreparedChatImage> {
    identity(workspaceId, 'workspaceId'); identity(imageId, 'imageId');
    return this.readChatImage(this.pool, workspaceId, imageId);
  }

  private async resolveChatMessage(db: Db, stored: StoredChatMessage): Promise<ChatMessage> {
    if (stored.author.type === 'member' && (!stored.finalRef || stored.finalRef.agentId !== stored.author.memberId || stored.finalRef.runId !== stored.author.runId || stored.text !== undefined)) throw new AppError('corrupt_data', 'Invalid shared final reference', 500);
    const { finalRef, ...record } = stored;
    const message = { ...record, text: finalRef ? await this.finalText(db, finalRef) : record.text } as ChatMessage;
    validateChatMessage(message);
    return message;
  }

  private async resolveTimelineEntry(db: Db, entry: TimelineEntry): Promise<TimelineEntry> {
    return entry.kind === 'member' && entry.finalRef ? { ...entry, text: await this.finalText(db, entry.finalRef) } : entry;
  }

  async chatTimeline(workspaceId: string, after = 0, limit = 100): Promise<TimelineSnapshot> {
    identity(workspaceId, 'workspaceId'); position(after);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new AppError('invalid_input', 'limit is 1–500');
    return this.transaction(async db => {
      if (!(await rows(db, 'SELECT id FROM workspaces WHERE id = ?', [workspaceId])).length) throw new AppError('not_found', 'Workspace not found', 404);
      const [clock] = await rows(db, 'SELECT seq FROM chat_clock WHERE workspace_id = ?', [workspaceId]);
      const cursor = clock?.seq ?? 0;
      if (after > cursor) throw new AppError('invalid_cursor', 'Timeline cursor is ahead of history', 409);
      const [settings] = await rows(db, 'SELECT mention_limit, reset_cursor FROM chat_settings WHERE workspace_id = ?', [workspaceId]);
      const resetCursor = settings?.reset_cursor ?? 0;
      const records = await rows(db, 'SELECT seq, data FROM chat_changes WHERE workspace_id = ? AND seq > ? ORDER BY seq' + limitClause(limit), [workspaceId, Math.max(after, resetCursor)]);
      const changes = await Promise.all(records.map(async row => ({ cursor: row.seq as number, entry: await this.resolveTimelineEntry(db, decode<TimelineEntry>(row.data, validateTimelineEntry)) })));
      return { workspaceId, cursor, resetCursor, changes, more: (changes.at(-1)?.cursor ?? Math.max(after, resetCursor)) < cursor, mentionLimit: settings?.mention_limit ?? defaultMentionLimit };
    });
  }

  /** Upgrade old prototype records once. Old display order is publication order. */
  private async importChatHistory(): Promise<void> {
    const workspaces = await rows(this.pool, 'SELECT DISTINCT workspace_id FROM chat_messages');
    for (const workspace of workspaces) await this.transaction(async db => {
      await rows(db, 'SELECT id FROM workspaces WHERE id = ? FOR UPDATE', [workspace.workspace_id]);
      if ((await rows(db, 'SELECT workspace_id FROM chat_clock WHERE workspace_id = ?', [workspace.workspace_id])).length) return;
      const records = await rows(db, 'SELECT position, entry FROM chat_messages WHERE workspace_id = ? ORDER BY position', [workspace.workspace_id]);
      const imported = new Set<string>();
      for (const row of records) {
        const message = decode<ChatMessage>(row.entry, validateChatMessage);
        const base = { workspaceId: message.workspaceId, entryId: message.messageId, position: 0, revision: 0, exchangeId: message.exchangeId, time: message.time };
        if (message.author.type === 'user') await this.writeChatEntry(db, { ...base, kind: 'user', text: message.text, messageId: message.messageId });
        else {
          const run = await this.run(db, message.author.memberId, message.author.runId);
          // The old atomic final publication pinned endPosition to its committed candidate.
          const [final] = await rows(db, 'SELECT id FROM messages WHERE agent_id = ? AND run_id = ? AND position = ?', [run.agentId, run.runId, run.endPosition]);
          if (!final) throw new AppError('corrupt_data', 'Old group final history is unavailable', 500);
          const ref: FinalReference = { agentId: run.agentId, runId: run.runId, messageId: final.id, position: run.endPosition! };
          if (await this.finalText(db, ref) !== message.text) throw new AppError('corrupt_data', 'Old group final reference differs from publication', 500);
          const [first] = await rows(db, 'SELECT MIN(position) AS position FROM messages WHERE agent_id = ? AND run_id = ?', [run.agentId, run.runId]);
          await this.writeChatEntry(db, { ...base, entryId: run.runId, kind: 'member', memberId: run.agentId, name: message.author.name, run, working: { after: first!.position - 1, through: run.endPosition }, finalRef: ref, text: null });
          await db.execute('UPDATE chat_messages SET entry = ? WHERE workspace_id = ? AND position = ?', [encode({ ...message, text: undefined, finalRef: ref }), message.workspaceId, row.position]);
          imported.add(run.runId);
        }
      }
      const runs = await rows(db, 'SELECT r.state, cr.exchange_id, m.data FROM chat_runs cr JOIN runs r ON r.id = cr.run_id JOIN members m ON m.id = r.agent_id WHERE m.workspace_id = ? ORDER BY r.id', [workspace.workspace_id]);
      for (const row of runs) {
        const run = decode<RunState>(row.state, validateRun);
        if (imported.has(run.runId)) continue;
        const [first] = await rows(db, 'SELECT MIN(position) AS position FROM messages WHERE agent_id = ? AND run_id = ?', [run.agentId, run.runId]);
        const agent = await this.agent(db, run.agentId);
        await this.writeChatEntry(db, { workspaceId: workspace.workspace_id, entryId: run.runId, position: 0, revision: 0, exchangeId: row.exchange_id, time: run.startedAt, kind: 'member', memberId: run.agentId, name: decode<MemberRecord>(row.data, () => undefined).name, run, working: { after: first?.position ? first.position - 1 : run.endPosition ?? agent.history_position, through: run.endPosition }, finalRef: null, text: null });
      }
    });
  }

  async stopChat(workspaceId: string): Promise<RunState[]> {
    return this.transaction(async db => {
      if (!(await rows(db, 'SELECT id FROM workspaces WHERE id = ? FOR UPDATE', [workspaceId])).length) throw new AppError('not_found', 'Workspace not found', 404);
      await db.execute('UPDATE chat_exchanges SET stopped = 1 WHERE workspace_id = ?', [workspaceId]);
      const active = await rows(db, 'SELECT r.state FROM chat_runs cr JOIN runs r ON r.id = cr.run_id JOIN agents a ON a.active_run_id = r.id JOIN chat_exchanges e ON e.id = cr.exchange_id WHERE e.workspace_id = ?', [workspaceId]);
      return active.map(row => decode<RunState>(row.state, validateRun));
    });
  }

  /** Explicit user reset is the only operation that removes stable conversation history. */
  async resetChat(workspaceId: string): Promise<ChatReset> {
    identity(workspaceId, 'workspaceId');
    return this.transaction(async db => {
      if (!(await rows(db, 'SELECT id FROM workspaces WHERE id = ? FOR UPDATE', [workspaceId])).length) throw new AppError('not_found', 'Workspace not found', 404);
      const members = await rows(db, 'SELECT id, data FROM members WHERE workspace_id = ? ORDER BY id', [workspaceId]);
      for (const member of members) {
        const agent = await this.agent(db, member.id, true);
        if (agent.active_run_id) throw new AppError('workspace_busy', 'Stop team work and wait for every member to finish before resetting the chat', 409);
      }
      await db.execute('INSERT IGNORE INTO chat_settings (workspace_id) VALUES (?)', [workspaceId]);
      await db.execute('INSERT IGNORE INTO chat_clock (workspace_id) VALUES (?)', [workspaceId]);
      const [settings] = await rows(db, 'SELECT position FROM chat_settings WHERE workspace_id = ?', [workspaceId]);
      const [clock] = await rows(db, 'SELECT seq FROM chat_clock WHERE workspace_id = ? FOR UPDATE', [workspaceId]);
      const resetCursor = clock!.seq + 1;
      const resetPosition = settings!.position + 1;
      for (const table of ['chat_changes', 'chat_entries', 'chat_messages', 'chat_images']) await db.execute(`DELETE FROM ${table} WHERE workspace_id = ?`, [workspaceId]);
      // Include all member runs, even ones not linked to an exchange, but never solo agents.
      await db.execute('DELETE cr FROM chat_runs cr JOIN runs r ON r.id = cr.run_id JOIN members m ON m.id = r.agent_id WHERE m.workspace_id = ?', [workspaceId]);
      await db.execute('DELETE FROM chat_exchanges WHERE workspace_id = ?', [workspaceId]);
      for (const member of members) {
        await db.execute('DELETE FROM context_compactions WHERE agent_id = ?', [member.id]);
        await db.execute('DELETE FROM messages WHERE agent_id = ?', [member.id]);
        await db.execute('DELETE FROM runs WHERE agent_id = ?', [member.id]);
        await db.execute('UPDATE agents SET context = ?, context_revision = context_revision + 1, history_position = 0, active_run_id = NULL, latest_run_id = NULL WHERE id = ?', [encode([]), member.id]);
      }
      await db.execute('UPDATE chat_clock SET seq = ? WHERE workspace_id = ?', [resetCursor, workspaceId]);
      await db.execute('UPDATE chat_settings SET position = ?, reset_cursor = ?, reset_position = ? WHERE workspace_id = ?', [resetPosition, resetCursor, resetPosition, workspaceId]);
      return { workspaceId, resetCursor, resetPosition };
    });
  }

  async listMembers(workspaceId: string): Promise<StoredMember[]> {
    return (await rows(this.pool, 'SELECT id, workspace_id, revision, data FROM members WHERE workspace_id = ? ORDER BY ordinal', [workspaceId])).map(memberRow);
  }

  async getMember(memberId: string): Promise<StoredMember | null> {
    const [row] = await rows(this.pool, 'SELECT id, workspace_id, revision, data FROM members WHERE id = ?', [memberId]);
    return row ? memberRow(row) : null;
  }

  /** The member's conversation and the member, which the caller's transaction commits together. */
  private async insertMember(db: Db, member: NewMember): Promise<StoredMember> {
    identity(member.id, 'memberId');
    const data = encode(member.value);
    await db.execute('INSERT INTO agents (id, context) VALUES (?, ?)', [member.id, encode([])]);
    try {
      await db.execute('INSERT INTO members (id, workspace_id, is_lead, name_key, data) VALUES (?, ?, ?, ?, ?)', [member.id, member.workspaceId, member.lead ? 1 : null, member.nameKey, data]);
    } catch (error) {
      throw memberConflict(error);
    }
    return { id: member.id, workspaceId: member.workspaceId, revision: 0, value: decode<MemberRecord>(data, () => undefined) };
  }

  async getMemberActivation(workspaceId: string): Promise<MemberActivationState | null> {
    const [row] = await rows(this.pool, 'SELECT revision, time FROM member_activation WHERE workspace_id = ?', [workspaceId]);
    return row ? { revision: String(row.revision), time: Number(row.time) } : null;
  }
  async activateMembers(workspaceId: string, input: MemberActivation): Promise<void> {
    await this.transaction(async db => {
      if (!(await rows(db, 'SELECT id FROM workspaces WHERE id = ? FOR UPDATE', [workspaceId])).length) throw new AppError('not_found', 'Workspace not found', 404);
      const [activation] = await rows(db, 'SELECT revision, time FROM member_activation WHERE workspace_id = ? FOR UPDATE', [workspaceId]);
      if ((activation?.revision ?? null) !== (input.expectedActivation?.revision ?? null) || (activation ? Number(activation.time) : null) !== (input.expectedActivation?.time ?? null)) throw new AppError('stale_revision', 'Configuration activation changed after review', 409);
      const current = (await rows(db, 'SELECT id, workspace_id, revision, data FROM members WHERE workspace_id = ? ORDER BY ordinal FOR UPDATE', [workspaceId])).map(memberRow);
      const active = current.filter(m => m.value.retiredAt === null);
      const expected = new Map(input.expected.map(m => [m.id, m.revision]));
      if (active.length !== expected.size || active.some(m => expected.get(m.id) !== m.revision)) throw new AppError('config_conflict', 'Team changed after review; review again', 409);
      const [models] = await rows(db, 'SELECT revision FROM workspace_models WHERE workspace_id = ?', [workspaceId]);
      if (!models || Number(models.revision) !== input.modelsRevision) throw new AppError('config_conflict', 'Workspace models changed after review', 409);
      for (const member of active.slice().sort((a,b) => a.id.localeCompare(b.id))) if ((await this.agent(db, member.id, true)).active_run_id) throw new AppError('workspace_busy', 'All workspace members must be idle', 409);
      // Retire first so a replacement may reuse its name within the same transaction.
      for (const next of input.update.slice().sort((a,b) => Number(b.value.retiredAt !== null)-Number(a.value.retiredAt !== null))) {
        const old = active.find(m => m.id === next.id);
        if (!old || next.workspaceId !== workspaceId || next.value.workspaceId !== workspaceId || next.revision !== old.revision + 1 || old.value.lead !== next.value.lead || (old.value.lead && next.value.retiredAt !== null)) throw new AppError('config_conflict', 'Invalid member activation', 409);
        try { await db.execute('UPDATE members SET data = ?, name_key = ?, revision = ? WHERE id = ?', [encode(next.value), next.value.retiredAt === null ? next.value.name.toLowerCase() : null, next.revision, next.id]); }
        catch (error) { throw memberConflict(error); }
      }
      for (const member of input.create) {
        if (member.workspaceId !== workspaceId || member.value.workspaceId !== workspaceId || member.lead || member.value.lead || member.value.retiredAt !== null) throw new AppError('invalid_config', 'Invalid member creation');
        await this.insertMember(db, member);
      }
      await db.execute('INSERT INTO member_activation (workspace_id, revision, time) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE revision = VALUES(revision), time = VALUES(time)', [workspaceId, input.activation.revision, input.activation.time]);
    });
  }

  async createMember(member: NewMember): Promise<StoredMember> {
    return this.transaction(async db => {
      if (!(await rows(db, 'SELECT id FROM workspaces WHERE id = ? FOR UPDATE', [member.workspaceId])).length) throw new AppError('not_found', 'Workspace not found', 404);
      return this.insertMember(db, member);
    });
  }

  async updateMember(memberId: string, revision: number, nameKey: string | null, value: MemberRecord, requireIdle = false): Promise<StoredMember> {
    identity(memberId, 'memberId');
    position(revision);
    const data = encode(value);
    await this.transaction(async db => {
      if (!(await rows(db, 'SELECT id FROM workspaces WHERE id = ? FOR UPDATE', [value.workspaceId])).length) throw new AppError('not_found', 'Workspace not found', 404);
      if (requireIdle && (await this.agent(db, memberId, true)).active_run_id) throw new AppError('member_busy', 'Wait for the member before submitting configuration', 409);
      let result: ResultSetHeader;
      try {
        [result] = await db.execute<ResultSetHeader>('UPDATE members SET data = ?, name_key = ?, revision = revision + 1 WHERE id = ? AND revision = ?', [data, nameKey, memberId, revision]);
      } catch (error) {
        throw memberConflict(error);
      }
      if (result.affectedRows) {
        return;
      }
      const [existing] = await rows(db, 'SELECT id FROM members WHERE id = ?', [memberId]);
      throw new AppError(existing ? 'config_conflict' : 'not_found', existing ? 'Member revision changed' : 'Member not found', existing ? 409 : 404);
    });
    return { id: memberId, workspaceId: value.workspaceId, revision: revision + 1, value: decode<MemberRecord>(data, () => undefined) };
  }

  async getGitBaseline(workspaceId: string): Promise<import('../workspace/workspace-git.js').GitBaseline | null> {
    const [row] = await rows(this.pool, 'SELECT data FROM workspace_git_baselines WHERE workspace_id = ?', [workspaceId]);
    return row ? decode(row.data, () => undefined) : null;
  }
  async initializeGitBaseline(workspaceId: string, baseline: import('../workspace/workspace-git.js').GitBaseline) {
    await this.pool.execute('INSERT IGNORE INTO workspace_git_baselines (workspace_id, data) VALUES (?, ?)', [workspaceId, encode(baseline)]);
    return (await this.getGitBaseline(workspaceId))!;
  }

  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    return (await rows(this.pool, 'SELECT id, name, directory, created_at FROM workspaces ORDER BY name, id')).map(workspaceRow);
  }

  async getWorkspace(workspaceId: string): Promise<WorkspaceRecord | null> {
    const [row] = await rows(this.pool, 'SELECT id, name, directory, created_at FROM workspaces WHERE id = ?', [workspaceId]);
    return row ? workspaceRow(row) : null;
  }

  /** Registers the workspace and its team's lead together; if either fails, neither is stored. */
  async createWorkspace(workspace: WorkspaceRecord, directoryKey: string, lead: NewMember, models?: WorkspaceModels, bootstrap?: WorkspaceBootstrap): Promise<void> {
    await this.transaction(async db => {
      try {
        await db.execute('INSERT INTO workspaces (id, name, directory, directory_key, created_at) VALUES (?, ?, ?, ?, ?)', [workspace.workspaceId, workspace.name, workspace.directory, directoryKey, workspace.createdAt]);
      } catch (error) {
        if (duplicate(error)) throw new AppError('workspace_exists', 'A workspace with this ID or folder already exists', 409);
        throw error;
      }
      await this.insertMember(db, lead);
      if (models) await db.execute('INSERT INTO workspace_models (workspace_id, data) VALUES (?, ?)', [workspace.workspaceId, encode(models)]);
      if (bootstrap) {
        await db.execute('INSERT INTO workspace_git_baselines (workspace_id, data) VALUES (?, ?)', [workspace.workspaceId, encode(bootstrap.baseline)]);
        await db.execute('INSERT INTO member_activation (workspace_id, revision, time) VALUES (?, ?, ?)', [workspace.workspaceId, bootstrap.activation.revision, bootstrap.activation.time]);
        await this.writeContext(db, workspace.workspaceId, 0, bootstrap.context);
      }
    });
  }

  async getWorkspaceModels(workspaceId: string): Promise<StoredWorkspaceModels | null> {
    const [row] = await rows(this.pool, 'SELECT revision, data FROM workspace_models WHERE workspace_id = ?', [workspaceId]);
    return row ? { revision: Number(row.revision), value: decode<WorkspaceModels>(row.data, value => { workspaceModels(value, true); }) } : null;
  }
  async saveWorkspaceModels(workspaceId: string, expected: number | null, value: WorkspaceModels, initializeLead: boolean): Promise<StoredWorkspaceModels> {
    return this.transaction(async db => {
      if (!(await rows(db, 'SELECT id FROM workspaces WHERE id = ? FOR UPDATE', [workspaceId])).length) throw new AppError('not_found', 'Workspace not found', 404);
      const [previous] = await rows(db, 'SELECT revision FROM workspace_models WHERE workspace_id = ?', [workspaceId]);
      if (previous ? Number(previous.revision) !== expected : expected !== null) throw new AppError('config_conflict', 'Workspace models changed', 409);
      const revision = previous ? Number(previous.revision) + 1 : initializeLead ? 1 : 0;
      if (previous) await db.execute('UPDATE workspace_models SET revision = ?, data = ? WHERE workspace_id = ?', [revision, encode(value), workspaceId]);
      else await db.execute('INSERT INTO workspace_models (workspace_id, revision, data) VALUES (?, ?, ?)', [workspaceId, revision, encode(value)]);
      if (initializeLead) {
        const [row] = await rows(db, 'SELECT id, workspace_id, revision, data FROM members WHERE workspace_id = ? AND is_lead = 1', [workspaceId]);
        if (row) {
          const lead = memberRow(row);
          if (lead.value.settings.connectionId === null && lead.value.settings.modelId === null) {
            const defaults = defaultRunSettings(value);
            const settings = { ...lead.value.settings, connectionId: defaults.connectionId, modelId: defaults.modelId, modelOptions: defaults.modelOptions };
            const next = { ...lead.value, settings };
            next.configuration = generatedSource(next, lead.id);
            if (lead.value.configuration) next.configuration.path = lead.value.configuration.path;
            await db.execute('UPDATE members SET data = ?, revision = revision + 1 WHERE id = ?', [encode(next), lead.id]);
          }
        }
      }
      return { revision, value };
    });
  }

  /** The sequence number and current files from one snapshot. */
  loadContext(workspaceId: string): Promise<{ seq: number; files: IndexedFile[] }> {
    return this.transaction(async db => {
      const [workspace] = await rows(db, 'SELECT seq FROM workspaces WHERE id = ?', [workspaceId]);
      if (!workspace) throw new AppError('not_found', `Workspace ${workspaceId} not found`, 404);
      const files = await rows(db, `SELECT f.path, f.file_id, f.revision, f.hash, f.size, f.mtime_ms, v.time, v.author, v.reason
        FROM context_files f JOIN context_versions v ON v.workspace_id = f.workspace_id AND v.revision = f.revision
        WHERE f.workspace_id = ?`, [workspaceId]);
      return {
        seq: Number(workspace.seq),
        files: files.map(row => ({
          path: row.path as string, fileId: row.file_id as string, revision: row.revision as string, hash: row.hash as string, size: Number(row.size),
          mtimeMs: Number(row.mtime_ms), updatedAt: Number(row.time), author: decode<Author>(row.author, validateAuthor), reason: row.reason as string | null,
        })),
      };
    });
  }

  /** Stores one change. The sequence check refuses the commit if another writer advanced the workspace. */
  async commitContext(workspaceId: string, expectedSeq: number, commit: ContextCommit): Promise<void> {
    await this.transaction(db => this.writeContext(db, workspaceId, expectedSeq, commit));
  }
  private async writeContext(db: PoolConnection, workspaceId: string, expectedSeq: number, commit: ContextCommit): Promise<void> {
    const [result] = await db.execute<ResultSetHeader>('UPDATE workspaces SET seq = ? WHERE id = ? AND seq = ?', [commit.seq, workspaceId, expectedSeq]);
    if (result.affectedRows !== 1) throw new AppError('backend_error', 'The context base changed outside this process', 503);
    for (const blob of commit.blobs) await db.execute('INSERT IGNORE INTO context_blobs (workspace_id, hash, content, size) VALUES (?, ?, ?, ?)', [workspaceId, blob.hash, blob.content, blob.size]);
    await insertRows(db, 'INSERT INTO context_versions (workspace_id, file_id, seq, revision, action, path, path_key, from_path, hash, size, time, author, reason) VALUES ?', commit.versions.map(version => [
      workspaceId, version.fileId, version.seq, version.revision, version.action, version.path, version.path.toLowerCase(), version.fromPath, version.hash, version.size, version.time, encode(version.author), version.reason,
    ]));
    for (let start = 0; start < commit.removeKeys.length; start += 500) {
      await db.query('DELETE FROM context_files WHERE workspace_id = ? AND path_key IN (?)', [workspaceId, commit.removeKeys.slice(start, start + 500)]);
    }
    await insertRows(db, 'INSERT INTO context_files (workspace_id, path_key, path, file_id, revision, hash, size, mtime_ms) VALUES ?', commit.files.map(file => [
      workspaceId, file.path.toLowerCase(), file.path, file.fileId, file.revision, file.hash, file.size, file.mtimeMs,
    ]));
    await db.execute('INSERT INTO context_records (workspace_id, seq, data) VALUES (?, ?, ?)', [workspaceId, commit.seq, encode(commit.record)]);
  }

  async blob(workspaceId: string, hash: string): Promise<string | null> {
    const [row] = await rows(this.pool, 'SELECT content FROM context_blobs WHERE workspace_id = ? AND hash = ?', [workspaceId, hash]);
    return row ? row.content as string : null;
  }

  async version(workspaceId: string, revision: string): Promise<StoredVersion | null> {
    const [row] = await rows(this.pool, 'SELECT * FROM context_versions WHERE workspace_id = ? AND revision = ?', [workspaceId, revision]);
    return row ? versionRow(row) : null;
  }

  async history(workspaceId: string, fileId: string, before: number | null, limit: number): Promise<StoredVersion[]> {
    const result = before === null
      ? await rows(this.pool, `SELECT * FROM context_versions WHERE workspace_id = ? AND file_id = ? ORDER BY seq DESC${limitClause(limit)}`, [workspaceId, fileId])
      : await rows(this.pool, `SELECT * FROM context_versions WHERE workspace_id = ? AND file_id = ? AND seq < ? ORDER BY seq DESC${limitClause(limit)}`, [workspaceId, fileId, before]);
    return result.map(versionRow);
  }

  /** At equal sequence numbers a file created at the path wins over one deleted from it. */
  async lastFileId(workspaceId: string, pathKey: string): Promise<string | null> {
    const [row] = await rows(this.pool, `SELECT file_id FROM context_versions WHERE workspace_id = ? AND path_key = ? ORDER BY seq DESC, (action = 'delete') ASC${limitClause(1)}`, [workspaceId, pathKey]);
    return row ? row.file_id as string : null;
  }

  async records(workspaceId: string, after: number, limit: number): Promise<ChangeRecord[]> {
    const result = await rows(this.pool, `SELECT data FROM context_records WHERE workspace_id = ? AND seq > ? ORDER BY seq${limitClause(limit)}`, [workspaceId, after]);
    return result.map(row => decode<ChangeRecord>(row.data, validateChangeRecord));
  }
}
