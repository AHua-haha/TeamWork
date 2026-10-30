import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { MySqlStorage } from '../../../storage/mysql.js';
import { decode, encode } from '../../codec.js';
import type {WorkspaceStore,WorkspaceRecord,MemberBaseline} from './model.js';
import type { NewMember } from '../../team/data/members.js';
import { workspaceModels, type WorkspaceModels, type StoredWorkspaceModels } from './models.js';
import type { WorkspaceBootstrap } from '../../workspace-bootstrap.js';
import { AppError } from '../../agent/data/model.js';
import { clearTables, dataTransaction, rows, duplicate, type DataConnection as Db } from '../../data-transaction.js';
import {schema,retireContextHistory} from './schema.js';
const workspaceRow = (row: RowDataPacket): WorkspaceRecord => ({ workspaceId: row.id as string, name: row.name as string, directory: row.directory as string, createdAt: Number(row.created_at) });
export interface WorkspaceDataHooks {
    created(db: PoolConnection, lead: NewMember, bootstrap?: WorkspaceBootstrap): Promise<void>;
    modelsChanged?(db: PoolConnection, workspaceId: string, value: WorkspaceModels): Promise<void>;
    memberFiles?(workspaceId: string): Promise<Record<string, string>>;
}
export class WorkspaceData implements WorkspaceStore {
    readonly pool: Db;
    constructor(readonly storage: MySqlStorage, private readonly hooks: WorkspaceDataHooks, private readonly connection?: PoolConnection) { this.pool = connection ?? storage.pool; }
    inTransaction(db: PoolConnection): WorkspaceData { return new WorkspaceData(this.storage, this.hooks, db); }
    private transaction<T>(fn: (db: PoolConnection) => Promise<T>): Promise<T> { return dataTransaction(this.storage, this.connection, fn); }
    async migrate(): Promise<void> {
        for (const statement of schema)
            await this.pool.query(statement);
        await retireContextHistory(this.pool);
    }
    async requireWorkspace(id: string, lock = false): Promise<void> {
        if (!(await rows(this.pool, `SELECT id FROM workspaces WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id])).length)
            throw new AppError('not_found', 'Workspace not found', 404);
    }
    initialMemberFiles(id: string): Promise<Record<string, string>> { return this.hooks.memberFiles?.(id) ?? Promise.resolve({}); }
    async getMemberBaseline(workspaceId: string): Promise<MemberBaseline | null> {
        const [row] = await rows(this.pool, 'SELECT data FROM workspace_member_baselines WHERE workspace_id = ?', [workspaceId]);
        return row ? decode(row.data, () => undefined) : null;
    }
    async initializeMemberBaseline(workspaceId: string, baseline: MemberBaseline) {
        await this.pool.execute('INSERT IGNORE INTO workspace_member_baselines (workspace_id, data) VALUES (?, ?)', [workspaceId, encode(baseline)]);
        return (await this.getMemberBaseline(workspaceId))!;
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
                await db.execute('INSERT INTO workspace_member_baselines (workspace_id, data) VALUES (?, ?)', [workspace.workspaceId, encode(bootstrap.baseline)]);
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
    async clearRecords(): Promise<void> { await clearTables(this.pool, ['workspace_member_baselines','workspace_models','workspaces']); }
}
