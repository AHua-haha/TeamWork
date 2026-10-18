import { AppError } from './types.js';
import { contextPath } from './context-path.js';
export const managedRoot = '.rsi';
export const contextRoot = `${managedRoot}/context`;
export const designRoot = `${contextRoot}/design`;
export const implementRoot = `${contextRoot}/implement`;
export const memberRoot = `${managedRoot}/members`;
export const rootDesignPath = 'metadata.json';

/** System references are relative to the design root, independently of document form. */
export function nodeReference(value: string): string {
  const path = contextPath(value.replace(/^\.rsi\/context\/design\//i, '').replace(/^design\//i, ''));
  const segments = path.split('/');
  if (segments.at(-1)?.toLowerCase() !== 'metadata.json' || segments.slice(0,-1).some(s => ['design','impl'].includes(s.toLowerCase()) || /\.(md|json)$/i.test(s))) throw new AppError('invalid_path', 'A system reference names metadata.json beneath system-node folders');
  return path;
}
export const nodePrefix = (reference: string) => nodeReference(reference).slice(0, -'metadata.json'.length);
export const metadataPath = (reference: string) => contextPath(`design/${nodeReference(reference)}`);
/** Raw context paths include their purpose root; both roots use the same system hierarchy. */
export function contextPaths(reference: string, kind: 'design' | 'impl'): string[] {
  const prefix = `${kind === 'design' ? 'design' : 'implement'}/${nodePrefix(reference)}`;
  return [contextPath(`${prefix}${kind}.md`), contextPath(`${prefix}${kind}`)];
}
export const designContextPaths = (reference: string) => [metadataPath(reference), ...contextPaths(reference,'design')];
export function implementationContextPath(reference: string): string { return contextPaths(reference,'impl')[0]!; }
export interface ContextLocation { node: string; kind: 'metadata' | 'design' | 'impl' | 'node'; area: 'design' | 'implement' }
/** The root selects purpose; topic directories retain the enclosing system boundary. */
export function contextLocation(path: string): ContextLocation | null {
  const [area,...segments] = path.toLowerCase().split('/');
  if (area !== 'design' && area !== 'implement') return null;
  const kind = area === 'design' ? 'design' : 'impl';
  if (!segments.length) return {node:rootDesignPath,kind:'node',area};
  for (let i=0;i<segments.length;i++) {
    const segment=segments[i]!, prefix=segments.slice(0,i).join('/'), node=prefix ? `${prefix}/metadata.json` : rootDesignPath;
    if (segment === 'metadata.json') return area==='design' && i===segments.length-1 ? {node,kind:'metadata',area} : null;
    if (segment === `${kind}.md`) return i===segments.length-1 ? {node,kind,area} : null;
    if (segment === kind) return {node,kind,area};
    if (segment==='design'||segment==='impl'||/\.(md|json)$/i.test(segment)) return null;
  }
  return {node:`${segments.join('/')}/metadata.json`,kind:'node',area};
}
export const implementationContextFile = (path: string) => path.toLowerCase()==='implement'||path.toLowerCase().startsWith('implement/');
