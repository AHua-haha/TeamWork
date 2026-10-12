import { contextPath, type ContextFile, type DesignSave, type LeadAuthor } from './context-base.js';
import { projectPath } from './project-files.js';
import { AppError } from './types.js';
import { encodeText } from './text.js';
import type { WorkspaceService } from './workspace.js';

export interface DesignPart { content: string; implementation: string[] }
export interface ResolvedDesign extends DesignPart { path: string; revision: string }

export function designPath(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('invalid_input', 'A design reference is a path');
  const path = contextPath(value.replace(/^\.context\//, ''));
  if (!path.startsWith('user/')) throw new AppError('read_only', 'The user design belongs in user context', 403);
  return path;
}

export function implementationPath(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('invalid_path', 'An implementation reference is a project path');
  if (value === '.') return value;
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

  /** Discover designs by their valid record shape, independently of member references. */
  async list(workspaceId: string): Promise<{ designs: Omit<ResolvedDesign, 'content'>[]; truncated: boolean }> {
    const base = await this.workspaces.context(workspaceId);
    const listing = await base.tree('user', 16);
    const designs: Omit<ResolvedDesign, 'content'>[] = [];
    for (const entry of listing.entries) {
      if (entry.type !== 'file') continue;
      try {
        const file = await base.read({ path: entry.path });
        const { content: _content, ...summary } = parse(file);
        designs.push(summary);
      } catch (error) {
        if (!(error instanceof AppError) || error.status >= 500) throw error;
      }
    }
    return { designs: designs.sort((a, b) => a.path.localeCompare(b.path)), truncated: listing.truncated };
  }

  async read(workspaceId: string, path: unknown): Promise<ResolvedDesign> {
    return parse(await (await this.workspaces.context(workspaceId)).read({ path: designPath(path) }));
  }

  async inspect(workspaceId: string, path: unknown): Promise<ContextFile & { design: DesignPart | null; designIssue: string | null }> {
    const file = await (await this.workspaces.context(workspaceId)).read({ path: designPath(path) });
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
