import { DesignService } from '../domain/workspace/design.js';
import { body, count, fields, json, optionalString, query, sse, text, type Route } from './http-helpers.js';
import { AppError, identity, position } from '../foundation/types.js';
import type { WorkspaceService } from '../domain/workspace/workspace.js';

const maxBodyBytes = 4 * 1024 * 1024;

function revision(value: unknown, name = 'baseRevision'): string {
  if (typeof value !== 'string') throw new AppError('invalid_input', `${name} must be a revision`);
  identity(value, name);
  return value;
}

/** `baseRevision` is null for a create and a revision for an update. */
function baseRevision(value: unknown): string | null {
  if (value === null) return null;
  if (value === undefined) throw new AppError('invalid_input', 'baseRevision is required: null to create, or the revision read');
  return revision(value);
}

function optionalRevision(value: unknown): string | undefined {
  return value === undefined ? undefined : revision(value);
}

function content(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('invalid_input', 'content must be a string');
  return value;
}

function path(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new AppError('invalid_input', `${name} must be a path`);
  return value;
}

/** Handles `/workspaces` and everything under it. */
export function workspaceRoutes(workspaces: WorkspaceService): (route: Route) => Promise<void> {
  const designs = new DesignService(workspaces);
  return async ({ request, response, url, path: segments, signal }) => {
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
        fields(input, ['workspaceId', 'name', 'directory', 'adopt', 'models']);
        json(response, 201, await workspaces.create({ workspaceId: input.workspaceId, name: input.name, directory: input.directory, adopt: input.adopt, models: input.models }));
        return;
      }
      throw notFound();
    }
    const workspaceId = segments[1]!;
    identity(workspaceId, 'workspaceId');
    const [, , area, operation, ...extra] = segments;
    if (extra.length) throw notFound();
    if (area === undefined) {
      if (method !== 'GET') throw notFound();
      query(url, []);
      json(response, 200, await workspaces.get(workspaceId));
      return;
    }

    if (area === 'models' && operation === undefined) {
      query(url, []);
      if (method === 'GET') json(response, 200, await workspaces.models(workspaceId));
      else if (method === 'PUT') {
        const input = await body(request, maxBodyBytes); fields(input, ['revision', 'value']); position(input.revision);
        json(response, 200, await workspaces.updateModels(workspaceId, input.revision, input.value));
      } else throw notFound();
      return;
    }
    if (area === 'designs') {
      if (operation === undefined && method === 'GET') {
        query(url, []);
        json(response, 200, await designs.list(workspaceId));
      } else if (operation === 'file' && method === 'GET') {
        query(url, ['path']);
        json(response, 200, await designs.inspect(workspaceId, text(url, 'path')));
      } else throw notFound();
      return;
    }

    if (area === 'files') {
      if (operation === 'tree' && method === 'GET') {
        query(url, ['path', 'depth']);
        json(response, 200, await (await workspaces.files(workspaceId)).tree(text(url, 'path', ''), count(url, 'depth', 1)));
      } else if (operation === 'file' && method === 'GET') {
        query(url, ['path']);
        json(response, 200, await (await workspaces.files(workspaceId)).read(text(url, 'path')));
      } else if (operation === 'file' && method === 'PUT') {
        query(url, ['path']);
        const input = await body(request, maxBodyBytes);
        fields(input, ['content', 'baseRevision']);
        const saved = await (await workspaces.files(workspaceId)).save(text(url, 'path'), content(input.content), baseRevision(input.baseRevision));
        json(response, saved.created ? 201 : 200, { path: saved.path, revision: saved.revision });
      } else if (operation === 'find' && method === 'GET') {
        query(url, ['q']);
        json(response, 200, await (await workspaces.files(workspaceId)).find(text(url, 'q')));
      } else throw notFound();
      return;
    }

    if (area !== 'context') throw notFound();
    const context = () => workspaces.context(workspaceId);
    if (operation === undefined && method === 'GET') {
      query(url, []);
      json(response, 200, await (await context()).overview());
    } else if (operation === 'tree' && method === 'GET') {
      query(url, ['path', 'depth']);
      json(response, 200, await (await context()).tree(text(url, 'path', ''), count(url, 'depth', 1)));
    } else if (operation === 'file' && method === 'GET') {
      query(url, ['path', 'revision']);
      const byRevision = url.searchParams.get('revision');
      const byPath = url.searchParams.get('path');
      if ((byRevision === null) === (byPath === null)) throw new AppError('invalid_input', 'Give either path or revision');
      json(response, 200, await (await context()).read(byRevision === null ? { path: byPath! } : { revision: revision(byRevision, 'revision') }));
    } else if (operation === 'file' && method === 'PUT') {
      query(url, ['path']);
      const input = await body(request, maxBodyBytes);
      fields(input, ['content', 'baseRevision', 'reason']);
      const saved = await (await context()).save(text(url, 'path'), content(input.content), baseRevision(input.baseRevision), optionalString(input.reason, 'reason'));
      json(response, saved.created ? 201 : 200, { path: saved.path, revision: saved.revision, seq: saved.seq });
    } else if (operation === 'move' && method === 'POST') {
      query(url, []);
      const input = await body(request, maxBodyBytes);
      fields(input, ['from', 'to', 'baseRevision', 'reason']);
      json(response, 200, await (await context()).move(path(input.from, 'from'), path(input.to, 'to'), optionalRevision(input.baseRevision), optionalString(input.reason, 'reason')));
    } else if (operation === 'delete' && method === 'POST') {
      query(url, []);
      const input = await body(request, maxBodyBytes);
      fields(input, ['path', 'baseRevision', 'reason']);
      json(response, 200, await (await context()).delete(path(input.path, 'path'), optionalRevision(input.baseRevision), optionalString(input.reason, 'reason')));
    } else if (operation === 'history' && method === 'GET') {
      query(url, ['path', 'before', 'limit']);
      json(response, 200, await (await context()).history(text(url, 'path'), count(url, 'before', null), count(url, 'limit', 50)));
    } else if (operation === 'find' && method === 'GET') {
      query(url, ['q']);
      json(response, 200, await (await context()).find(text(url, 'q')));
    } else if (operation === 'search' && method === 'GET') {
      query(url, ['q', 'path']);
      json(response, 200, await (await context()).search(text(url, 'q'), text(url, 'path', '')));
    } else if (operation === 'changes' && method === 'GET') {
      query(url, ['after', 'limit']);
      json(response, 200, await (await context()).changes(count(url, 'after', 0), count(url, 'limit', 100)));
    } else if (operation === 'follow' && method === 'GET') {
      query(url, ['after']);
      const after = count(url, 'after', 0);
      await sse(response, (await context()).follow(after, signal), signal, { workspaceId });
    } else throw notFound();
  };
}
