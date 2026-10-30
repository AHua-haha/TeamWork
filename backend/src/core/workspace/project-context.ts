import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { AppError } from '../errors.js';
import { contextPath } from './data/paths.js';

export const projectRootDesign = '_ctx/DESIGN.md';
export const projectDesignReference = (path: string): boolean => /(?:^|\/)(?:_ctx|[^/]+\.ctx)\/DESIGN\.md$/i.test(path);

/** A context directory is a design boundary; ordinary mirrored folders are not. */
export function projectNode(path: string): string {
  contextPath(path);
  if (!projectDesignReference(path)) throw new AppError('invalid_path', 'A design reference names _ctx/DESIGN.md or <file-name>.ctx/DESIGN.md');
  const parts = path.split('/'); parts.pop();
  const entry = parts.pop()!;
  if (parts.some(p => p.toLowerCase() === '_ctx' || p.toLowerCase().endsWith('.ctx')))
    throw new AppError('invalid_path', 'Context documents do not create nested design parts');
  if (entry.toLowerCase() !== '_ctx') parts.push(entry.slice(0, -4));
  return parts.join('/') || '.';
}

export interface ProjectContext {
  root: string;
  kind: 'project' | 'legacy';
  rootDesign: string;
}

async function directory(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new AppError('invalid_path', `Context root must be a real directory: ${path}`);
    return true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** Existing project roots survive checkout-directory renames; do not guess between two roots. */
export async function workspaceContext(directoryPath: string): Promise<ProjectContext> {
  const name = basename(directoryPath); contextPath(name);
  const preferred = `.rsi/${name}`;
  const roots: string[] = [];
  try {
    for (const entry of await readdir(join(directoryPath, '.rsi'), {withFileTypes: true})) {
      if (entry.name === 'context' || entry.name === 'members' || entry.name.startsWith('.')) continue;
      try {
        if (await directory(join(directoryPath, '.rsi', entry.name, '_ctx'))) {
          if (!entry.isDirectory() || entry.isSymbolicLink()) throw new AppError('invalid_path', 'Project context root cannot be a symbolic link');
          contextPath(entry.name); roots.push(`.rsi/${entry.name}`);
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error; }
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (roots.length > 1) throw new AppError('invalid_path', 'Multiple project context roots; choose one project-named context root');
  if (roots.length) {
    if (await directory(join(directoryPath, '.rsi/context'))) throw new AppError('invalid_path', 'Both legacy and project context roots exist; finish the context migration before opening');
    return {root: roots[0]!, kind: 'project', rootDesign: projectRootDesign};
  }
  if (await directory(join(directoryPath, '.rsi/context'))) return {root: '.rsi/context', kind: 'legacy', rootDesign: 'metadata.json'};
  if (['members', 'context', '_ctx'].includes(name.toLowerCase())) throw new AppError('invalid_path', 'Project directory name conflicts with a reserved RSI context name');
  return {root: preferred, kind: 'project', rootDesign: projectRootDesign};
}

/** Re-key accepted old bytes, never replace them with uncommitted current documents. */
export async function migratedBaseline(directoryPath: string, layout: ProjectContext, files: Record<string, string>): Promise<Record<string, string>> {
  if (layout.kind !== 'project' || !Object.keys(files).some(path => path.startsWith('.rsi/context/'))) return files;
  let data: {files?: unknown};
  try { data = JSON.parse(await readFile(join(directoryPath, layout.root, '_ctx/internal/context-migration.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return files; throw new AppError('invalid_design', 'Cannot read context migration mapping'); }
  if (!data || typeof data !== 'object' || !data.files || typeof data.files !== 'object' || Array.isArray(data.files)) throw new AppError('invalid_design', 'Invalid context migration file mapping');
  const mapping = data.files as Record<string, unknown>, result: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    const target = mapping[path];
    if (target === undefined) { result[path] = content; continue; }
    if (typeof target !== 'string' || !target.startsWith(layout.root+'/')) throw new AppError('invalid_design', 'Migrated file must remain inside its project context root');
    contextPath(target.slice(layout.root.length+1));
    if (Object.hasOwn(result, target)) throw new AppError('invalid_design', 'Migrated context paths collide');
    result[target] = content;
  }
  return result;
}

/** Explicit migration aliases preserve active member references without modifying SQL/config history. */
export async function migratedReference(directoryPath: string, layout: ProjectContext, reference: string): Promise<string> {
  if (layout.kind !== 'project' || projectDesignReference(reference)) return reference;
  const file = join(directoryPath, layout.root, '_ctx/internal/context-migration.json');
  let data: unknown;
  try { data = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reference; throw new AppError('invalid_design', 'Cannot read context migration aliases'); }
  if (!data || typeof data !== 'object' || !('references' in data) || !(data.references && typeof data.references === 'object'))
    throw new AppError('invalid_design', 'Invalid context migration aliases');
  const match = Object.entries(data.references).find(([key]) => key.toLowerCase() === reference.toLowerCase());
  if (!match) throw new AppError('not_found', `No migrated design for ${reference}`, 404);
  if (typeof match[1] !== 'string') throw new AppError('invalid_design', 'Invalid migrated design reference');
  projectNode(match[1]); return match[1];
}
