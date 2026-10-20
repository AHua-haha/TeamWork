import { seedDesign } from './design-fixture.js';
import { after } from 'node:test';
import { closeBashRuntime } from '../src/harness-command.js';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResolvedRunConfig } from '../src/config.js';
import type { ConfigService, RunSettings } from '../src/config.js';
import type { RunHost } from '../src/team-runner.js';
import { TeamSystem } from '../src/team-system.js';
import type { MemberView } from '../src/team.js';
import { AppError, type RunState } from '../src/types.js';
import { WorkspaceService } from '../src/workspace.js';
import { testModels, testModelValidator, MemoryStore, withFolder } from './memory-store.js';

export const ready: Partial<RunSettings> = { connectionId: 'conn', modelId: 'model' };
after(closeBashRuntime);
export const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;
export const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };

/** The config service as the team uses it: a member is ready when it names a model. */
export const stubConfig = {
  issuesFor: async (settings: readonly RunSettings[]) => settings.map(item => (item.connectionId && item.modelId ? [] : ['Select a provider and model'])),
  listConnections: async () => [{ id: 'conn', revision: 0, value: { label: 'Test', provider: 'faux', baseUrl: 'http://localhost', api: 'openai-completions', keyConfigured: false } }],
  modelChoices: async () => [{ modelId: 'model', reasoning: false, verified: true }],
  getApp: async () => ({ id: 'settings', revision: 0, value: { title: 'Test', maxInputBytes: 1024 * 1024, allowAgentCreation: true } }),
} as unknown as ConfigService;

export interface FakeRun {
  agentId: string; runId: string; input: unknown;
  status: RunState['status']; text: string; error: string | null; cancelled: boolean;
  settle(status: RunState['status'], text?: string, error?: string): void;
  done: Promise<void>;
}

const stateOf = (run: FakeRun): RunState => ({
  agentId: run.agentId, runId: run.runId, status: run.status, phase: run.status === 'running' ? 'model' : 'finished', step: 1, startedAt: 0,
  endedAt: run.status === 'running' ? null : 1, endPosition: run.status === 'running' ? null : 1, activeMessageId: null,
  error: run.error === null ? null : { code: 'model_error', message: run.error },
});

/** A runtime whose runs end when the test says so. One run per agent at a time, as in the real one. */
export class FakeRuntime implements RunHost {
  readonly runs: FakeRun[] = [];
  constructor(private readonly store?: MemoryStore) {
    if (store) store.onPublicationComplete = runId => this.find(runId).settle('completed');
  }
  async prepareRun(): Promise<ResolvedRunConfig> { return { model: { input: ['text', 'image'] } } as ResolvedRunConfig; }
  launch(run: RunState): void { void this.start(run.agentId, undefined, run.runId); }
  clearProgress(): void {}
  async feedback(): Promise<void> {}
  private readonly startWaiters = new Map<string, (() => void)[]>();
  started(agentId: string): Promise<void> {
    if (this.active(agentId)) return Promise.resolve();
    return new Promise(resolve => { const waiters = this.startWaiters.get(agentId) ?? []; waiters.push(resolve); this.startWaiters.set(agentId, waiters); });
  }

  async start(agentId: string, input: unknown, persistedId?: string): Promise<RunState> {
    if (this.active(agentId)) throw new AppError('agent_busy', 'Agent already has an active run', 409);
    const store = this.store;
    if (store && persistedId) void store.prepareMemberContext(agentId, persistedId, []);
    let end!: () => void;
    const done = new Promise<void>(resolve => { end = resolve; });
    const run: FakeRun = {
      agentId, runId: persistedId ?? `run${this.runs.length + 1}`, input, status: 'running', text: '', error: null, cancelled: false, done,
      settle(status, text = '', error) {
        if (run.status !== 'running') return;
        run.status = status;
        run.text = text;
        run.error = error ?? null;
        const stored = store?.chatRuns.get(run.runId)?.run;
        if (stored) Object.assign(stored, stateOf(run));
        store?.finishEntry(stateOf(run));
        store?.finishContext(run.agentId, run.runId);
        end();
      },
    };
    this.runs.push(run);
    for (const resolve of this.startWaiters.get(agentId) ?? []) resolve();
    this.startWaiters.delete(agentId);
    return stateOf(run);
  }

  async finished(agentId: string, runId: string): Promise<RunState> {
    const run = this.find(runId);
    await run.done;
    return stateOf(run);
  }

  async finalText(_agentId: string, runId: string): Promise<string> {
    return this.find(runId).text;
  }

  async getState(agentId: string) {
    const run = this.last(agentId);
    return { agentId, contextRevision: 0, historyPosition: 0, run: run ? stateOf(run) : null };
  }

  async cancel(_agentId: string, runId: string): Promise<void> {
    const run = this.find(runId);
    if (run.status !== 'running') return;
    run.cancelled = true;
    run.settle('cancelled');
  }

  /** Ends the active run of an agent with a final response. */
  end(agentId: string, text = 'Done.'): void {
    this.active(agentId)?.settle('completed', text);
  }

  fail(agentId: string, message: string): void {
    this.active(agentId)?.settle('failed', '', message);
  }

  active(agentId: string): FakeRun | undefined {
    return this.runs.find(item => item.agentId === agentId && item.status === 'running');
  }

  last(agentId: string): FakeRun | undefined {
    return this.runs.findLast(item => item.agentId === agentId);
  }

  private find(runId: string): FakeRun {
    return this.runs.find(item => item.runId === runId)!;
  }
}

export interface Fixture {
  folder: string;
  store: MemoryStore;
  workspaces: WorkspaceService;
  team: TeamSystem;
  runtime: FakeRuntime;
  workspaceId: string;
  directory: string;
  lead: MemberView;
}

/** A workspace with its team, over a fresh store and a fake runtime. The lead is given a model, so it can run. */
export function withTeam(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  return withFolder(async folder => {
    const store = new MemoryStore();
    const workspaces = new WorkspaceService(store, testModelValidator);
    const team = new TeamSystem(store, workspaces, stubConfig);
    const runtime = new FakeRuntime(store);
    team.attach(runtime);
    try {
      const root = await realpath(folder);
      const directory = join(root, 'project');
      const { workspaceId } = await workspaces.create({ workspaceId: 'w1', name: 'Project', directory, models: testModels(), adopt: false });
      const lead = (await team.service.team(workspaceId)).members[0]!;
      await run({ folder: root, store, workspaces, team, runtime, workspaceId, directory, lead });
    } finally {
      await team.runner.close();
      await workspaces.close();
    }
  });
}

/** Creates a worker that can run. */
export async function worker(fixture: Fixture, name: string, implementation: string[] = ['.'], role = 'developer'): Promise<MemberView> {
  const path = `systems/${name.toLowerCase()}/metadata.json`;
  await seedDesign(fixture.workspaces, fixture.workspaceId, path, { content: `Design for ${name}`, implementation });
  return fixture.team.service.create(fixture.workspaceId, { name, role, responsibility: `Owns ${name}`, harness: { designScope: { working: [path], dependencies: [] }, allowedCommands: [] } });
}

/** User-side assignment update for fixtures. Agent edits remain pending until a future activation workflow. */
export async function configureHarness(fixture: Fixture, name: string, harness: unknown) {
  const member = (await fixture.team.service.byName(fixture.workspaceId, name))!;
  const { implementationScope: _effective, ...assignment } = harness as Record<string, unknown>;
  harness = assignment;
  return fixture.team.service.update(fixture.workspaceId, member.id, member.revision, { name: member.value.name, role: member.value.role, responsibility: member.value.responsibility, settings: member.value.settings, harness });
}
