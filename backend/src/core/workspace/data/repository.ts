import { validateAuthor, validateChangeRecord } from './validation.js';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { MySqlStorage } from '../../../storage/mysql.js';
import { decode, encode } from '../../codec.js';
import type { Author, ChangeRecord, ContextCommit, ContextStore, FileAction, IndexedFile, StoredVersion, WorkspaceRecord } from './context-base.js';
import type { NewMember } from '../../team/data/members.js';
import { workspaceModels, type WorkspaceModels, type StoredWorkspaceModels } from './models.js';
import type { WorkspaceBootstrap } from '../../workspace-bootstrap.js';
import { AppError } from '../../agent/data/model.js';
import { clearTables, dataTransaction, rows, insertRows, limitClause, duplicate, type DataConnection as Db } from '../../data-transaction.js';
import { schema } from './schema.js';
const workspaceRow = (row: RowDataPacket): WorkspaceRecord => ({ workspaceId: row.id as string, name: row.name as string, directory: row.directory as string, createdAt: Number(row.created_at) });
const versionRow = (row: RowDataPacket): StoredVersion => ({
    fileId: row.file_id as string, seq: Number(row.seq), revision: row.revision as string | null, action: row.action as FileAction,
    path: row.path as string, fromPath: row.from_path as string | null, hash: row.hash as string | null, size: row.size === null ? null : Number(row.size),
    time: Number(row.time), author: decode<Author>(row.author, validateAuthor), reason: row.reason as string | null,
});
export interface WorkspaceDataHooks {
    created(db: PoolConnection, lead: NewMember, bootstrap?: WorkspaceBootstrap): Promise<void>;
    modelsChanged?(db: PoolConnection, workspaceId: string, value: WorkspaceModels): Promise<void>;
    memberFiles?(workspaceId: string): Promise<Record<string, string>>;
}
export class WorkspaceData implements ContextStore {
    readonly pool: Db;
    constructor(readonly storage: MySqlStorage, private readonly hooks: WorkspaceDataHooks, private readonly connection?: PoolConnection) { this.pool = connection ?? storage.pool; }
    inTransaction(db: PoolConnection): WorkspaceData { return new WorkspaceData(this.storage, this.hooks, db); }
    private transaction<T>(fn: (db: PoolConnection) => Promise<T>): Promise<T> { return dataTransaction(this.storage, this.connection, fn); }
    async migrate(): Promise<void> {
        for (const statement of schema)
            await this.pool.query(statement);
    }
    async requireWorkspace(id: string, lock = false): Promise<void> {
        if (!(await rows(this.pool, `SELECT id FROM workspaces WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id])).length)
            throw new AppError('not_found', 'Workspace not found', 404);
    }
    initialMemberFiles(id: string): Promise<Record<string, string>> { return this.hooks.memberFiles?.(id) ?? Promise.resolve({}); }
    async getGitBaseline(workspaceId: string): Promise<import('../workspace-git.js').GitBaseline | null> {
        const [row] = await rows(this.pool, 'SELECT data FROM workspace_git_baselines WHERE workspace_id = ?', [workspaceId]);
        return row ? decode(row.data, () => undefined) : null;
    }
    async initializeGitBaseline(workspaceId: string, baseline: import('../workspace-git.js').GitBaseline) {
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
        await this.transaction(async (db) => {
            try {
                await db.execute('INSERT INTO workspaces (id, name, directory, directory_key, created_at) VALUES (?, ?, ?, ?, ?)', [workspace.workspaceId, workspace.name, workspace.directory, directoryKey, workspace.createdAt]);
            }
            catch (error) {
                if (duplicate(error))
                    throw new AppError('workspace_exists', 'A workspace with this ID or folder already exists', 409);
                throw error;
            }
            await this.hooks.created(db, lead, bootstrap);
            if (models)
                await db.execute('INSERT INTO workspace_models (workspace_id, data) VALUES (?, ?)', [workspace.workspaceId, encode(models)]);
            if (bootstrap) {
                await db.execute('INSERT INTO workspace_git_baselines (workspace_id, data) VALUES (?, ?)', [workspace.workspaceId, encode(bootstrap.baseline)]);
                await this.writeContext(db, workspace.workspaceId, 0, bootstrap.context);
            }
        });
    }
    async getWorkspaceModels(workspaceId: string): Promise<StoredWorkspaceModels | null> {
        const [row] = await rows(this.pool, 'SELECT revision, data FROM workspace_models WHERE workspace_id = ?', [workspaceId]);
        return row ? { revision: Number(row.revision), value: decode<WorkspaceModels>(row.data, value => { workspaceModels(value, true); }) } : null;
    }
    async saveWorkspaceModels(workspaceId: string, expected: number | null, value: WorkspaceModels, initializeLead: boolean): Promise<StoredWorkspaceModels> {
        return this.transaction(async (db) => {
            if (!(await rows(db, 'SELECT id FROM workspaces WHERE id = ? FOR UPDATE', [workspaceId])).length)
                throw new AppError('not_found', 'Workspace not found', 404);
            const [previous] = await rows(db, 'SELECT revision FROM workspace_models WHERE workspace_id = ?', [workspaceId]);
            if (previous ? Number(previous.revision) !== expected : expected !== null)
                throw new AppError('config_conflict', 'Workspace models changed', 409);
            const revision = previous ? Number(previous.revision) + 1 : initializeLead ? 1 : 0;
            if (previous)
                await db.execute('UPDATE workspace_models SET revision = ?, data = ? WHERE workspace_id = ?', [revision, encode(value), workspaceId]);
            else
                await db.execute('INSERT INTO workspace_models (workspace_id, revision, data) VALUES (?, ?, ?)', [workspaceId, revision, encode(value)]);
            if (initializeLead)
                await this.hooks.modelsChanged?.(db, workspaceId, value);
            return { revision, value };
        });
    }
    /** The sequence number and current files from one snapshot. */
    loadContext(workspaceId: string): Promise<{
        seq: number;
        files: IndexedFile[];
    }> {
        return this.transaction(async (db) => {
            const [workspace] = await rows(db, 'SELECT seq FROM workspaces WHERE id = ?', [workspaceId]);
            if (!workspace)
                throw new AppError('not_found', `Workspace ${workspaceId} not found`, 404);
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
        if (result.affectedRows !== 1)
            throw new AppError('backend_error', 'The context base changed outside this process', 503);
        for (const blob of commit.blobs)
            await db.execute('INSERT IGNORE INTO context_blobs (workspace_id, hash, content, size) VALUES (?, ?, ?, ?)', [workspaceId, blob.hash, blob.content, blob.size]);
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
    async clearRecords(): Promise<void> { await clearTables(this.pool, ['workspace_git_baselines', 'context_files', 'context_versions', 'context_blobs', 'context_records', 'workspace_models', 'workspaces']); }
}
