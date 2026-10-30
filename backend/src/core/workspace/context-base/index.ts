import {randomUUID,createHash} from 'node:crypto';
import {posix} from 'node:path';
import {AppError} from '../../errors.js';
import {freezeContextIndex, type ContextDiagnostic, type ContextIndexSnapshot, type DesignSystemMetadata} from '../data/context-index.js';
import {workspaceContext} from '../project-context.js';
import {ContextFilesystem,defaultContextExclusions,missing,relativeProjectPath} from './filesystem.js';
import {emptyConsumerMetadata,metadataHeader,parseConsumerMetadata} from './metadata.js';

export type {ContextIndexSnapshot,ContextDiagnostic,DesignSystemMetadata,ProjectContextNode,ConsumerMetadata} from '../data/context-index.js';
export interface ContextManagerOptions {
  excludedDirectories?: readonly string[];
  maxProjectEntries?: number;
  maxContextEntries?: number;
  maxMetadataBytes?: number;
  maxFileBytes?: number;
  maxConsumerBytes?: number;
  maxConsumerFiles?: number;
}
export interface ConsumerContext {
  revision: string;
  projectPath: string;
  readme: {path: string; content: string};
  files: {path: string; content: string}[];
}
const hash = (header: string | null) => createHash('sha256').update(header === null ? 'absent' : `header:${header}`).digest('hex');

/** One resident metadata index per workspace. Filesystem-only authority; refresh is explicit. */
export class ContextBaseManager {
  private readonly files: ContextFilesystem;
  private readonly limits: Required<Omit<ContextManagerOptions,'excludedDirectories'>>;
  private readonly epoch = randomUUID();
  private generation = 0;
  private current: ContextIndexSnapshot | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(readonly directory: string, options: ContextManagerOptions = {}) {
    this.files = new ContextFilesystem(directory,new Set(['.git','.rsi',...(options.excludedDirectories ?? defaultContextExclusions)]));
    const {excludedDirectories: _excluded,...limits} = options;
    this.limits = {maxProjectEntries:50_000,maxContextEntries:10_000,maxMetadataBytes:64*1024,maxFileBytes:1024*1024,maxConsumerBytes:4*1024*1024,maxConsumerFiles:200,...limits};
    for (const [key,value] of Object.entries(this.limits)) if (!Number.isSafeInteger(value) || value < 1) throw new AppError('invalid_config',`Invalid context manager limit: ${key}`);
  }

  snapshot(): ContextIndexSnapshot | null {return this.current;}

  refresh(): Promise<ContextIndexSnapshot> {
    if (this.closed) return Promise.reject(new AppError('workspace_unavailable','Context manager is closed',503));
    const refresh = this.queue.catch(()=>undefined).then(()=>this.scan());
    this.queue = refresh;
    return refresh;
  }

  private async scan(): Promise<ContextIndexSnapshot> {
    await this.files.verifyRoot();
    const layout = await workspaceContext(this.directory), diagnostics: ContextDiagnostic[] = [];
    const {tree,nodes} = await this.files.tree(this.limits.maxProjectEntries,diagnostics);
    const systems: Record<string,DesignSystemMetadata> = Object.create(null);
      const pending = [layout.root]; let examined = 0;
      while (pending.length) {
        const directory = pending.pop()!;
        let entries;
        try {entries = await this.files.entries(directory);} catch(error) {if (missing(error)) continue; throw error;}
        for (const entry of entries) {
          if (++examined > this.limits.maxContextEntries) throw new AppError('context_limit','Context tree entry limit exceeded');
          const path = `${directory}/${entry.name}`;
          if (!entry.isDirectory()) {
            if (entry.isSymbolicLink()) diagnostics.push({path,code:'unsupported_entry',message:'Symbolic context entries are not traversed',severity:'warning'});
            continue;
          }
          const own = entry.name === '_ctx', file = entry.name.endsWith('.ctx');
          if (!own && !file) {pending.push(path);continue;}
          const mirror = posix.relative(layout.root,directory);
          const projectPath = own ? mirror || '.' : posix.join(mirror,entry.name.slice(0,-4));
          const node = nodes.get(projectPath);
          if (!node || node.kind !== (own ? 'directory' : 'file')) {
            diagnostics.push({path,code:'unrepresented_node',message:'Context entry does not correspond to an included source node of the expected type',severity:'error'});continue;
          }
          const design = `${path}/DESIGN.md`;
          try {if (!(await this.files.info(design)).isFile()) throw new AppError('invalid_design','DESIGN.md must be a regular file');}
          catch(error) {diagnostics.push({path:design,code:'invalid_design',message:error instanceof Error ? error.message : 'Missing DESIGN.md',severity:'error'});continue;}
          const system: DesignSystemMetadata = {projectPath,kind:node.kind,contextDirectory:path,designReference:posix.relative(layout.root,design),documents:{design},metadata:emptyConsumerMetadata(),metadataValid:true};
          const readme = `${path}/README.md`;
          try {
            const info = await this.files.info(readme);
            system.documents.readme = readme;
            if (!info.isFile()) throw new AppError('invalid_metadata','README.md must be a regular file');
            const header = await this.files.header(readme,this.limits.maxMetadataBytes);
            system.metadata = parseConsumerMetadata(header); system.readmeHeaderHash = hash(header);
          } catch(error) {
            if (!missing(error)) {
              system.documents.readme = readme;
              system.metadataValid = false;
              diagnostics.push({path:readme,code:'invalid_metadata',message:error instanceof Error ? error.message : 'Invalid README metadata',severity:'error'});
            }
          }
          systems[projectPath] = system; node.designSystemPath = projectPath;
        }
      }
    const snapshot = freezeContextIndex({revision:`${this.epoch}:${++this.generation}`,refreshedAt:Date.now(),contextRoot:layout.root,format:layout.kind,tree,designSystems:systems,diagnostics});
    this.current = snapshot;
    return snapshot;
  }

  design(projectPath: string, snapshot = this.requireSnapshot()): DesignSystemMetadata {
    if (this.closed) throw new AppError('workspace_unavailable','Context manager is closed',503);
    const path = relativeProjectPath(projectPath), system = snapshot.designSystems[path];
    if (!system) throw new AppError('not_found',`No design system is bound to ${path}`,404);
    return system;
  }

  async loadDesign(projectPath: string, snapshot = this.requireSnapshot()): Promise<{path:string;content:string}> {
    const system = this.design(projectPath,snapshot);
    try {return {path:system.documents.design,content:await this.files.text(system.documents.design,this.limits.maxFileBytes)};}
    catch(error) {if (missing(error)) throw new AppError('context_changed','Design document disappeared; explicitly refresh the context index',409);throw error;}
  }

  async loadConsumerContext(projectPath: string, snapshot = this.requireSnapshot()): Promise<ConsumerContext> {
    if (this.closed) throw new AppError('workspace_unavailable','Context manager is closed',503);
    const system = this.design(projectPath,snapshot), readmePath = system.documents.readme;
    if (!readmePath) throw new AppError('consumer_context_unavailable',`${projectPath} has no README consumer context`,404);
    if (!system.metadataValid) throw new AppError('invalid_metadata',`${readmePath} has invalid metadata; fix it and refresh`);
    let content: string;
    try {content = await this.files.text(readmePath,Math.min(this.limits.maxFileBytes,this.limits.maxConsumerBytes));}
    catch(error) {if (missing(error)) throw new AppError('context_changed','README disappeared; explicitly refresh the context index',409);throw error;}
    if (hash(metadataHeader(content)) !== system.readmeHeaderHash) throw new AppError('context_changed','README metadata changed; explicitly refresh before loading consumer context',409);
    const result: ConsumerContext = {revision:snapshot.revision,projectPath:system.projectPath,readme:{path:readmePath,content},files:[]};
    let bytes = Buffer.byteLength(content), examined = 0;
    const seen = new Set<string>([readmePath]), directories = new Set<string>();
    const pending = [...system.metadata.include].reverse();
    while (pending.length) {
      const path = pending.pop()!;
      if (++examined > this.limits.maxProjectEntries) throw new AppError('context_limit','Consumer context traversal limit exceeded');
      let info;
      try {info = await this.files.info(path);} catch(error) {if (missing(error)) throw new AppError('not_found',`Included context path is missing: ${path}`,404);throw error;}
      if (info.isDirectory()) {
        if (directories.has(path)) continue; directories.add(path);
        const entries = await this.files.entries(path);
        for (const entry of entries.reverse()) if (!this.files.exclusions.has(entry.name)) pending.push(path === '.' ? entry.name : `${path}/${entry.name}`);
      } else if (!seen.has(path)) {
        if (result.files.length >= this.limits.maxConsumerFiles) throw new AppError('context_limit','Consumer context file limit exceeded');
        const text = await this.files.text(path,Math.min(this.limits.maxFileBytes,this.limits.maxConsumerBytes-bytes));
        bytes += Buffer.byteLength(text);seen.add(path);result.files.push({path,content:text});
      }
    }
    return result;
  }

  private requireSnapshot(): ContextIndexSnapshot {
    if (this.closed) throw new AppError('workspace_unavailable','Context manager is closed',503);
    if (!this.current) throw new AppError('context_not_refreshed','Explicitly refresh the context manager before reading its index',409);
    return this.current;
  }

  async close(): Promise<void> {this.closed = true;await this.queue.catch(()=>undefined);this.current = null;}
}
