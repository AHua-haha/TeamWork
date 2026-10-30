import type { AgentRuntime } from '../core/agent/runtime.js';
import { readImageSubmission } from './chat-images.js';
import { body, fields, json, query, count, sse, type Route } from './http-helpers.js';
import type { TeamSystem } from '../core/team/team-system.js';
import { AppError, identity, position } from '../core/agent/data/model.js';

const maxBodyBytes = 1024 * 1024;

/** Handles `/workspaces/:workspaceId/team` and everything under it. */
export function teamRoutes(team: TeamSystem, runtime: AgentRuntime): (route: Route) => Promise<void> {
  return async ({ request, response, url, path: routePath, signal }) => {
    const method = request.method;
    const notFound = () => new AppError('not_found', 'Endpoint not found', 404);
    if (routePath[2] === 'team' && (routePath[3] === 'roster' || routePath[3] === 'chat' || routePath[3] === 'members' || routePath.length === 3)) throw notFound();
    // REST resources are canonical; normalize them to the existing Team handler below.
    const path = routePath[2] === 'chat' || routePath[2] === 'members'
      ? [routePath[0]!, routePath[1]!, 'team', ...routePath.slice(2)]
      : routePath;
    const [, workspaceId, , area, memberId, ...extra] = path;
    identity(workspaceId, 'workspaceId');
    if (routePath[2] === 'members' && routePath.length === 3) {
      if (method !== 'GET') throw notFound();
      query(url, []);
      json(response, 200, await team.roster(workspaceId));
      return;
    }
    if (routePath[2] === 'members' && routePath.length === 4) {
      if (method !== 'GET') throw notFound();
      query(url, []);
      identity(routePath[3]!, 'memberId');
      json(response, 200, await team.memberMetadata(workspaceId, routePath[3]!));
      return;
    }
    if (method === 'GET' && area === 'chat' && memberId === 'summary' && !extra.length) {
      query(url, []);
      response.setHeader('Cache-Control', 'no-store');
      json(response, 200, await team.inspectGroupSummary(workspaceId));
      return;
    }
    if (method === 'GET' && area === 'members' && memberId && extra.length === 1 && extra[0] === 'context') {
      identity(memberId, 'memberId');
      const input = contextQuery(url);
      response.setHeader('Cache-Control', 'no-store');
      await team.requireContextMember(workspaceId, memberId);
      json(response, 200, await runtime.inspectContext(memberId, input));
      return;
    }
    if (method === 'GET' && area === 'chat' && memberId === 'context' && !extra.length) {
      response.setHeader('Cache-Control', 'no-store');
      json(response, 200, await team.inspectGroupContext(workspaceId, contextQuery(url)));
      return;
    }
    if (area === 'roster') {
      if (method !== 'GET' || memberId !== undefined || extra.length) throw notFound();
      query(url, []);
      json(response, 200, await team.roster(workspaceId));
      return;
    }
    if (area === 'configuration') {
      if (method !== 'POST' || memberId !== 'activate' || extra.length) throw notFound();
      query(url, []);
      const input = await body(request, maxBodyBytes); fields(input, []);
      json(response, 200, await team.activateConfiguration(workspaceId));
      return;
    }
    if (area === 'members' && memberId && extra.length === 1 && extra[0] === 'model-settings') {
      identity(memberId, 'memberId'); query(url, []);
      if (method === 'GET') json(response, 200, await team.modelSettings(workspaceId, memberId));
      else if (method === 'PUT') {
        const input = await body(request, maxBodyBytes); fields(input, ['revision', 'value']);
        position(input.revision);
        json(response, 200, await team.updateModelSettings(workspaceId, memberId, input.revision as number, input.value));
      } else throw notFound();
      return;
    }
    if (area === 'chat') {
      if (method === 'GET' && memberId === 'attachments' && extra.length === 1) {
        query(url, []); identity(extra[0], 'imageId');
        const image = await team.runner.image(workspaceId, extra[0]);
        response.writeHead(200, { 'Content-Type': image.metadata.mimeType, 'Content-Length': image.bytes.length, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' });
        response.end(image.bytes); return;
      }
      if (extra.length) throw notFound();
      if (method === 'GET' && memberId === 'history') {
        query(url, ['before', 'limit', 'resetCursor']);
        response.setHeader('Cache-Control', 'no-store');
        json(response, 200, await team.runner.history(workspaceId, {
          before: count(url, 'before', null) ?? undefined, limit: count(url, 'limit', 50),
          resetCursor: count(url, 'resetCursor', null) ?? undefined,
        }));
        return;
      }
      if (method === 'GET' && (memberId === undefined || memberId === 'follow' || memberId === 'timeline' || memberId === 'timeline-follow')) {
        query(url, memberId === 'follow' || memberId === 'timeline-follow' ? ['after'] : ['after', 'limit']);
        const after = count(url, 'after', 0);
        if (memberId === 'timeline-follow') await sse(response, team.runner.followTimeline(workspaceId, after, signal), signal, { workspaceId });
        else if (memberId === 'timeline') json(response, 200, await team.runner.timeline(workspaceId, after, count(url, 'limit', 100)));
        else if (memberId === 'follow') await sse(response, team.runner.follow(workspaceId, after, signal), signal, { workspaceId });
        else json(response, 200, await team.runner.snapshot(workspaceId, after, count(url, 'limit', 100)));
      } else if (method === 'POST' && memberId === 'messages') {
        query(url, []);
        if (request.headers['content-type']?.startsWith('multipart/form-data')) {
          const input = await readImageSubmission(request);
          json(response, 202, await team.runner.postUser(workspaceId, input.text, input.images));
        } else {
          const input = await body(request, maxBodyBytes); fields(input, ['text']);
          json(response, 202, await team.runner.postUser(workspaceId, input.text));
        }
      } else if (method === 'POST' && memberId === 'reset') {
        query(url, []);
        json(response, 200, await team.runner.reset(workspaceId));
      } else if (method === 'POST' && memberId === 'stop') {
        query(url, []);
        await team.runner.stop(workspaceId); json(response, 202, { stopped: true });
      } else if (method === 'PUT' && memberId === undefined) {
        query(url, []);
        const input = await body(request, maxBodyBytes); fields(input, ['mentionLimit']);
        json(response, 200, await team.runner.configure(workspaceId, input.mentionLimit));
      } else throw notFound();
      return;
    }
    throw notFound();
  };
}

function contextQuery(url: URL) {
  query(url, ['offset', 'limit', 'revision']);
  return { offset: count(url, 'offset', 0), limit: count(url, 'limit', 50), revision: count(url, 'revision', null) ?? undefined };
}
