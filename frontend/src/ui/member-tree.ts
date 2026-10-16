import type { DesignSummary, Member } from '../client/workspace-client.js';
import { sameDesign } from './design-state.js';

export interface MemberTreeNode { path: string; name: string; folder: boolean; children: MemberTreeNode[]; members: Member[]; unavailable: boolean }
/** Design folders are structure; only working references attach member cards. */
export function memberTree(designs: readonly DesignSummary[], members: readonly Member[]): MemberTreeNode[] {
  const nodes = new Map<string, MemberTreeNode>(), roots: MemberTreeNode[] = [];
  const paths = new Set([...designs.map(d => d.path), ...members.flatMap(m => m.harness.designScope.working)]);
  for (const path of paths) {
    const parts = path.replace(/^\.context\//, '').split('/');
    if (parts[0] === 'user') parts.shift();
    let parent = roots, prefix = 'user';
    for (const [index, name] of parts.entries()) {
      prefix += '/' + name; const key = prefix.toLowerCase();
      let node = nodes.get(key);
      if (!node) {
        node = { path: prefix, name, folder: index < parts.length - 1, children: [], members: [], unavailable: false };
        nodes.set(key, node); parent.push(node);
      }
      if (index < parts.length - 1) node.folder = true;
      if (index === parts.length - 1) {
        node.members = members.filter(member => member.harness.designScope.working.some(ref => sameDesign(ref, path)));
        node.unavailable = !designs.some(design => sameDesign(design.path, path));
      }
      parent = node.children;
    }
  }
  const sort = (items: MemberTreeNode[]) => { items.sort((a,b) => Number(b.folder)-Number(a.folder) || a.name.localeCompare(b.name)); for (const node of items) sort(node.children); };
  sort(roots); return roots;
}
