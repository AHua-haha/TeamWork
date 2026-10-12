import { body, fields, json, query, type Route } from './http-helpers.js';
import type { TeamSystem } from './team-system.js';
import { AppError, identity, position } from './types.js';

const maxBodyBytes = 1024 * 1024;

/** Handles `/workspaces/:workspaceId/team` and everything under it. */
export function teamRoutes(team: TeamSystem): (route: Route) => Promise<void> {
  return async ({ request, response, url, path }) => {
    const [, workspaceId, , area, memberId, ...extra] = path;
    identity(workspaceId, 'workspaceId');
    const method = request.method;
    const notFound = () => new AppError('not_found', 'Endpoint not found', 404);
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
      fields(input, ['name', 'role', 'responsibility', 'scope', 'settings']);
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
