import { Type } from '@earendil-works/pi-ai';
import type { ConnectionView, ModelChoice } from './config.js';
import type { StoredConfig } from './database.js';
import type { RuntimeTool } from './runtime.js';
import type { TeamRunner } from './team-runner.js';
import { type MemberView, type StoredMember, type TeamService } from './team.js';
import { AppError } from './types.js';
import { harnessSchema } from './harness-tools.js';
import { refusing } from './tool-result.js';

export interface ModelDirectory {
  listConnections(): Promise<StoredConfig<ConnectionView>[]>;
  modelChoices(connectionId: string): Promise<ModelChoice[]>;
}

function describe(member: MemberView): string {
  const model = member.settings.modelId ? `${member.settings.connectionId}/${member.settings.modelId}` : 'no model';
  return `${member.name} (${member.role}); model: ${model}; working designs: ${member.harness.designScope.working.join(', ') || 'none'}${member.ready ? '' : `; cannot run yet: ${member.issues.join('; ')}`}`;
}

const optionalString = (value: unknown) => (value === undefined ? undefined : String(value));

/** The tools that belong to the team: calling a teammate for every member, and team management for the lead. */
export function teamTools(team: TeamService, runner: TeamRunner, models: ModelDirectory): { messaging: RuntimeTool[]; management: RuntimeTool[] } {
  const lead = async (agentId: string): Promise<StoredMember> => {
    const member = await team.find(agentId);
    if (!member?.value.lead || member.value.retiredAt !== null) throw new AppError('access_denied', 'Only the lead changes the team', 403);
    return member;
  };
  const target = async (leader: StoredMember, name: unknown): Promise<StoredMember> => {
    const member = await team.byName(leader.workspaceId, String(name));
    if (!member) throw new AppError('not_found', `No member named "${String(name)}"`, 404);
    if (member.value.lead) throw new AppError('lead_required', 'The lead cannot be changed or retired by itself; ask the user', 409);
    return member;
  };
  const modelSettings = (args: { connectionId?: unknown; modelId?: unknown }) => {
    if ((args.connectionId === undefined) !== (args.modelId === undefined)) throw new AppError('invalid_input', 'Give connectionId and modelId together');
    return args.connectionId === undefined ? {} : { connectionId: String(args.connectionId), modelId: String(args.modelId) };
  };
  return {
    messaging: [{
      definition: {
        name: 'send_message',
        description: 'Ask a teammate by name to do something. The teammate works in its own conversation while you wait, and its final response comes back as the result; nothing else of its work is shown to you. A teammate already in this chain of calls cannot be called.',
        parameters: Type.Object({ to: Type.String({ description: 'Name of the teammate' }), text: Type.String({ description: 'What you need: the goal, where to find context, and what to answer with' }) }),
      },
      execute: (args, scope) => refusing(() => runner.call(scope.agentId, scope.runId, scope.signal, String(args.to), String(args.text))),
    }],
    management: [
      {
        definition: {
          name: 'create_member',
          description: 'Add a member to the team. It starts with your model unless you give another, and uses its configured working and dependency designs. An empty harness must be configured before the worker runs.',
          parameters: Type.Object({
            name: Type.String({ description: 'Unique name, such as Backend' }), role: Type.String({ description: 'Short role, such as backend developer' }),
            responsibility: Type.Optional(Type.String({ description: 'What the member is accountable for' })), harness: Type.Optional(harnessSchema),
            instructions: Type.Optional(Type.String({ description: 'Extra standing instructions for the member' })),
            connectionId: Type.Optional(Type.String()), modelId: Type.Optional(Type.String()),
          }),
        },
        execute: (args, scope) => refusing(async () => {
          const leader = await lead(scope.agentId);
          const member = await team.create(leader.workspaceId, {
            name: args.name, role: args.role, ...(args.responsibility === undefined ? {} : { responsibility: args.responsibility }),
            ...(args.harness === undefined ? {} : { harness: args.harness }),
            settings: { ...(args.instructions === undefined ? {} : { prompt: String(args.instructions) }), ...modelSettings(args) },
          });
          return `Created ${describe(member)}`;
        }),
      },
      {
        definition: {
          name: 'update_member',
          description: 'Change a member other than yourself. Only the fields you give change. Model and instruction changes apply to its next run. Harness changes apply to subsequent tool actions and model calls.',
          parameters: Type.Object({
            name: Type.String({ description: 'Current name of the member' }), newName: Type.Optional(Type.String()), role: Type.Optional(Type.String()),
            responsibility: Type.Optional(Type.String()), harness: Type.Optional(harnessSchema), instructions: Type.Optional(Type.String()),
            connectionId: Type.Optional(Type.String()), modelId: Type.Optional(Type.String()),
          }),
        },
        execute: (args, scope) => refusing(async () => {
          const member = await target(await lead(scope.agentId), args.name);
          const current = member.value;
          const updated = await team.update(member.workspaceId, member.id, member.revision, {
            name: optionalString(args.newName) ?? current.name, role: optionalString(args.role) ?? current.role,
            responsibility: optionalString(args.responsibility) ?? current.responsibility, harness: args.harness ?? current.harness,
            settings: { ...current.settings, ...(args.instructions === undefined ? {} : { prompt: String(args.instructions) }), ...modelSettings(args) },
          });
          return `Updated ${describe(updated)}`;
        }),
      },
      {
        definition: {
          name: 'retire_member',
          description: 'Remove a member other than yourself from the team. Its run is cancelled and a caller waiting for it receives a cancelled result. What it wrote stays.',
          parameters: Type.Object({ name: Type.String({ description: 'Name of the member' }) }),
        },
        execute: (args, scope) => refusing(async () => {
          const member = await target(await lead(scope.agentId), args.name);
          await runner.retire(member.workspaceId, member.id, member.revision);
          return `Retired ${member.value.name}`;
        }),
      },
      {
        definition: { name: 'list_models', description: 'List the provider connections and the models each offers, for choosing a member\'s model.', parameters: Type.Object({}) },
        execute: () => refusing(async () => {
          const lines: string[] = [];
          for (const connection of await models.listConnections()) {
            lines.push(`${connection.id} (${connection.value.label}):`);
            for (const choice of await models.modelChoices(connection.id)) lines.push(`  ${choice.modelId}${choice.reasoning ? ' [reasoning]' : ''}${choice.verified ? '' : ' [unverified]'}`);
          }
          return lines.length ? lines.join('\n') : 'No provider connections are configured.';
        }),
      },
    ],
  };
}
