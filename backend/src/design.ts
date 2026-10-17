import { contextPath, type ContextFile, type DesignSave, type LeadAuthor } from './context-base.js';
import { projectPath } from './project-files.js';
import { AppError } from './types.js';
import { encodeText } from './text.js';
import type { WorkspaceService } from './workspace.js';
import { join } from 'node:path';
import { lstat } from 'node:fs/promises';
import { HarnessHistory, harnessStorage } from './harness-history.js';

export interface DesignPart { content: string; implementation: string[] }
export interface ResolvedDesign extends DesignPart { path: string; revision: string }

export function designPath(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('invalid_input', 'A design reference is a path');
  const path = contextPath(value.replace(/^\.rsi\/context\//, ''));
  if (!path.startsWith('user/')) throw new AppError('read_only', 'The user design belongs in user context', 403);
  return path;
}

export function implementationPath(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('invalid_path', 'An implementation reference is a project path');
  if (value === '.') return value;
  if (value.toLowerCase() === '.rsi' || value.toLowerCase().startsWith('.rsi/')) throw new AppError('invalid_path', '.rsi is reserved for backend-managed state');
  return projectPath(value.replace(/\/+$/, '')).join('/');
}

export function designPart(value: unknown): DesignPart {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('invalid_design', 'A design is an object with content and implementation');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !['content', 'implementation'].includes(key)) || typeof data.content !== 'string' || !Array.isArray(data.implementation) || data.implementation.length > 50) throw new AppError('invalid_design', 'A design has text content and at most 50 implementation paths');
  const implementation = data.implementation.map(implementationPath);
  encodeText(data.content);
  if (new Set(implementation.map(path => path.toLowerCase())).size !== implementation.length) throw new AppError('invalid_design', 'A design has duplicate implementation paths');
  return { content: data.content, implementation };
}

function parse(file: ContextFile): ResolvedDesign {
  let value: unknown;
  try { value = JSON.parse(file.content); }
  catch { throw new AppError('invalid_design', `${file.path} is not a JSON design record with content and implementation`); }
  return { ...designPart(value), path: file.path, revision: file.revision };
}

/** User design and implementation mapping share one versioned context record. */
export class DesignService {
  constructor(private readonly workspaces: WorkspaceService) {}
  private async history(workspaceId: string): Promise<HarnessHistory | null> {
    const source = (await this.workspaces.record(workspaceId)).directory;
    const history = new HarnessHistory(harnessStorage(source), source);
    try { await lstat(join(history.repository, 'HEAD')); return history; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }
  private async file(workspaceId: string, path: string): Promise<ContextFile> {
    const accepted = await (await this.history(workspaceId))?.acceptedDesign(`.rsi/context/${path}`);
    if (accepted) {
      if (accepted.content === null) throw new AppError('not_found', 'This design was deleted in its accepted history', 404);
      return { path, content: accepted.content, size: Buffer.byteLength(accepted.content), revision: accepted.state.revision, updatedAt: accepted.state.time, current: true, author: { type: 'user' }, reason: accepted.state.message };
    }
    return (await this.workspaces.context(workspaceId)).read({ path });
  }

  /** Discover designs by their valid record shape, independently of member references. */
  async list(workspaceId: string): Promise<{ designs: Omit<ResolvedDesign, 'content'>[]; truncated: boolean }> {
    const base = await this.workspaces.context(workspaceId);
    const listing = await base.tree('user', 16);
    const designs: Omit<ResolvedDesign, 'content'>[] = [];
    const paths = new Set([...listing.entries.filter(entry => entry.type === 'file').map(entry => entry.path), ...await (await this.history(workspaceId))?.acceptedDesignPaths() ?? []]);
    for (const path of paths) {
      try {
        const file = await this.file(workspaceId, path);
        const { content: _content, ...summary } = parse(file);
        designs.push(summary);
      } catch (error) {
        if (!(error instanceof AppError) || error.status >= 500) throw error;
      }
    }
    return { designs: designs.sort((a, b) => a.path.localeCompare(b.path)), truncated: listing.truncated };
  }

  async read(workspaceId: string, path: unknown): Promise<ResolvedDesign> {
    return parse(await this.file(workspaceId, designPath(path)));
  }

  async inspect(workspaceId: string, path: unknown): Promise<ContextFile & { design: DesignPart | null; designIssue: string | null }> {
    const file = await this.file(workspaceId, designPath(path));
    try { const { content, implementation } = parse(file); return { ...file, design: { content, implementation }, designIssue: null }; }
    catch (error) { return { ...file, design: null, designIssue: error instanceof Error ? error.message : 'Invalid design' }; }
  }

  async save(workspaceId: string, path: unknown, value: unknown, baseRevision: string | null, reason: string, author: LeadAuthor): Promise<DesignSave & { design: DesignPart }> {
    const design = designPart(value);
    const content = JSON.stringify(design, null, 2) + '\n';
    const saved = await (await this.workspaces.context(workspaceId)).saveDesign(designPath(path), content, baseRevision, reason, author);
    return { ...saved, design };
  }
}
