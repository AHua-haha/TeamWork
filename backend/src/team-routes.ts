import { body, fields, json, query, count, sse, type Route } from './http-helpers.js';
import type { TeamSystem } from './team-system.js';
import { AppError, identity, position } from './types.js';

const maxBodyBytes = 1024 * 1024;

/** Handles `/workspaces/:workspaceId/team` and everything under it. */
export function teamRoutes(team: TeamSystem): (route: Route) => Promise<void> {
  return async ({ request, response, url, path, signal }) => {
    const [, workspaceId, , area, memberId, ...extra] = path;
    identity(workspaceId, 'workspaceId');
    const method = request.method;
    const notFound = () => new AppError('not_found', 'Endpoint not found', 404);
    if (area === 'chat') {
      if (extra.length) throw notFound();
      if (method === 'GET' && (memberId === undefined || memberId === 'follow' || memberId === 'timeline' || memberId === 'timeline-follow')) {
        query(url, memberId === 'follow' || memberId === 'timeline-follow' ? ['after'] : ['after', 'limit']);
        const after = count(url, 'after', 0);
        if (memberId === 'timeline-follow') await sse(response, team.runner.followTimeline(workspaceId, after, signal), signal, { workspaceId });
        else if (memberId === 'timeline') json(response, 200, await team.runner.timeline(workspaceId, after, count(url, 'limit', 100)));
        else if (memberId === 'follow') await sse(response, team.runner.follow(workspaceId, after, signal), signal, { workspaceId });
        else json(response, 200, await team.runner.snapshot(workspaceId, after, count(url, 'limit', 100)));
      } else if (method === 'POST' && memberId === 'messages') {
        query(url, []);
        const input = await body(request, maxBodyBytes); fields(input, ['text']);
        json(response, 202, await team.runner.postUser(workspaceId, input.text));
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
    if (extra.length || (area !== undefined && area !== 'members')) throw notFound();
    query(url, []);
    if (area === undefined) {
      if (method !== 'GET') throw notFound();
      json(response, 200, await team.team(workspaceId));
      return;
    }
    if (memberId === undefined) {
      if (method !== 'POST') throw notFound();
      const input = await body(request, maxBodyBytes);
      fields(input, ['name', 'role', 'responsibility', 'harness', 'settings']);
      json(response, 201, await team.create(workspaceId, input));
      return;
    }
    identity(memberId, 'memberId');
    if (method === 'GET') {
      json(response, 200, await team.member(workspaceId, memberId));
    } else if (method === 'PUT') {
      const input = await body(request, maxBodyBytes);
      fields(input, ['revision', 'value']);
      position(input.revision);
      json(response, 200, await team.update(workspaceId, memberId, input.revision, input.value));
    } else if (method === 'DELETE') {
      const input = await body(request, maxBodyBytes);
      fields(input, ['revision']);
      position(input.revision);
      await team.runner.retire(workspaceId, memberId, input.revision);
      json(response, 200, { retired: memberId });
    } else throw notFound();
  };
}
