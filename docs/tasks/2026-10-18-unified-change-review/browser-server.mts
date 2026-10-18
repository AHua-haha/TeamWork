/** Disposable real HTTP/harness fixture; never reads the user's workspace. */
import { join } from 'node:path';
import { withTeam, stubConfig } from '../../../backend/test/team-fixture.js';
import { createAgentServer } from '../../../backend/src/http.js';
import type { AgentRuntime } from '../../../backend/src/runtime.js';
import type { ConfigService } from '../../../backend/src/config.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

await withTeam(async f => {
  await f.team.configuration.materialize(f.lead.memberId);
  const files = await f.team.harness.files(f.lead.memberId);
  const design = join(files.root, '.rsi/context/design/backend');
  const manifestPath = join(files.root, '.rsi/members/backend/member.json');
  const manifest = { name: 'Backend', role: 'developer', responsibility: 'Implement the approved backend design', settings: {}, promptFiles: [], designScope: { working: ['backend/metadata.json'], dependencies: ['metadata.json'] }, execute: { allowedCommands: [] } };
  await files.write.mkdir(design);
  await files.write.writeFile(join(design, 'metadata.json'), JSON.stringify({ implementation: ['src'] }, null, 2));
  await files.write.writeFile(join(design, 'design.md'), '# Backend\n\n## Purpose\nMaintain the workspace data.\n\n## Interface contract\nRead and update items.\n\n## Requirements\nKeep data durable.\n');
  await files.write.mkdir(join(files.root, '.rsi/members/backend'));
  await files.write.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  const config = { ...stubConfig, listAgents: async () => [] } as unknown as ConfigService;
  const server = createAgentServer(f.runtime as unknown as AgentRuntime, config, f.workspaces, f.team);
  const listener = server.listeners('request')[0] as (req: IncomingMessage, res: ServerResponse) => void;
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    if (req.url !== '/workspaces/review-control') { listener(req, res); return; }
    void (async () => {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const { action } = JSON.parse(raw || '{}');
      if (action === 'stale-design') await files.write.writeFile(join(design, 'design.md'), '# Backend\n\nRevised while review was open.\n');
      if (action === 'pending-member') await files.write.writeFile(manifestPath, JSON.stringify({ ...manifest, responsibility: 'Later pending responsibility' }, null, 2));
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ workspaceId: f.workspaceId }));
    })().catch(error => { res.writeHead(500); res.end(String(error)); });
  });
  server.listen(4281, '127.0.0.1', () => console.log('Disposable change review on 127.0.0.1:4281, workspace w1'));
  await new Promise<void>(resolve => {
    process.once('SIGTERM', () => { server.closeAllConnections(); server.close(() => resolve()); });
  });
});
