import type { DesignSummary, Member } from '../../shared/backend-client/index.js';

export const designReference = (path: string) => path.replace(/^\.rsi\/context\/design\//i, '').replace(/^design\//i, '');
export const sameDesign = (a: string, b: string) => designReference(a).toLowerCase() === designReference(b).toLowerCase();
export const designName = (path: string) => designReference(path).toLowerCase() === 'metadata.json' ? 'Project' : path.replace(/\/metadata\.json$/i, '').split('/').at(-1) || path;
export const designTitle = (content: string, path: string) => /^#{1,6}\s+(.+?)\s*#*\s*$/m.exec(content)?.[1] || designName(path);

export function designMembers(path: string, members: readonly Member[]) {
  return {
    working: members.filter(member => member.harness.designScope.working.some(ref => sameDesign(ref, path))),
    dependencies: members.filter(member => member.harness.designScope.dependencies.some(ref => sameDesign(ref, path))),
  };
}
export function memberDesigns(member: Member, designs: readonly DesignSummary[]) {
  const resolve = (paths: string[]) => paths.map(path => ({ path, design: designs.find(design => sameDesign(design.path, path)) ?? null }));
  return { working: resolve(member.harness.designScope.working), dependencies: resolve(member.harness.designScope.dependencies) };
}
export function implementationAccess(path: string, dependencies: readonly string[]): 'Read only' | 'Read and edit' {
  return dependencies.some(scope => scope === '.' || path.toLowerCase() === scope.toLowerCase() || path.toLowerCase().startsWith(scope.toLowerCase() + '/')) ? 'Read only' : 'Read and edit';
}
