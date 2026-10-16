import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceClient, type Member, type DesignSummary } from '../src/client/workspace-client.js';
import { memberTree } from '../src/ui/member-tree.js';
import { MemberTree } from '../src/ui/MemberTree.js';
import { ConfigurationDiff } from '../src/ui/ConfigurationDiff.js';
import { diffLines } from '../src/ui/configuration-diff.js';

const member = (id: string, working: string[], dependencies: string[] = []): Member => ({ memberId: id, workspaceId: 'w', revision: 1, name: id, role: 'developer', responsibility: 'Own assigned design', lead: id === 'Lead', ready: true, running: false, issues: [], settings: { connectionId: 'c', modelId: 'm', toolOptionIds: [], promptOptionIds: [], prompt: '', modelOptions: [] }, harness: { designScope: { working, dependencies }, implementationScope: { paths: [], usePaths: [] }, allowedCommands: [] } });
const design = (path: string): DesignSummary => ({ path, revision: 'r', implementation: [] });
const patch = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -4,2 +4,3 @@\n same\n-old\n+<script>alert(1)</script>\n+new\n\\ No newline at end of file\n';

test('member ownership follows folder paths, supports multiple owners/assignments and preserves missing/unassigned designs', () => {
  const a = member('A', ['user/backend/api.json', 'user/frontend/ui.json']);
  const b = member('B', ['user/backend/API.json']);
  const dependent = member('Dependency', [], ['user/backend/api.json']);
  const missing = member('Missing', ['user/legacy/missing.json']);
  const tree = memberTree([design('user/backend/api.json'),design('user/frontend/ui.json'),design('user/frontend/a11y.json')], [a,b,dependent,missing]);
  assert.deepEqual(tree.map(n => n.name), ['backend','frontend','legacy']);
  assert.deepEqual(tree[0]!.children[0]!.members.map(m => m.name), ['A','B']);
  assert.deepEqual(tree[1]!.children.find(n => n.name === 'ui.json')!.members.map(m => m.name), ['A']);
  assert.deepEqual(tree[1]!.children.find(n => n.name === 'a11y.json')!.members, []);
  assert.equal(tree[2]!.children[0]!.unavailable,true);
  assert.equal(tree[0]!.children[0]!.members.includes(dependent),false);
});

test('the member tree retains file labels with attached cards and includes lead/unassigned workspace members', () => {
  const members = [member('Lead',[]),member('Backend',['user/backend/api.json']),member('Dependency',[],['user/backend/api.json'])];
  const html = renderToStaticMarkup(createElement(MemberTree,{name:'Project',designs:[design('user/backend/api.json')],members,selected:null,onSelect(){},onDesign(){}}));
  assert.match(html,/Open Lead active details/); assert.match(html,/Open Dependency active details/);
  assert.match(html,/member-card-connector/); assert.match(html,/api.json/); assert.match(html,/member-attached-cards/);
  assert.ok(!html.includes('Activate committed')); assert.ok(!html.includes('File changes'));
});

test('unified diff parsing preserves independent line numbers, multiple hunks, literal text and binary notices', () => {
  const lines = diffLines(patch+'@@ -20 +21 @@\n-other\n+replacement\n');
  assert.deepEqual(lines.filter(l => l.kind === 'delete').map(l=>l.before),[5,20]);
  assert.deepEqual(lines.filter(l => l.kind === 'add').map(l=>l.after),[5,6,21]);
  assert.equal(lines.find(l=>l.kind==='add')!.text,'<script>alert(1)</script>');
  assert.equal(diffLines('Binary files a/file and b/file differ\n')[0]!.kind,'note');
  const html = renderToStaticMarkup(createElement(ConfigurationDiff,{files:[{path:'.team/members/backend/member.json',action:'modify',patch,truncated:false}],selected:null,onSelect(){}}));
  assert.match(html,/Changed files/); assert.match(html,/Unified diff/); assert.match(html,/&lt;script&gt;/);
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('Configuration operations')); assert.ok(!html.includes('<details'));
});

test('current review, commit and activation clients send distinct exact-state payloads', async () => {
  const calls: {path:string;body:unknown}[]=[];
  const client = new WorkspaceClient((async (input,init)=>{calls.push({path:String(input),body:init?.body?JSON.parse(String(init.body)):null});return new Response('{}');}) as typeof fetch);
  await client.currentMemberConfiguration('w 1');
  await client.commitMemberConfiguration('w 1',{revision:'current',base:'committed',message:'Accept prompt'});
  await client.activateMemberConfiguration('w 1',{revision:'committed',digest:'review'});
  assert.deepEqual(calls,[{path:'/workspaces/w%201/team/configuration/current',body:null},{path:'/workspaces/w%201/team/configuration/commit',body:{revision:'current',base:'committed',message:'Accept prompt'}},{path:'/workspaces/w%201/team/configuration/activate',body:{revision:'committed',digest:'review'}}]);
});

// A removed design can become a directory while its active assignment still exists.
test('unavailable file assignments remain visible when that path now contains designs', () => {
  const members = [member('Previous',['user/backend']), member('Current',['user/backend/api.json'])];
  const designs = [design('user/backend/api.json')];
  const tree = memberTree(designs,members);
  assert.equal(tree[0]!.folder,true);
  assert.equal(tree[0]!.unavailable,true);
  const html = renderToStaticMarkup(createElement(MemberTree,{name:'Project',designs,members,selected:null,onSelect(){},onDesign(){}}));
  assert.match(html,/Open Previous active details/);
  assert.match(html,/Open Current active details/);
});
