import { writableContextPath } from '../src/ui/context-path.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkspaceClient, type Member, type DesignSummary } from '../src/client/workspace-client.js';
import { discussionInput, referenceLabel } from '../src/client/discussion-reference.js';
import { designMembers, designTitle, implementationAccess, memberDesigns } from '../src/ui/design-state.js';

const member = (name: string, working: string[], dependencies: string[]): Member => ({ memberId: name, name, workspaceId: 'w', revision: 0, role: 'developer', responsibility: '', lead: false, settings: { connectionId: 'c', modelId: 'm', toolOptionIds: [], prompt: '', promptOptionIds: [], modelOptions: [] }, ready: true, running: false, issues: [], harness: { designScope: { working, dependencies }, implementationScope: { paths: [], usePaths: [] }, allowedCommands: [] } });
const design: DesignSummary = { path: 'systems/api/metadata.json', revision: 'r', implementation: ['backend/api', 'shared/api.ts'] };

test('design relationships come from current harness references and empty membership preserves the design', () => {
  const backend = member('Backend', ['systems/API/metadata.json'], []);
  const frontend = member('Frontend', [], ['systems/api/metadata.json']);
  const unrelated = member('Other', ['other/metadata.json'], []);
  const result = designMembers(design.path, [backend, frontend, unrelated]);
  assert.deepEqual([result.working.map(item => item.name), result.dependencies.map(item => item.name)], [['Backend'], ['Frontend']]);
  assert.deepEqual(designMembers(design.path, []), { working: [], dependencies: [] });
  const scopes = memberDesigns(member('Member', [design.path], ['missing/metadata.json']), [design]);
  assert.equal(scopes.working[0]!.design, design);
  assert.equal(scopes.dependencies[0]!.design, null);
  assert.equal(designTitle('# API contract\n\nSome text', design.path), 'API contract');
  assert.equal(designTitle('Plain text', design.path), 'api');
});

test('dependency mappings take precedence on equal, ancestor, and whole-project scopes without hiding sibling working paths', () => {
  assert.equal(implementationAccess('backend/api', ['backend']), 'Read only');
  assert.equal(implementationAccess('backend/api', ['BACKEND/API']), 'Read only');
  assert.equal(implementationAccess('backend/api', ['.']), 'Read only');
  assert.equal(implementationAccess('backend', ['backend/api']), 'Read and edit');
  assert.equal(implementationAccess('backend/api-other', ['backend/api']), 'Read and edit');
});

test('discussion references add only a named reference to user input and never include stored design content', () => {
  const ref = { kind: 'design' as const, path: design.path };
  assert.equal(referenceLabel(ref), 'Design · systems/api/metadata.json');
  assert.equal(discussionInput('Please clarify the API.', ref), 'Regarding design .rsi/context/systems/api/metadata.json:\n\nPlease clarify the API.');
  assert.equal(discussionInput('My draft', null), 'My draft');
  assert.equal(discussionInput('Change responsibility', { kind: 'member', memberId: 'm1', name: 'Backend' }), 'Regarding team member Backend (member ID m1):\n\nChange responsibility');
});

test('design client uses read-only current semantic endpoints with encoded paths', async () => {
  const calls: string[] = [];
  const client = new WorkspaceClient((async input => {
    calls.push(String(input));
    return new Response(JSON.stringify(String(input).includes('/file?') ? { path: design.path, design: { content: '# API', implementation: design.implementation, documents:[{path:'systems/api/design.md',content:'# API'}] }, designIssue: null } : { designs: [design], truncated: false }));
  }) as typeof fetch);
  assert.deepEqual((await client.designs('w 1')).designs, [design]);
  assert.equal((await client.readDesign('w 1', 'systems/api/metadata.json')).design?.content, '# API');
  assert.deepEqual(calls, ['/workspaces/w%201/designs', '/workspaces/w%201/designs/file?path=systems%2Fapi%2Fmetadata.json']);
});


test('unified context file controls distinguish design documents from implementation context at the first boundary',()=>{
  assert.equal(writableContextPath('backend/metadata.json'),true);
  assert.equal(writableContextPath('backend/design/request-flow.md'),true);
  assert.equal(writableContextPath('backend/design/impl/topic.md'),true);
  assert.equal(writableContextPath('backend/impl/contracts.md'),false);
  assert.equal(writableContextPath('impl.md'),false);
});
