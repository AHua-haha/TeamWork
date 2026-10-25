import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { MySqlStorage } from '../../../storage/mysql.js';
import { decode, encode } from '../../codec.js';
import { AppError, identity, position } from '../../agent/data/model.js';
import { dataTransaction, rows, type DataConnection as Db } from '../../data-transaction.js';
import type { AgentData } from '../../agent/data/repository.js';
export type ConfigScope = 'app' | 'catalog' | 'connection' | 'model_cache' | 'agent';
export interface StoredConfig<T = unknown> {
    id: string;
    revision: number;
    value: T;
}
export class ConfigData {
    readonly pool: Db;
    constructor(readonly storage: MySqlStorage, readonly agents: AgentData, private readonly membership: {
        contains(id: string, db?: PoolConnection): Promise<boolean>;
        ids(): Promise<string[]>;
    }, private readonly connection?: PoolConnection) { this.pool = connection ?? storage.pool; }
    inTransaction(db: PoolConnection): ConfigData { return new ConfigData(this.storage, this.agents, this.membership, db); }
    private transaction<T>(fn: (db: PoolConnection) => Promise<T>): Promise<T> { return dataTransaction(this.storage, this.connection, fn); }
    async listAgents(): Promise<string[]> { const [ids, members] = await Promise.all([this.agents.listAgents(), this.membership.ids()]); const excluded = new Set(members); return ids.filter(id => !excluded.has(id)); }
    private configRow<T>(row: RowDataPacket): StoredConfig<T> {
        return { id: row.id as string, revision: row.revision as number, value: decode<T>(row.data, () => undefined) };
    }
    async getConfig<T>(scope: ConfigScope, id: string): Promise<StoredConfig<T>> {
        identity(id, 'config id');
        const [row] = await rows(this.pool, 'SELECT id, revision, data FROM config_records WHERE scope = ? AND id = ?', [scope, id]);
        if (!row)
            throw new AppError('not_found', 'Config record not found', 404);
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
            await this.transaction(async (db) => {
                if (scope === 'agent') {
                    await this.agents.inTransaction(db).executionState(id);
                    // A team member's conversation is not an agent with a config.
                    if (await this.membership.contains(id, db))
                        throw new AppError('not_found', 'Agent not found', 404);
                }
                await db.execute('INSERT INTO config_records (scope, id, data) VALUES (?, ?, ?)', [scope, id, data]);
            });
        }
        catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ER_DUP_ENTRY')
                throw new AppError('config_conflict', 'Config record already exists', 409);
            throw error;
        }
        return { id, revision: 0, value: decode<T>(data, () => undefined) };
    }
    async updateConfig<T>(scope: ConfigScope, id: string, revision: number, value: T, clearModelCache = false): Promise<StoredConfig<T>> {
        identity(id, 'config id');
        position(revision);
        const data = encode(value);
        await this.transaction(async (db) => {
            const [result] = await db.execute<ResultSetHeader>('UPDATE config_records SET data = ?, revision = revision + 1 WHERE scope = ? AND id = ? AND revision = ?', [data, scope, id, revision]);
            if (result.affectedRows) {
                if (clearModelCache)
                    await db.execute('DELETE FROM config_records WHERE scope = ? AND id = ?', ['model_cache', id]);
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
        await this.transaction(async (db) => {
            const [result] = await db.execute<ResultSetHeader>('DELETE FROM config_records WHERE scope = ? AND id = ? AND revision = ?', [scope, id, revision]);
            if (result.affectedRows) {
                if (clearModelCache)
                    await db.execute('DELETE FROM config_records WHERE scope = ? AND id = ?', ['model_cache', id]);
                return;
            }
            const [existing] = await rows(db, 'SELECT id FROM config_records WHERE scope = ? AND id = ?', [scope, id]);
            throw new AppError(existing ? 'config_conflict' : 'not_found', existing ? 'Config revision changed' : 'Config record not found', existing ? 409 : 404);
        });
    }
    async configBundle(agentId: string | null): Promise<{
        app: StoredConfig | null;
        agent: StoredConfig | null;
        catalog: StoredConfig[];
        connections: StoredConfig[];
        modelCaches: StoredConfig[];
    }> {
        if (agentId !== null)
            identity(agentId, 'agentId');
        return this.transaction(async (db) => {
            if (agentId !== null)
                await this.agents.inTransaction(db).executionState(agentId);
            const [app] = await rows(db, 'SELECT id, revision, data FROM config_records WHERE scope = ? AND id = ?', ['app', 'settings']);
            const [agent] = agentId === null ? [] : await rows(db, 'SELECT id, revision, data FROM config_records WHERE scope = ? AND id = ?', ['agent', agentId]);
            const catalog = await rows(db, 'SELECT id, revision, data FROM config_records WHERE scope = ? ORDER BY id', ['catalog']);
            const connections = await rows(db, 'SELECT id, revision, data FROM config_records WHERE scope = ? ORDER BY id', ['connection']);
            const modelCaches = await rows(db, 'SELECT id, revision, data FROM config_records WHERE scope = ? ORDER BY id', ['model_cache']);
            return { app: app ? this.configRow(app) : null, agent: agent ? this.configRow(agent) : null, catalog: catalog.map(row => this.configRow(row)), connections: connections.map(row => this.configRow(row)), modelCaches: modelCaches.map(row => this.configRow(row)) };
        });
    }
    async seedAgent(agentId: string): Promise<void> { await this.pool.execute('INSERT INTO config_records (scope,id,data) VALUES (?,?,?)', ['agent', agentId, encode({})]); }
    async clearAgentProfiles(): Promise<void> { await this.pool.execute("DELETE FROM config_records WHERE scope = 'agent'"); }
    async deleteAgentProfiles(ids: string[]): Promise<void> {
        for (const id of ids) await this.pool.execute("DELETE FROM config_records WHERE scope = 'agent' AND id = ?", [id]);
    }
}
