import { Type, type Tool } from '@earendil-works/pi-ai';
import { createEditTool, createLsTool, createReadTool, createWriteTool } from '@earendil-works/pi-coding-agent';
import type { ConnectionView, ModelChoice } from './config.js';
import type { StoredConfig } from './database.js';
import type { MemberContext } from './member-context.js';
import type { RuntimeTool } from './runtime.js';
import type { TeamRunner } from './team-runner.js';
import { scopePath, type MemberView, type StoredMember, type TeamService } from './team.js';
import { AppError } from './types.js';

type Output = Awaited<ReturnType<RuntimeTool['execute']>>;
const text = (value: string): Output => ({ content: [{ type: 'text', text: value }], isError: false });

/**
 * Pi's own file tools, working on the calling member's view of the workspace folder.
 * The runtime ends a run when a tool reports failure, so a failure of a file tool is returned to the member as its
 * result instead: a missing file or a text that does not match is something the member can act on. Only cancellation propagates.
 */
export function fileTools(context: Pick<MemberContext, 'files'>): RuntimeTool[] {
  const definitionOf = (tool: Tool): Tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters });
  const wrap = (definition: Tool, build: (agentId: string) => Promise<{ execute(id: string, args: never, signal?: AbortSignal): Promise<{ content: Output['content'] }> }>): RuntimeTool => ({
    definition: definitionOf(definition),
    async execute(args, scope, call) {
      try {
        const result = await (await build(scope.agentId)).execute(call.id, args as never, scope.signal);
        return { content: result.content, isError: false };
      } catch (error) {
        scope.signal.throwIfAborted();
        return text(`Error: ${error instanceof Error ? error.message : 'The file action failed'}`);
      }
    },
  });
  // The definitions need no folder; each call builds the tool for its member's folder and access.
  return [
    wrap(createReadTool('/'), async id => { const files = await context.files(id); return createReadTool(files.root, { operations: files.read }); }),
    wrap(createWriteTool('/'), async id => { const files = await context.files(id); return createWriteTool(files.root, { operations: files.write }); }),
    wrap(createEditTool('/'), async id => { const files = await context.files(id); return createEditTool(files.root, { operations: files.edit }); }),
    wrap(createLsTool('/'), async id => { const files = await context.files(id); return createLsTool(files.root, { operations: files.ls }); }),
  ];
}

export interface ModelDirectory {
  listConnections(): Promise<StoredConfig<ConnectionView>[]>;
  modelChoices(connectionId: string): Promise<ModelChoice[]>;
}

/** A refusal the agent can act on is the tool's result; any other failure ends the run. */
async function refusing(body: () => Promise<string>): Promise<Output> {
  try { return text(await body()); }
  catch (error) {
    if (error instanceof AppError && error.status < 500) return text(`Refused (${error.code}): ${error.message}`);
    throw error;
  }
}

function describe(member: MemberView): string {
  const model = member.settings.modelId ? `${member.settings.connectionId}/${member.settings.modelId}` : 'no model';
  return `${member.name} (${member.role}); model: ${model}; scope: ${member.scope.length ? member.scope.map(path => `.context/${path}`).join(', ') : 'none'}${member.ready ? '' : `; cannot run yet: ${member.issues.join('; ')}`}`;
}

const optionalString = (value: unknown) => (value === undefined ? undefined : String(value));
/** Scope paths as members see them (`.context/agent/...`) or as the team stores them (`agent/...`). */
const scopeList = (value: unknown): string[] | undefined => (value === undefined ? undefined : (value as unknown[]).map(path => scopePath(String(path).replace(/^\.context\//, ''))));

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
  const scopeSchema = Type.Array(Type.String(), { description: 'Agent-context paths the member works in, such as .context/agent/systems/backend. A folder covers everything in it.' });
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
          description: 'Add a member to the team. It starts with your model unless you give another, and sees only its scope of agent context.',
          parameters: Type.Object({
            name: Type.String({ description: 'Unique name, such as Backend' }), role: Type.String({ description: 'Short role, such as backend developer' }),
            responsibility: Type.Optional(Type.String({ description: 'What the member is accountable for' })), scope: Type.Optional(scopeSchema),
            instructions: Type.Optional(Type.String({ description: 'Extra standing instructions for the member' })),
            connectionId: Type.Optional(Type.String()), modelId: Type.Optional(Type.String()),
          }),
        },
        execute: (args, scope) => refusing(async () => {
          const leader = await lead(scope.agentId);
          const member = await team.create(leader.workspaceId, {
            name: args.name, role: args.role, ...(args.responsibility === undefined ? {} : { responsibility: args.responsibility }),
            ...(args.scope === undefined ? {} : { scope: scopeList(args.scope) }),
            settings: { ...(args.instructions === undefined ? {} : { prompt: String(args.instructions) }), ...modelSettings(args) },
          });
          return `Created ${describe(member)}`;
        }),
      },
      {
        definition: {
          name: 'update_member',
          description: 'Change a member other than yourself. Only the fields you give change. The change applies to its next run; a run in progress keeps its model and instructions.',
          parameters: Type.Object({
            name: Type.String({ description: 'Current name of the member' }), newName: Type.Optional(Type.String()), role: Type.Optional(Type.String()),
            responsibility: Type.Optional(Type.String()), scope: Type.Optional(scopeSchema), instructions: Type.Optional(Type.String()),
            connectionId: Type.Optional(Type.String()), modelId: Type.Optional(Type.String()),
          }),
        },
        execute: (args, scope) => refusing(async () => {
          const member = await target(await lead(scope.agentId), args.name);
          const current = member.value;
          const updated = await team.update(member.workspaceId, member.id, member.revision, {
            name: optionalString(args.newName) ?? current.name, role: optionalString(args.role) ?? current.role,
            responsibility: optionalString(args.responsibility) ?? current.responsibility, scope: scopeList(args.scope) ?? current.scope,
            settings: { ...current.settings, ...(args.instructions === undefined ? {} : { prompt: String(args.instructions) }), ...modelSettings(args) },
          });
          return `Updated ${describe(updated)}`;
        }),
      },
      {
        definition: {
          name: 'retire_member',
          description: 'Remove a member other than yourself from the team. Its run is cancelled and messages waiting for it are dropped. What it wrote stays.',
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
