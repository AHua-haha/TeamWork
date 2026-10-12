import { createHash, randomUUID } from 'node:crypto';
import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import type { AssistantMessageEvent, UserMessage } from '@earendil-works/pi-ai';
import { decode, encode, validateAuthor, validateChangeRecord, validateEntries, validateEvent, validateRun } from './codec.js';
import type { Author, ChangeRecord, ContextCommit, ContextStore, FileAction, IndexedFile, StoredVersion, WorkspaceRecord } from './context-base.js';
import type { MemberRecord, NewMember, StoredMember, TeamStore } from './team.js';
import { AppError, identity, position, type CompletedMessage, type ContextEntry, type ContextHistory, type CurrentState, type FollowSnapshot, type LiveRange, type Retention, type RunState, type RunStatus } from './types.js';

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
  `CREATE TABLE IF NOT EXISTS agents (
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
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
  `CREATE TABLE IF NOT EXISTS live_messages (
    id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    run_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    next_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
    first_available BIGINT UNSIGNED NOT NULL DEFAULT 0,
    FOREIGN KEY (run_id) REFERENCES runs(id)
  ) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS chunks (
    message_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    sequence BIGINT UNSIGNED NOT NULL, event JSON NOT NULL, bytes INT UNSIGNED NOT NULL,
    PRIMARY KEY(message_id, sequence),
    FOREIGN KEY (message_id) REFERENCES live_messages(id) ON DELETE CASCADE
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
];

/** All writers lock the agent row first. Follow reads use a repeatable-read snapshot. */
export class MySqlStore implements ContextStore, TeamStore {
  readonly pool: Pool;
  private lease?: PoolConnection;
  private leaseError?: Error;
  private leaseListener?: (error: Error) => void;
  private readonly lockName: string;

  constructor(url: string) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'mysql:' || !parsed.pathname.slice(1)) throw new AppError('invalid_config', 'DATABASE_URL must name a MySQL database');
    this.pool = mysql.createPool({ uri: url, connectionLimit: 10, supportBigNumbers: true, bigNumberStrings: false, charset: 'utf8mb4' });
    this.lockName = `rsi:${createHash('sha256').update(decodeURIComponent(parsed.pathname)).digest('hex').slice(0, 56)}`;
  }

  async migrate(): Promise<void> {
    for (const statement of schema) await this.pool.query(statement);
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
    try { await this.releaseRuntime(); } finally { await this.pool.end(); }
  }

  private async transaction<T>(fn: (connection: PoolConnection) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await connection.beginTransaction();
      const result = await fn(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY') {
        throw new AppError('conflict', 'Identity or position already exists', 409);
      }
      throw error;
    } finally { connection.release(); }
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

  async beginMessage(agentId: string, runId: string, messageId: string, step: number): Promise<void> {
    identity(messageId, 'messageId');
    await this.transaction(async db => {
      const agent = await this.agent(db, agentId, true);
      const run = await this.active(db, agent, runId);
      if (run.activeMessageId) throw new AppError('conflict', 'A model message is already active', 409);
      await db.execute('INSERT INTO live_messages (id, run_id) VALUES (?, ?)', [messageId, runId]);
      await this.saveRun(db, { ...run, phase: 'model', step, activeMessageId: messageId });
    });
  }

  async appendChunk(agentId: string, runId: string, messageId: string, event: AssistantMessageEvent, retention: Retention): Promise<void> {
    validateEvent(event);
    const serialized = encode(event); // Copy mutable Pi partials before the first await.
    position(retention.maxChunks);
    position(retention.maxBytes);
    await this.transaction(async db => {
      const agent = await this.agent(db, agentId, true);
      const run = await this.active(db, agent, runId);
      if (run.activeMessageId !== messageId) throw new AppError('conflict', 'Chunk does not belong to the active message', 409);
      const [live] = await rows(db, 'SELECT * FROM live_messages WHERE id = ?', [messageId]);
      if (!live) throw new AppError('corrupt_data', 'Active message descriptor missing', 500);
      const next = live.next_sequence;
      await db.execute('INSERT INTO chunks (message_id, sequence, event, bytes) VALUES (?, ?, ?, ?)', [messageId, next, serialized, Buffer.byteLength(serialized)]);
      const sizes = await rows(db, 'SELECT sequence, bytes FROM chunks WHERE message_id = ? ORDER BY sequence DESC', [messageId]);
      let bytes = 0;
      let keep = 0;
      let first = next + 1;
      for (const row of sizes) {
        if (keep >= retention.maxChunks || bytes + row.bytes > retention.maxBytes) break;
        bytes += row.bytes;
        keep++;
        first = row.sequence;
      }
      await db.execute('DELETE FROM chunks WHERE message_id = ? AND sequence < ?', [messageId, first]);
      await db.execute('UPDATE live_messages SET next_sequence = ?, first_available = ? WHERE id = ?', [next + 1, first, messageId]);
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
        await db.execute('DELETE FROM live_messages WHERE id = ?', [entry.messageId]);
        await this.saveRun(db, { ...run, activeMessageId: null, phase: 'tools' });
      }
      return record;
    });
  }

  async finishRun(agentId: string, runId: string, status: Exclude<RunStatus, 'running'>, error: RunState['error'] = null): Promise<RunState> {
    return this.transaction(async db => {
      const agent = await this.agent(db, agentId, true);
      const run = await this.active(db, agent, runId);
      const finished: RunState = { ...run, status, phase: 'finished', activeMessageId: null, endedAt: Date.now(), endPosition: agent.history_position, error };
      await db.execute('DELETE FROM live_messages WHERE run_id = ?', [runId]);
      await this.saveRun(db, finished);
      await db.execute('UPDATE agents SET active_run_id = NULL WHERE id = ?', [agentId]);
      return finished;
    });
  }

  async recoverInterruptedRuns(): Promise<void> {
    this.assertRuntime();
    const active = await rows(this.pool, 'SELECT id, active_run_id FROM agents WHERE active_run_id IS NOT NULL');
    for (const agent of active) await this.finishRun(agent.id, agent.active_run_id, 'interrupted', { code: 'runtime_restarted', message: 'Runtime stopped before the run finished' });
  }

  async getState(agentId: string): Promise<CurrentState> {
    return (await this.followSnapshot(agentId, undefined, 0, false)).state;
  }

  async followSnapshot(agentId: string, runId: string | null | undefined = undefined, after = 0, includeHistory = true): Promise<FollowSnapshot> {
    position(after);
    return this.transaction(async db => {
      const agent = await this.agent(db, agentId);
      const selected = runId === undefined ? agent.latest_run_id : runId;
      const run = selected ? await this.run(db, agentId, selected) : null;
      const upper = run?.endPosition ?? agent.history_position;
      if (after > upper) throw new AppError('invalid_cursor', 'History cursor is ahead of this run', 409);
      const records = includeHistory ? await rows(db, 'SELECT * FROM messages WHERE agent_id = ? AND position > ? AND position <= ? ORDER BY position', [agentId, after, upper]) : [];
      const history = records.map(row => {
        const entry = decode<ContextEntry>(row.entry, value => validateEntries([value]));
        return { ...entry, agentId, runId: row.run_id as string, position: row.position as number };
      });
      let live: LiveRange | null = null;
      if (run?.activeMessageId) {
        const [descriptor] = await rows(db, 'SELECT * FROM live_messages WHERE id = ?', [run.activeMessageId]);
        if (!descriptor) throw new AppError('corrupt_data', 'Active message descriptor missing', 500);
        const chunks = await rows(db, 'SELECT sequence, event FROM chunks WHERE message_id = ? ORDER BY sequence', [run.activeMessageId]);
        live = { messageId: run.activeMessageId, firstAvailable: descriptor.first_available, nextSequence: descriptor.next_sequence, chunks: chunks.map(row => ({ sequence: row.sequence as number, event: decode<AssistantMessageEvent>(row.event, validateEvent) })) };
      }
      return { state: { agentId, contextRevision: agent.context_revision, historyPosition: upper, run }, history, live };
    });
  }

  /** The completed messages of one run, in order. A run is short, so this does not read the agent's whole history. */
  async runMessages(agentId: string, runId: string): Promise<CompletedMessage[]> {
    identity(agentId, 'agentId');
    identity(runId, 'runId');
    const records = await rows(this.pool, 'SELECT position, entry FROM messages WHERE agent_id = ? AND run_id = ? ORDER BY position', [agentId, runId]);
    return records.map(row => ({ ...decode<ContextEntry>(row.entry, value => validateEntries([value])), agentId, runId, position: row.position as number }));
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

  async createMember(member: NewMember): Promise<StoredMember> {
    return this.transaction(db => this.insertMember(db, member));
  }

  async updateMember(memberId: string, revision: number, nameKey: string | null, value: MemberRecord): Promise<StoredMember> {
    identity(memberId, 'memberId');
    position(revision);
    const data = encode(value);
    await this.transaction(async db => {
      let result: ResultSetHeader;
      try {
        [result] = await db.execute<ResultSetHeader>('UPDATE members SET data = ?, name_key = ?, revision = revision + 1 WHERE id = ? AND revision = ?', [data, nameKey, memberId, revision]);
      } catch (error) {
        throw memberConflict(error);
      }
      if (result.affectedRows) return;
      const [existing] = await rows(db, 'SELECT id FROM members WHERE id = ?', [memberId]);
      throw new AppError(existing ? 'config_conflict' : 'not_found', existing ? 'Member revision changed' : 'Member not found', existing ? 409 : 404);
    });
    return { id: memberId, workspaceId: value.workspaceId, revision: revision + 1, value: decode<MemberRecord>(data, () => undefined) };
  }

  async listWorkspaces(): Promise<WorkspaceRecord[]> {
    return (await rows(this.pool, 'SELECT id, name, directory, created_at FROM workspaces ORDER BY name, id')).map(workspaceRow);
  }

  async getWorkspace(workspaceId: string): Promise<WorkspaceRecord | null> {
    const [row] = await rows(this.pool, 'SELECT id, name, directory, created_at FROM workspaces WHERE id = ?', [workspaceId]);
    return row ? workspaceRow(row) : null;
  }

  /** Registers the workspace and its team's lead together; if either fails, neither is stored. */
  async createWorkspace(workspace: WorkspaceRecord, directoryKey: string, lead: NewMember): Promise<void> {
    await this.transaction(async db => {
      try {
        await db.execute('INSERT INTO workspaces (id, name, directory, directory_key, created_at) VALUES (?, ?, ?, ?, ?)', [workspace.workspaceId, workspace.name, workspace.directory, directoryKey, workspace.createdAt]);
      } catch (error) {
        if (duplicate(error)) throw new AppError('workspace_exists', 'A workspace with this ID or folder already exists', 409);
        throw error;
      }
      await this.insertMember(db, lead);
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
    await this.transaction(async db => {
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
    });
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
