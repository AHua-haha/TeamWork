import { createServer } from 'node:http';
import type { AgentRuntime } from '../core/agent/runtime.js';
import type { ConfigService } from '../core/team/data/config.js';
import { body, fields, json, respond, sse } from './http-helpers.js';
import { AppError, identity, position } from '../core/agent/data/model.js';
import { teamRoutes } from './team-routes.js';
import type { TeamSystem } from '../core/team/team-system.js';
import { workspaceRoutes } from './workspace-routes.js';
import type { WorkspaceService } from '../core/workspace/workspace.js';

export function createAgentServer(runtime: AgentRuntime, config: ConfigService, workspaces: WorkspaceService, team: TeamSystem) {
  const workspaceRoute = workspaceRoutes(workspaces, id => team.deleteWorkspace(id));
  const teamRoute = teamRoutes(team);
  return createServer(respond(async route => {
    const { request, response, url, path, signal } = route;
    if (path[0] === 'workspaces') return path[2] === 'team' ? teamRoute(route) : workspaceRoute(route);
    if (path[0] === 'config') {
      if (path.length === 2 && path[1] === 'capabilities' && request.method === 'GET') { json(response, 200, config.capabilities()); return; }
      if (path.length === 2 && path[1] === 'app') {
        if (request.method === 'GET') { json(response, 200, await config.getApp()); return; }
        if (request.method === 'PUT') {
          const input = await body(request);
          fields(input, ['revision', 'value']);
          position(input.revision);
          json(response, 200, await config.updateApp(input.revision, input.value));
          return;
        }
      }
      if (path[1] === 'connections') {
        response.setHeader('Cache-Control', 'no-store');
        if (path.length === 2 && request.method === 'GET') { json(response, 200, await config.listConnections()); return; }
        if (path.length === 2 && request.method === 'POST') {
          const input = await body(request);
          fields(input, ['id', 'value']);
          identity(input.id, 'connection id');
          json(response, 201, await config.createConnection(input.id, input.value));
          return;
        }
        if (path.length >= 3) {
          const id = path[2]!;
          identity(id, 'connection id');
          if (path.length === 4 && path[3] === 'models' && request.method === 'GET') {
            json(response, 200, await config.modelChoices(id));
            return;
          }
          if (path.length === 5 && path[3] === 'models' && path[4] === 'refresh' && request.method === 'POST') {
            fields(await body(request), []);
            json(response, 200, await config.modelChoices(id, true));
            return;
          }
          if (path.length === 3) {
            if (request.method === 'GET') { json(response, 200, await config.getConnection(id)); return; }
            if (request.method === 'PUT') {
              const input = await body(request);
              fields(input, ['revision', 'value']);
              position(input.revision);
              json(response, 200, await config.updateConnection(id, input.revision, input.value));
              return;
            }
            if (request.method === 'DELETE') {
              const input = await body(request);
              fields(input, ['revision']);
              position(input.revision);
              await config.deleteConnection(id, input.revision);
              json(response, 200, { deleted: id });
              return;
            }
          }
        }
      }
      if (path[1] === 'catalog') {
        if (path.length === 2 && request.method === 'GET') { json(response, 200, await config.listCatalog()); return; }
        if (path.length === 2 && request.method === 'POST') {
          const input = await body(request);
          fields(input, ['id', 'value']);
          identity(input.id, 'catalog id');
          json(response, 201, await config.createCatalog(input.id, input.value));
          return;
        }
        if (path.length === 3) {
          const id = path[2]!;
          identity(id, 'catalog id');
          if (request.method === 'GET') { json(response, 200, await config.getCatalog(id)); return; }
          if (request.method === 'PUT') {
            const input = await body(request);
            fields(input, ['revision', 'value']);
            position(input.revision);
            json(response, 200, await config.updateCatalog(id, input.revision, input.value));
            return;
          }
          if (request.method === 'DELETE') {
            const input = await body(request);
            fields(input, ['revision']);
            position(input.revision);
            await config.deleteCatalog(id, input.revision);
            json(response, 200, { deleted: id });
            return;
          }
        }
      }
      throw new AppError('not_found', 'Endpoint not found', 404);
    }
    if (path[0] !== 'agents') throw new AppError('not_found', 'Endpoint not found', 404);
    if (path.length === 1 && request.method === 'GET') { json(response, 200, await config.listAgents()); return; }
    if (path.length === 1 && request.method === 'POST') {
      if (!(await config.getApp()).value.allowAgentCreation) throw new AppError('feature_disabled', 'Agent creation is disabled', 409);
      const input = await body(request);
      fields(input, ['agentId']);
      if (input.agentId !== undefined) identity(input.agentId, 'agentId');
      json(response, 201, await runtime.store.createAgent(input.agentId));
      return;
    }
    const agentId = path[1];
    identity(agentId, 'agentId');
    if (path.length === 3 && path[2] === 'config') {
      if (request.method === 'GET') { json(response, 200, await config.getAgent(agentId)); return; }
      if (request.method === 'POST') {
        const input = await body(request);
        fields(input, ['value']);
        json(response, 201, await config.createAgentConfig(agentId, input.value));
        return;
      }
      if (request.method === 'PUT') {
        const input = await body(request);
        fields(input, ['revision', 'value']);
        position(input.revision);
        json(response, 200, await config.updateAgent(agentId, input.revision, input.value));
        return;
      }
      if (request.method === 'DELETE') {
        const input = await body(request);
        fields(input, ['revision']);
        position(input.revision);
        await config.deleteAgent(agentId, input.revision);
        json(response, 200, { deleted: agentId });
        return;
      }
    }
    if (path.length === 3 && path[2] === 'state' && request.method === 'GET') {
      json(response, 200, await runtime.getState(agentId));
    } else if (path.length === 3 && path[2] === 'runs' && request.method === 'POST') {
      const input = await body(request, (await config.getApp()).value.maxInputBytes);
      fields(input, ['input']);
      // The runtime validates Pi's user-content shape and assigns role/time itself.
      const run = await team.runner.startUser(agentId, input.input as Parameters<AgentRuntime['start']>[1]);
      json(response, 202, { runId: run.runId, run, followUrl: `/agents/${agentId}/follow?runId=${run.runId}` });
    } else if (path.length === 5 && path[2] === 'runs' && path[4] === 'cancel' && request.method === 'POST') {
      const runId = path[3];
      identity(runId, 'runId');
      await runtime.cancel(agentId, runId);
      json(response, 202, { runId, cancellationRequested: true });
    } else if (path.length === 3 && path[2] === 'follow' && request.method === 'GET') {
      for (const key of url.searchParams.keys()) if (!['runId', 'after'].includes(key)) throw new AppError('invalid_input', 'Unknown follow parameter');
      const runId = url.searchParams.get('runId') ?? undefined;
      if (runId !== undefined) identity(runId, 'runId');
      const cursor = url.searchParams.get('after');
      if (cursor !== null && !/^\d+$/.test(cursor)) throw new AppError('invalid_input', 'Invalid history cursor');
      const after = cursor === null ? 0 : Number(cursor);
      position(after);
      await sse(response, runtime.follow(agentId, { runId, after, signal }), signal);
    } else throw new AppError('not_found', 'Endpoint not found', 404);
  }));
}
