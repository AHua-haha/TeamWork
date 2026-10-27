import { body, fields, json, query, type Route } from './http-helpers.js';
import { AppError, identity, position } from '../core/agent/data/model.js';
import type { WorkspaceService } from '../core/workspace/workspace.js';

const maxBodyBytes = 4 * 1024 * 1024;

/** Handles workspace metadata, registration, and workspace model settings. */
export function workspaceRoutes(workspaces: WorkspaceService): (route: Route) => Promise<void> {
  return async ({ request, response, url, path: segments }) => {
    const method = request.method;
    const notFound = () => new AppError('not_found', 'Endpoint not found', 404);
    if (segments.length === 1) {
      if (method === 'GET') {
        query(url, []);
        json(response, 200, { workspaces: await workspaces.list() });
        return;
      }
      if (method === 'POST') {
        query(url, []);
        const input = await body(request, maxBodyBytes);
        fields(input, ['workspaceId', 'name', 'directory', 'adopt', 'models', 'cleanupRevision']);
        json(response, 201, await workspaces.create({ workspaceId: input.workspaceId, name: input.name, directory: input.directory, adopt: input.adopt, models: input.models, cleanupRevision: input.cleanupRevision }));
        return;
      }
      throw notFound();
    }
    if (segments.length === 2 && segments[1] === 'initialization' && method === 'POST') {
      query(url, []);
      const input = await body(request, maxBodyBytes);
      fields(input, ['directory', 'adopt']);
      json(response, 200, await workspaces.inspectInitialization({ directory: input.directory, adopt: input.adopt }));
      return;
    }
    const workspaceId = segments[1]!;
    identity(workspaceId, 'workspaceId');
    const [, , area, operation, ...extra] = segments;
    if (extra.length) throw notFound();
    if (area === undefined) {
      if (method !== 'GET') throw notFound();
      query(url, []);
      json(response, 200, await workspaces.record(workspaceId));
      return;
    }
    if (area === 'models' && operation === undefined) {
      query(url, []);
      if (method === 'GET') json(response, 200, await workspaces.models(workspaceId));
      else if (method === 'PUT') {
        const input = await body(request, maxBodyBytes);
        fields(input, ['revision', 'value']);
        position(input.revision);
        json(response, 200, await workspaces.updateModels(workspaceId, input.revision, input.value));
      } else throw notFound();
      return;
    }
    throw notFound();
  };
}
