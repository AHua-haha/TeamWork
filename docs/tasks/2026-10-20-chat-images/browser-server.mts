import { createAgentServer } from '../../../backend/src/http.js';
import type { AgentRuntime } from '../../../backend/src/runtime.js';
import { withTeam, stubConfig } from '../../../backend/test/team-fixture.js';
import { png } from '../../../backend/test/image-fixture.js';
import { writeFile } from 'node:fs/promises';
await writeFile('.run/chat-picture.png', png(320, 200));
await withTeam(async f => {
  const config = Object.assign(Object.create(stubConfig), { listAgents: async () => [], capabilities: () => ({ tools: [], prompts: [] }) });
  Object.assign(f.runtime, { follow: async function* (agentId: string, options: { runId?: string } = {}) {
    const run = options.runId ? f.store.chatRuns.get(options.runId)?.run ?? null : (await f.runtime.getState(agentId)).run;
    yield { version: 2, agentId, runId: run?.runId ?? null, type: 'sync', historyPosition: 0, run };
    yield { version: 2, agentId, runId: run?.runId ?? null, type: 'end', historyPosition: 0, run };
  } });
  const post = f.team.runner.postUser.bind(f.team.runner);
  f.team.runner.postUser = async (...args) => {
    const accepted = await post(...args);
    setTimeout(() => void f.team.runner.publishFinal(f.lead.memberId, accepted.runs[0]!.runId, 'Picture received.', 'final-' + accepted.message.messageId), 100);
    return accepted;
  };
  const server = createAgentServer(f.runtime as unknown as AgentRuntime, config, f.workspaces, f.team);
  await new Promise<void>(resolve => server.listen(4279, '127.0.0.1', resolve));
  console.log(`Image review backend on 4279: ?workspace=${f.workspaceId}`);
  await new Promise<void>(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
});
