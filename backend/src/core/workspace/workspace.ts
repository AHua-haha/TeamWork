import { legacyBaseline, type GitBaseline } from './workspace-git.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, realpath, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { ContextBase, type ContextOverview, type ContextStore, type WorkspaceRecord } from './data/context-base.js';
import { ProjectFiles } from './project-files.js';
import { inspectManagedState, type WorkspaceInitialization } from './workspace-initialization.js';
import { prepareWorkspace } from '../workspace-bootstrap.js';
import { rootDesignPath } from './workspace-layout.js';
import { missing, sha256 } from '../text.js';
import { AppError, identity } from '../agent/data/model.js';
import type { RunSettings } from '../team/data/config.js';
import { defaultRunSettings, emptyWorkspaceModels, modelRunSettings, workspaceModels, type WorkspaceModelsView } from './data/models.js';

export interface Workspace extends WorkspaceRecord { context: ContextOverview }
export interface WorkspaceInput { workspaceId?: unknown; name: unknown; directory: unknown; adopt: unknown; models: unknown; cleanupRevision?: unknown }

const controlCharacter = /[\u0000-\u001f\u007f-\u009f]/;
const folderKey = (directory: string) => directory.toLowerCase();
const within = (folder: string, path: string) => path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep);

/** Registers workspaces and opens each one's context base on first use. */
export class WorkspaceService {
  private readonly bases = new Map<string, Promise<ContextBase>>();
  private readonly records = new Map<string, WorkspaceRecord>();
  private creating: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(private readonly store: ContextStore, private readonly config: { issuesFor(settings: readonly RunSettings[]): Promise<string[][]> }) {}

  async gitBaseline(workspaceId: string): Promise<GitBaseline> {
    const previous = await this.store.getGitBaseline(workspaceId);
    if(previous)return previous;
    const record=await this.record(workspaceId), legacy=await legacyBaseline(record.directory);
    // Import accepted bytes once, never materialize them over pending files.
    const design=legacy?.design ?? {};
    if(!legacy){
      const state=await this.store.loadContext(workspaceId);
      for(const file of state.files)if(file.path.startsWith('design/')){
        let before:number|null=null;
        do {const versions=await this.store.history(workspaceId,file.fileId,before,100);const user=versions.find(v=>v.author.type==='user');
          if(user){if(user.hash){const content=await this.store.blob(workspaceId,user.hash);if(content!==null)design[`.rsi/context/${user.path}`]=content;}break;}
          before=versions.length===100?versions.at(-1)!.seq:null;
        }while(before!==null);
      }
    }
    const members=legacy?.members ?? {};
    if(!Object.keys(members).length){
      // Existing active bundles are a bootstrap fallback, not a live mirror.
      Object.assign(members,await this.store.initialMemberFiles?.(workspaceId)??{});
    }
    return this.store.initializeGitBaseline(workspaceId,{time:legacy?.time??record.createdAt,design,members});
  }

  async models(workspaceId: string): Promise<WorkspaceModelsView> {
    await this.record(workspaceId);
    const stored = await this.store.getWorkspaceModels(workspaceId);
    const result = stored ?? { revision: 0, value: emptyWorkspaceModels() };
    const issues = result.value.models.length ? (await this.config.issuesFor(result.value.models.map(modelRunSettings))).flat() : ['Configure workspace models and a default'];
    return { ...result, issues };
  }
  async defaultSettings(workspaceId: string): Promise<RunSettings> { return defaultRunSettings((await this.models(workspaceId)).value); }
  async initializeModels(workspaceId: string, settings: RunSettings[]): Promise<void> {
    if (await this.store.getWorkspaceModels(workspaceId)) return;
    const models = new Map<string, ReturnType<typeof modelRunSettings>['modelOptions'][number]>();
    for (const item of settings) {
      if (!item.connectionId || !item.modelId) continue;
      const selected = item.modelOptions.find(m => m.connectionId === item.connectionId && m.modelId === item.modelId) ?? { connectionId: item.connectionId, modelId: item.modelId };
      const key = JSON.stringify([selected.connectionId, selected.modelId]);
      if (!models.has(key)) models.set(key, selected);
    }
    const choices = [...models.values()], first = choices[0];
    await this.store.saveWorkspaceModels(workspaceId, null, { models: choices, defaultModel: first ? { connectionId: first.connectionId, modelId: first.modelId } : null }, false);
  }
  private async validateModels(value: unknown) {
    const models = workspaceModels(value);
    const issues = (await this.config.issuesFor(models.models.map(modelRunSettings))).flat();
    if (issues.length) throw new AppError('invalid_config', issues.join('; '));
    return models;
  }
  async updateModels(workspaceId: string, revision: number, value: unknown): Promise<WorkspaceModelsView> {
    await this.record(workspaceId);
    const models = await this.validateModels(value);
    const previous = await this.store.getWorkspaceModels(workspaceId);
    if (!previous && revision !== 0) throw new AppError('config_conflict', 'Workspace models changed', 409);
    const saved = await this.store.saveWorkspaceModels(workspaceId, previous ? revision : null, models, true);
    return { ...saved, issues: [] };
  }

  async list(): Promise<WorkspaceRecord[]> {
    this.assertOpen();
    return this.store.listWorkspaces();
  }

  async get(workspaceId: string): Promise<Workspace> {
    const record = await this.record(workspaceId);
    return { ...record, context: await (await this.context(workspaceId)).overview() };
  }

  async context(workspaceId: string): Promise<ContextBase> {
    this.assertOpen();
    let opening = this.bases.get(workspaceId);
    if (!opening) {
      const started = this.record(workspaceId).then(record => ContextBase.open(this.store, record));
      // A failed open is retried by the next request, for example after the folder returns.
      started.catch(() => { if (this.bases.get(workspaceId) === started) this.bases.delete(workspaceId); });
      this.bases.set(workspaceId, started);
      opening = started;
    }
    return opening;
  }

  async files(workspaceId: string): Promise<ProjectFiles> {
    return new ProjectFiles((await this.record(workspaceId)).directory);
  }

  /** Read-only review; existing registrations cannot be cleaned through initialization. */
  async inspectInitialization(input: {directory: unknown; adopt: unknown}): Promise<WorkspaceInitialization> {
    this.validateDirectory(input);
    await this.creating;
    this.assertOpen();
    const directory = await this.planDirectory(input.directory, input.adopt);
    if (!input.adopt) return {directory, cleanupPaths: [], cleanupRevision: null};
    return inspectManagedState(directory);
  }

  private validateDirectory(input: {directory: unknown; adopt: unknown}): asserts input is {directory: string; adopt: boolean} {
    if (typeof input.directory !== 'string' || !isAbsolute(input.directory) || input.directory.length > 1024) throw new AppError('invalid_input', 'directory is an absolute path of at most 1024 characters');
    if (typeof input.adopt !== 'boolean') throw new AppError('invalid_input', 'adopt is true or false');
  }

  private async planDirectory(directory: string, adopt: boolean): Promise<string> {
    const planned = adopt ? await existingFolder(directory) : await newFolder(directory);
    const key = folderKey(planned);
    for (const other of await this.store.listWorkspaces()) {
      const otherKey = folderKey(other.directory);
      if (within(otherKey, key) || within(key, otherKey)) throw new AppError('workspace_exists', `${directory} overlaps workspace ${other.name}`, 409);
    }
    return planned;
  }

  async create(input: WorkspaceInput): Promise<Workspace> {
    const workspaceId = input.workspaceId === undefined ? randomUUID() : input.workspaceId;
    identity(workspaceId, 'workspaceId');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200 || controlCharacter.test(input.name)) throw new AppError('invalid_input', 'name has 1–200 characters without control characters');
    this.validateDirectory(input);
    if (input.cleanupRevision !== undefined && (typeof input.cleanupRevision !== 'string' || !/^[a-f0-9]{64}$/.test(input.cleanupRevision))) throw new AppError('invalid_input', 'cleanupRevision must be the reviewed initialization revision');
    const models = await this.validateModels(input.models);
    const { name, directory, adopt } = input;
    // One create at a time, so the overlap check sees every earlier workspace.
    const created = this.creating.then(async () => {
      this.assertOpen();
      if (await this.store.getWorkspace(workspaceId)) throw new AppError('workspace_exists', `Workspace ${workspaceId} already exists`, 409);
      await this.planDirectory(directory, adopt);
      const made = adopt ? undefined : await mkdir(directory, { recursive: true });
      let prepared: Awaited<ReturnType<typeof prepareWorkspace>> | undefined;
      try {
        const record: WorkspaceRecord = { workspaceId, name, directory: await realpath(directory), createdAt: Date.now() };
        prepared = await prepareWorkspace(record, defaultRunSettings(models), input.cleanupRevision as string | undefined);
        const {lead, bootstrap} = prepared;
        await this.store.createWorkspace(record, sha256(folderKey(record.directory)), lead, models, bootstrap);
        this.records.set(workspaceId, record);
      } catch (error) {
        await prepared?.files.rollback();
        if (made) await rm(made, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      await prepared.files.finish();
    });
    this.creating = created.catch(() => undefined);
    return created.then(() => this.get(workspaceId));
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.creating;
    await Promise.allSettled([...this.bases.values()].map(async opening => (await opening).close()));
    this.bases.clear();
  }

  private assertOpen(): void {
    if (this.closed) throw new AppError('workspace_unavailable', 'Workspaces are closed', 503);
  }

  /** The registered workspace, or 404 `not_found`. */
  async record(workspaceId: string): Promise<WorkspaceRecord> {
    this.assertOpen();
    identity(workspaceId, 'workspaceId');
    const cached = this.records.get(workspaceId);
    if (cached) return cached;
    const record = await this.store.getWorkspace(workspaceId);
    if (!record) throw new AppError('not_found', `Workspace ${workspaceId} not found`, 404);
    this.records.set(workspaceId, record);
    return record;
  }
}

/** The real path of a folder to adopt. */
async function existingFolder(directory: string): Promise<string> {
  let real: string;
  try { real = await realpath(directory); }
  catch (error) {
    if (missing(error)) throw new AppError('not_found', `${directory} does not exist`, 404);
    throw error;
  }
  if (!(await stat(real)).isDirectory()) throw new AppError('invalid_input', `${directory} is not a folder`);
  return real;
}

/** The real path a new project folder will have. An existing folder must be empty. */
async function newFolder(directory: string): Promise<string> {
  try {
    const real = await realpath(directory);
    if (!(await stat(real)).isDirectory() || (await readdir(real)).length) throw new AppError('file_exists', `${directory} already exists and is not an empty folder`, 409);
    return real;
  } catch (error) {
    if (!missing(error)) throw error;
  }
  const names: string[] = [];
  for (let current = directory; ; current = dirname(current)) {
    if (dirname(current) === current) throw new AppError('invalid_input', `${directory} has no existing parent folder`);
    names.unshift(basename(current));
    try {
      const real = await realpath(dirname(current));
      if (!(await stat(real)).isDirectory()) throw new AppError('invalid_input', `${dirname(current)} is not a folder`);
      return join(real, ...names);
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
}
