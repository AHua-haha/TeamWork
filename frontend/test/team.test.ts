import assert from 'node:assert/strict';
import test from 'node:test';
import { BackendError } from '../src/shared/backend-client/agent-client.js';
import { WorkspaceClient } from '../src/shared/backend-client/workspace-client.js';
import { readRoute, routeUrl, sameRoute } from '../src/app/routes.js';
import { callRecipient, toolHeading, toolLabels } from '../src/features/chat/tool-label.js';
const settings = { connectionId: 'main', modelId: 'm1', toolOptionIds: ['t'], prompt: 'Be brief', promptOptionIds: [], modelOptions: [{ connectionId: 'main', modelId: 'm1', reasoning: 'high' as const }] };

test('workspace model settings preserve revisions and backend conflicts', async () => {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  const value = { models: [{ connectionId: 'main', modelId: 'm1', reasoning: 'high' as const }], defaultModel: { connectionId: 'main', modelId: 'm1' } };
  const api = new WorkspaceClient((async (input, init) => {
    calls.push({ path: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ revision: 4, value, issues: [] }));
  }) as typeof fetch);
  assert.equal((await api.workspaceModels('w 1')).revision, 4);
  assert.equal((await api.updateWorkspaceModels('w 1', 3, value)).revision, 4);
  assert.deepEqual(calls, [{ path: '/workspaces/w%201/models', method: 'GET', body: undefined }, { path: '/workspaces/w%201/models', method: 'PUT', body: { revision: 3, value } }]);
  const failing = new WorkspaceClient((async () => new Response(JSON.stringify({ error: { code: 'config_conflict', message: 'Workspace models changed' } }), { status: 409 })) as typeof fetch);
  await assert.rejects(failing.updateWorkspaceModels('w1', 0, value), (error: unknown) => error instanceof BackendError && error.code === 'config_conflict');
});

test('addresses name a workspace, a solo conversation, config, or home', () => {
  assert.deepEqual(readRoute('?workspace=w_1'), { page: 'workspace', id: 'w_1' });
  assert.deepEqual(readRoute('?agent=a-1'), { page: 'conversation', id: 'a-1' });
  assert.deepEqual(readRoute('?page=providers'), { page: 'providers' });
  assert.deepEqual(readRoute(''), { page: 'home' });
  assert.deepEqual(readRoute('?page=home'), { page: 'home' });
  assert.deepEqual(readRoute('?workspace=w1&agent=a1'), { page: 'workspace', id: 'w1' });
  for (const bad of ['?workspace=', '?workspace=a/b', `?workspace=${'x'.repeat(65)}`, '?agent=../x']) assert.deepEqual(readRoute(bad), { page: 'home' }, bad);
  for (const route of [{ page: 'workspace', id: 'w1' }, { page: 'conversation', id: 'a1' }, { page: 'providers' }, { page: 'home' }] as const) {
    assert.deepEqual(readRoute(routeUrl(route)), route, routeUrl(route));
  }
  assert.equal(sameRoute({ page: 'workspace', id: 'w1' }, { page: 'workspace', id: 'w1' }), true);
  assert.equal(sameRoute({ page: 'workspace', id: 'w1' }, { page: 'conversation', id: 'w1' }), false);
});

test('a call to a member is headed by its recipient, and other tools keep their names', () => {
  assert.equal(callRecipient('{"to":"Backend","text":"Do it"}'), 'Backend');
  assert.equal(toolHeading('send_message', '{"to":" Backend ","text":"x"}'), '→ Backend');
  assert.equal(toolHeading('send_message', '{"text":"x"}'), 'send_message');
  assert.equal(toolHeading('send_message', '{"to":'), 'send_message');
  assert.equal(toolHeading('send_message', undefined), 'send_message');
  assert.equal(toolHeading('send_message', `{"to":"${'x'.repeat(81)}"}`), 'send_message');
  assert.equal(toolHeading('read', '{"to":"Backend"}'), 'read');
  assert.deepEqual(toolLabels('send_message'), { input: 'Message', output: 'Response' });
  assert.deepEqual(toolLabels('read'), { input: 'Arguments', output: 'Result' });
  assert.equal(toolHeading('assign_member', '{"to":"Backend","text":"Implement"}'), 'Assign → Backend');
  assert.equal(toolHeading('assign_member', '{"to":'), 'assign_member');
  assert.deepEqual(toolLabels('assign_member'), { input: 'Assignment', output: 'Report' });
  assert.equal(toolHeading('save_design', '{"path":"metadata.json"}'), 'Update design');
  assert.deepEqual(toolLabels('save_design'), { input: 'Design change', output: 'Applied change' });
  assert.equal(toolHeading('read_design', '{}'), 'Read design');
});


test('member model client sends only model settings and the reviewed revision', async () => {
  const calls: {path: string; method: string; body?: unknown}[] = [];
  const value = {connectionId:'main',modelId:'m1',modelOptions:settings.modelOptions};
  const record = {id:'lead/1',revision:4,value,issues:[]};
  const api = new WorkspaceClient((async (input,init) => {
    calls.push({path:String(input),method:init?.method??'GET',body:init?.body?JSON.parse(String(init.body)):undefined});
    return new Response(JSON.stringify(record));
  }) as typeof fetch);
  assert.deepEqual(await api.memberModelSettings('w 1','lead/1'),record);
  assert.deepEqual(await api.updateMemberModelSettings('w 1','lead/1',3,value),record);
  assert.deepEqual(calls,[{path:'/workspaces/w%201/members/lead%2F1/model-settings',method:'GET',body:undefined},{path:'/workspaces/w%201/members/lead%2F1/model-settings',method:'PUT',body:{revision:3,value}}]);
});
