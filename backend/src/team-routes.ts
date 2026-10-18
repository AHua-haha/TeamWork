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
    if (area === 'configuration') {
      if (extra.length) throw notFound();
      if (method === 'GET' && memberId === 'current') {
        query(url, []);
        json(response, 200, await team.currentConfiguration(workspaceId));
      } else if (method === 'POST' && memberId === 'commit') {
        query(url, []);
        const input = await body(request, maxBodyBytes); fields(input, ['revision', 'base', 'message']);
        if (typeof input.revision !== 'string' || typeof input.base !== 'string' || typeof input.message !== 'string') throw new AppError('invalid_input', 'Commit names reviewed revision, committed base and message');
        json(response, 200, await team.commitConfiguration(workspaceId, input.revision, input.base, input.message));
      } else if (method === 'GET' && memberId === undefined) {
        query(url, ['source']);
        const origin = url.searchParams.get('source') ?? 'committed';
        if (origin !== 'committed' && origin !== 'pending') throw new AppError('invalid_input', 'source must be pending or committed');
        json(response, 200, await team.reviewConfiguration(workspaceId, origin));
      } else if (method === 'POST' && memberId === 'activate') {
        query(url, []);
        const input = await body(request, maxBodyBytes); fields(input, ['revision', 'digest']);
        if (typeof input.revision !== 'string' || typeof input.digest !== 'string') throw new AppError('invalid_input', 'Name the exact reviewed committed revision and digest');
        json(response, 200, await team.activateConfiguration(workspaceId, input.revision, input.digest));
      } else throw notFound();
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
    if (area === 'members' && memberId && extra[0] === 'harness') {
      identity(memberId, 'memberId');
      await team.member(workspaceId, memberId);
      query(url, []);
      if (extra.length === 1 && method === 'GET') {
        json(response, 200, await team.harness.inspect(memberId));
        return;
      }
      const [, partId, action] = extra;
      identity(partId, 'part');
      if (extra.length !== 3) throw notFound();
      if (method === 'GET' && action === 'review') {
        json(response, 200, await team.harness.review(memberId, partId));
        return;
      }
      if (method === 'GET' && action === 'history') {
        json(response, 200, { history: await team.harness.history(memberId, partId) });
        return;
      }
      if (method !== 'POST' || (action !== 'commit' && action !== 'restore')) throw notFound();
      if (team.runner.isRunning(memberId)) throw new AppError('member_busy', 'Wait for this member to finish before accepting or restoring its work', 409);
      const input = await body(request, maxBodyBytes);
      fields(input, action === 'commit' ? ['revision', 'base', 'message'] : ['revision']);
      if (typeof input.revision !== 'string' || (action === 'commit' && (typeof input.base !== 'string' || typeof input.message !== 'string'))) throw new AppError('invalid_input', 'Name the exact reviewed revision, committed base and commit intent');
      const actor = { type: 'user' as const, memberId };
      const result = await team.runner.workspaceOperation(workspaceId, () => {
        if (team.runner.isRunning(memberId)) throw new AppError('member_busy', 'Wait for this member to finish before accepting or restoring its work', 409);
        return action === 'commit'
          ? team.harness.commit(memberId, partId, input.message as string, actor, input.revision as string, input.base as string)
          : team.harness.restore(memberId, partId, input.revision as string, actor);
      });
      json(response, 200, result);
      return;
    }
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
    if (extra.length || (area !== undefined && area !== 'members')) throw notFound();
    query(url, []);
    if (area === undefined) {
      if (method !== 'GET') throw notFound();
      json(response, 200, await team.team(workspaceId));
      return;
    }
    if (method !== 'GET' || memberId === undefined) throw notFound();
    identity(memberId, 'memberId');
    json(response, 200, await team.inspect(workspaceId, memberId));
  };
}
