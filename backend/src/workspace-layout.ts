import { AppError } from './types.js';
import { contextPath } from './context-path.js';
export const managedRoot = '.rsi';
export const contextRoot = `${managedRoot}/context`;
export const designRoot = contextRoot;
export const memberRoot = `${managedRoot}/members`;
export const rootDesignPath = 'metadata.json';

/** Node references point to metadata, independent of document size/representation. */
export function nodeReference(value: string): string {
  const path = contextPath(value.replace(/^\.rsi\/context\//, ''));
  const segments = path.split('/');
  if (segments.at(-1)?.toLowerCase() !== 'metadata.json' || segments.slice(0,-1).some(s => ['design','impl'].includes(s.toLowerCase()) || /\.(md|json)$/i.test(s))) throw new AppError('invalid_path', 'A system reference names metadata.json beneath system-node folders');
  return path;
}
export const nodePrefix = (reference: string) => nodeReference(reference).slice(0, -'metadata.json'.length);
export function contextPaths(reference: string, kind: 'design' | 'impl'): string[] {
  const prefix = nodePrefix(reference);
  return [contextPath(`${prefix}${kind}.md`), contextPath(`${prefix}${kind}`)];
}
export function implementationContextPath(reference: string): string { return contextPaths(reference,'impl')[0]!; }
export interface ContextLocation { node: string; kind: 'metadata' | 'design' | 'impl' | 'node' }
/** Reserved content directories contain documents, never nested system nodes. */
export function contextLocation(path: string): ContextLocation | null {
  const segments = path.toLowerCase().split('/');
  for (let i=0;i<segments.length;i++) {
    const segment=segments[i]!, prefix=segments.slice(0,i).join('/'), node=prefix ? `${prefix}/metadata.json` : rootDesignPath;
    if (segment === 'metadata.json') return i===segments.length-1 ? {node,kind:'metadata'} : null;
    for (const kind of ['design','impl'] as const) {
      if (segment === `${kind}.md`) return i===segments.length-1 ? {node,kind} : null;
      if (segment === kind) return {node,kind};
    }
    if (/\.(md|json)$/i.test(segment)) return null;
  }
  return {node:`${path.toLowerCase()}/metadata.json`,kind:'node'};
}
export const implementationContextFile = (path: string) => contextLocation(path)?.kind === 'impl';
