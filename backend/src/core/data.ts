import type { PoolConnection } from 'mysql2/promise';
import type { MySqlStorage } from '../storage/mysql.js';
import { AgentData } from './agent/data/repository.js';
import { WorkspaceData } from './workspace/data/repository.js';
import { TeamData } from './team/data/repository.js';
import { ConfigData } from './team/data/config-repository.js';
/** Ownership composition and atomic cross-system lifecycle only; no business SQL/schema. */
export class CoreData {
    readonly agents: AgentData;
    readonly workspaces: WorkspaceData;
    readonly team: TeamData;
    readonly config: ConfigData;
    constructor(readonly storage: MySqlStorage) {
        this.agents = new AgentData(storage, {
            created: (db, id) => this.config.inTransaction(db).seedAgent(id),
            finished: (db, run) => this.team.inTransaction(db).observeRunFinished(run),
        });
        this.workspaces = new WorkspaceData(storage, {
            created: async (db, lead, bootstrap) => {
                const team = this.team.inTransaction(db);
                await team.createMember(lead);
                if (bootstrap)
                    await team.initializeActivation(lead.workspaceId, bootstrap.activation);
            },
            modelsChanged: (db, id, value) => this.team.inTransaction(db).initializeLeadModels(id, value),
            memberFiles: id => this.team.initialMemberFiles(id),
        });
        this.team = new TeamData(storage, this.agents, this.workspaces);
        this.config = new ConfigData(storage, this.agents, { contains: async (id, db) => !!await (db ? this.team.inTransaction(db) : this.team).getMember(id), ids: async () => (await this.team.contextMembers()).map(member => member.id) });
    }
    get pool() { return this.storage.pool; }
    async migrate(): Promise<void> {
        await this.agents.migrate();
        await this.workspaces.migrate();
        await this.team.migrate();
        await this.team.importChatHistory();
        await this.team.migrateGroupContext();
        const legacy = new Set(await this.agents.legacyContextIds());
        for (const member of legacy.size ? (await this.team.contextMembers()).filter(member => legacy.has(member.id)) : [])
            await this.storage.transaction(async (db) => {
                await this.agents.inTransaction(db).adoptLegacyContext(member.id, { id: member.workspaceId, read: after => this.team.inTransaction(db).readGroupContext(member.workspaceId, after) });
            });
        await this.agents.finishLegacyMigration();
    }
    /** The caller controls this transaction and its filesystem quarantine/rollback. */
    async resetRuntimeRecords(db: PoolConnection): Promise<void> {
        const agents = this.agents.inTransaction(db), team = this.team.inTransaction(db), workspaces = this.workspaces.inTransaction(db);
        await team.clearConversations();
        await agents.clearHistory();
        await team.clearMembers();
        await workspaces.clearRecords();
        await agents.deleteRecords();
        await this.config.inTransaction(db).clearAgentProfiles();
    }
    async close(): Promise<void> {
        try {
            await this.agents.releaseRuntime();
        }
        finally {
            this.team.close();
            await this.storage.close();
        }
    }
}
