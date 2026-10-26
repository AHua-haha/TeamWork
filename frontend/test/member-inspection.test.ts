import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceClient, type Member, type DesignSummary } from '../src/shared/backend-client/workspace-client.js';
import { memberTree } from '../src/features/workspace/member-tree.js';
import { TeamTab } from '../src/features/workspace/TeamTab.js';
import { MemberTree } from '../src/features/workspace/MemberTree.js';
import { FileDiff } from '../src/features/workspace/FileDiff.js';
import { diffLines } from '../src/features/workspace/file-diff.js';

const member = (id: string, working: string[], dependencies: string[] = []): Member => ({ memberId: id, workspaceId: 'w', revision: 1, name: id, role: 'developer', responsibility: 'Own assigned design', lead: id === 'Lead', ready: true, running: false, issues: [], settings: { connectionId: 'c', modelId: 'm', toolOptionIds: [], promptOptionIds: [], prompt: '', modelOptions: [] }, harness: { designScope: { working, dependencies }, implementationScope: { paths: [], usePaths: [] }, allowedCommands: [] } });
const design = (path: string): DesignSummary => ({ path, revision: 'r', implementation: [] });
const patch = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -4,2 +4,3 @@\n same\n-old\n+<script>alert(1)</script>\n+new\n\\ No newline at end of file\n';

test('member ownership follows folder paths, supports multiple owners/assignments and preserves missing/unassigned designs', () => {
  const a = member('A', ['backend/api/metadata.json', 'frontend/ui/metadata.json']);
  const b = member('B', ['backend/API/metadata.json']);
  const dependent = member('Dependency', [], ['backend/api/metadata.json']);
  const missing = member('Missing', ['legacy/missing/metadata.json']);
  const tree = memberTree([design('backend/api/metadata.json'),design('frontend/ui/metadata.json'),design('frontend/a11y/metadata.json')], [a,b,dependent,missing]);
  assert.deepEqual(tree.map(n => n.name), ['backend','frontend','legacy']);
  assert.deepEqual(tree[0]!.children[0]!.members.map(m => m.name), ['A','B']);
  assert.deepEqual(tree[1]!.children.find(n => n.name === 'ui')!.members.map(m => m.name), ['A']);
  assert.deepEqual(tree[1]!.children.find(n => n.name === 'a11y')!.members, []);
  assert.equal(tree[2]!.children[0]!.unavailable,true);
  assert.equal(tree[0]!.children[0]!.members.includes(dependent),false);
});

test('the member tree retains file labels with attached cards and includes lead/unassigned workspace members', () => {
  const members = [member('Lead',[]),member('Backend',['backend/api/metadata.json']),member('Dependency',[],['backend/api/metadata.json'])];
  const html = renderToStaticMarkup(createElement(MemberTree,{name:'Project',designs:[design('backend/api/metadata.json')],members,selected:null,onSelect(){},onDesign(){}}));
  assert.match(html,/Open Lead active details/); assert.match(html,/Open Dependency active details/);
  assert.match(html,/member-card-connector/); assert.match(html,/api/); assert.match(html,/member-attached-cards/);
  assert.ok(!html.includes('Activate committed')); assert.ok(!html.includes('File changes'));
});

test('unified diff parsing preserves independent line numbers, multiple hunks, literal text and binary notices', () => {
  const lines = diffLines(patch+'@@ -20 +21 @@\n-other\n+replacement\n');
  assert.deepEqual(lines.filter(l => l.kind === 'delete').map(l=>l.before),[5,20]);
  assert.deepEqual(lines.filter(l => l.kind === 'add').map(l=>l.after),[5,6,21]);
  assert.equal(lines.find(l=>l.kind==='add')!.text,'<script>alert(1)</script>');
  assert.equal(diffLines('Binary files a/file and b/file differ\n')[0]!.kind,'note');
  const html = renderToStaticMarkup(createElement(FileDiff,{files:[{path:'.rsi/members/backend/member.json',action:'modify',patch,truncated:false}],selected:null,onSelect(){}}));
  assert.match(html,/Changed files/); assert.match(html,/Unified diff/); assert.match(html,/&lt;script&gt;/);
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('Configuration operations')); assert.ok(!html.includes('<details'));
});

test('current review and activation clients send distinct exact-state payloads', async () => {
  const calls: {path:string;body:unknown}[]=[];
  const client = new WorkspaceClient((async (input,init)=>{calls.push({path:String(input),body:init?.body?JSON.parse(String(init.body)):null});return new Response('{}');}) as typeof fetch);
  await client.currentMemberConfiguration('w 1');
  await client.activateMemberConfiguration('w 1',{revision:'committed',digest:'review'});
  assert.deepEqual(calls,[{path:'/workspaces/w%201/team/configuration/current',body:null},{path:'/workspaces/w%201/team/configuration/activate',body:{revision:'committed',digest:'review'}}]);
});

test('Changes reads use the lightweight review and separate committed validation endpoints', async () => {
  const calls: string[] = [];
  const client = new WorkspaceClient((async input => { calls.push(String(input)); return new Response('{}'); }) as typeof fetch);
  await client.changes('w 1');
  await client.committedMemberReview('w 1');
  assert.deepEqual(calls, ['/workspaces/w%201/team/changes', '/workspaces/w%201/team/configuration?source=committed']);
});

// A removed design can become a directory while its active assignment still exists.
test('unavailable file assignments remain visible when that path now contains designs', () => {
  const members = [member('Previous',['backend/metadata.json']), member('Current',['backend/api/metadata.json'])];
  const designs = [design('backend/api/metadata.json')];
  const tree = memberTree(designs,members);
  assert.equal(tree[0]!.folder,true);
  assert.equal(tree[0]!.unavailable,true);
  const html = renderToStaticMarkup(createElement(MemberTree,{name:'Project',designs,members,selected:null,onSelect(){},onDesign(){}}));
  assert.match(html,/Open Previous active details/);
  assert.match(html,/Open Current active details/);
});


test('the shared pending file diff supports design/member paths and an empty review without approval controls', () => {
  const files = [{ path: '.rsi/context/design/backend/design.md', action: 'add' as const, patch, truncated: false }, { path: '.rsi/members/backend/member.json', action: 'modify' as const, patch, truncated: false }];
  const html = renderToStaticMarkup(createElement(FileDiff, { files, selected: files[1]!.path, onSelect() {} }));
  assert.match(html, /Design/); assert.match(html, /Members/); assert.match(html, /Committed → current/);
  assert.match(html, /Diff for .rsi\/members\/backend\/member.json/); assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('Approve members'));
  assert.match(renderToStaticMarkup(createElement(FileDiff, { files: [], selected: null, onSelect() {} })), /No pending design or member changes/);
});


test('Team contains active member information without a configuration change subpage', () => {
  const lead = member('Lead', ['metadata.json']); lead.lead = true;
  const html = renderToStaticMarkup(createElement(TeamTab, {
    team: { team: { workspaceId: 'w', members: [lead] }, loading: false, error: null, refresh: async () => {} },
    workspace: { workspaceId: 'w', name: 'Project', directory: '/tmp/project', createdAt: 1, context: { workspaceId: 'w', seq: 1, files: 3, bytes: 20, problems: [] } },
    designs: [design('metadata.json')], selected: null, onSelect() {}, onDesign() {}, onImplementation() {}, onDiscuss() {}, onBrowse() {},
  }));
  assert.match(html, /Open Lead active details/);
  assert.ok(!html.includes('Configuration changes')); assert.ok(!html.includes('Approve members')); assert.ok(!html.includes('team-view-tabs'));
});
