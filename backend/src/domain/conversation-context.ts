import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { JsonObject, ToolResultMessage } from '@earendil-works/pi-ai';
import { parseBashInput, type BashInput } from './harness-command.js';
import { harnessBashTool } from './harness-tools.js';
import type { HarnessService } from './harness.js';
import type { StepScope } from './runtime.js';
import type { StoredMember } from './team.js';
import { AppError, type ContextEntry } from '../foundation/types.js';
import { memberContextPath } from './workspace-layout.js';

export interface MemberConversationStore {
  prepareMemberContext(agentId: string, runId: string, documents: ContextEntry[]): Promise<void>;
}

export function contextInput(text: string, metadata: JsonObject): ContextEntry {
  return { messageId: randomUUID(), message: { role: 'user', content: text, timestamp: Date.now() }, metadata };
}

/** Only exact reserved sections outside fenced examples are interpreted. */
export function parseContextDocument(content: string): { text: string; commands: BashInput[] } {
  const sections = new Map<string, string[]>();
  let section = '', fence: { char: string; length: number } | undefined;
  for (const line of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      const chars = marker[1]!;
      if (!fence) fence = { char: chars[0]!, length: chars.length };
      else if (chars[0] === fence.char && chars.length >= fence.length && !marker[2]!.trim()) fence = undefined;
    } else if (!fence && /^## /.test(line)) {
      section = line.slice(3).trim();
      if (sections.has(section)) throw new AppError('invalid_context', `Duplicate context section: ${section}`);
      sections.set(section, []);
      continue;
    }
    sections.get(section)?.push(line);
  }
  if (fence) throw new AppError('invalid_context', 'Unclosed Markdown fence in member context');
  for (const name of ['Result summary', 'File lookup', 'Automatic retrieval']) {
    if (!sections.has(name)) throw new AppError('invalid_context', `Missing context section: ${name}`);
  }
  const retrieval = sections.get('Automatic retrieval')!.join('\n').trim();
  const block = /^```json\s*\n([\s\S]*?)\n```$/.exec(retrieval);
  if (!block) throw new AppError('invalid_context', 'Automatic retrieval requires exactly one fenced json block');
  let value: unknown;
  try { value = JSON.parse(block[1]!); } catch { throw new AppError('invalid_context', 'Invalid automatic retrieval JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => k !== 'commands') || !Array.isArray((value as { commands?: unknown }).commands)) throw new AppError('invalid_context', 'Automatic retrieval requires {"commands": [Bash inputs]}');
  const commands = (value as { commands: unknown[] }).commands.map(parseBashInput);
  const text = ['Result summary', 'File lookup'].map(name => `## ${name}\n\n${sections.get(name)!.join('\n').trim()}`).join('\n\n');
  return { text, commands };
}

/** Missing results are context-only errors. Durable history and external effects are untouched. */
export function repairInterruptedTools(entries: ContextEntry[]): ContextEntry[] {
  const output: ContextEntry[] = [];
  let pending: { id: string; name: string }[] = [];
  const flush = () => {
    for (const call of pending) {
      const message: ToolResultMessage = { role: 'toolResult', toolCallId: call.id, toolName: call.name, isError: true, content: [{ type: 'text', text: 'Previous execution stopped before a result was recorded. The command may have had effects; inspect current state before deciding what to do. It was not replayed.' }], timestamp: Date.now() };
      output.push({ messageId: randomUUID(), message, metadata: { source: 'interrupted-tool-result' } });
    }
    pending = [];
  };
  for (const entry of entries) {
    if (entry.message.role === 'toolResult') {
      const callId = entry.message.toolCallId;
      pending = pending.filter(call => call.id !== callId);
      output.push(entry);
      continue;
    }
    flush();
    output.push(entry);
    if (entry.message.role === 'assistant') pending = entry.message.content.flatMap(part => part.type === 'toolCall' ? [{ id: part.id, name: part.name }] : []);
  }
  flush();
  return output;
}

export class ConversationContext {
  constructor(private readonly store: MemberConversationStore, private readonly harness: HarnessService) {}

  async prepare(member: StoredMember, scope: StepScope): Promise<void> {
    const documents: ContextEntry[] = [], retrieval: { path: string; commands: BashInput[] }[] = [];
    const files = await this.harness.files(member.id);
    const designs = await Promise.all(member.value.harness.designScope.working.map(path => this.harness.designs.read(member.workspaceId, path)));
    const paths = [...new Set(designs.map(design => memberContextPath(design.path)))].sort();
    for (const path of paths) {
      scope.signal.throwIfAborted();
      try {
        const bytes = await files.read.readFile(join(files.root, path));
        const parsed = parseContextDocument(bytes.toString('utf8'));
        documents.push(contextInput(`[Member context: ${path}]\n${parsed.text}`, { source: 'member-context', path }));
        retrieval.push({ path, commands: parsed.commands });
      } catch (error) {
        if (!(error instanceof AppError) || error.status >= 500) throw error;
        documents.push(contextInput(`Member context at ${path} could not be loaded: ${error.message}. Repair it with ordinary file tools. It must contain Result summary, File lookup and Automatic retrieval sections. No commands from this document were executed.`, { source: 'member-context-error', path }));
      }
    }
    scope.signal.throwIfAborted();
    await this.store.prepareMemberContext(member.id, scope.runId, documents);
    const bash = harnessBashTool(this.harness);
    for (const entry of retrieval) for (const input of entry.commands) {
      scope.signal.throwIfAborted();
      let text: string;
      try {
        const result = await bash.execute(input as unknown as JsonObject, scope, { type: 'toolCall', id: randomUUID(), name: 'bash', arguments: input as unknown as JsonObject });
        text = result.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');
      } catch (error) {
        scope.signal.throwIfAborted();
        text = `Automatic retrieval error: ${error instanceof Error ? error.message : 'Bash failed'}`;
      }
      await scope.recordInput(`[Automatic retrieval: ${entry.path}]\nBash input: ${JSON.stringify(input)}\n\n${text}`, { source: 'context-retrieval', path: entry.path, input: input as unknown as JsonObject });
    }
  }
}
