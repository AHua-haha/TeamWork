import { dirname, isAbsolute, relative as relativePath } from 'node:path';
import { createEditToolDefinition, createReadToolDefinition, createWriteToolDefinition } from '@earendil-works/pi-coding-agent';
import type { AssistantMessage, JsonObject, ToolCall, ToolResultMessage } from '@earendil-works/pi-ai';
import type { AssistantResponseHandler, AssistantResponseHandlerContext, AssistantResponseHandlerFactory, RuntimeTool, AgentFileCapability } from './contracts.js';
import { AppError, type AssistantResponseHandlerData } from './data/model.js';

type Range = { start: number; end: number };
type FileState = { ranges: Range[] };
type State = { files: Record<string, FileState> };
type OperationResult = Pick<ToolResultMessage, 'content' | 'isError'>;
type Operation = { call: ToolCall; path: string; result: OperationResult; view?: string; status: 'success' | 'error'; operation: 'read' | 'write' | 'edit'; suppress?: boolean };
type EditChange = { start: number; oldEnd: number; newEnd: number; delta: number };

const fileToolNames = new Set(['read', 'write', 'edit']);

function normalizeRanges(ranges: Range[]): Range[] {
  const sorted = ranges
    .filter(range => Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end) && range.start >= 1 && range.end >= range.start)
    .sort((left, right) => left.start - right.start);
  const merged: Range[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.start <= last.end + 1) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

/** Treat a terminal newline as a line terminator, not as an additional empty line. */
function fileLines(content: string): string[] {
  if (content === '') return [];
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (content.endsWith('\n')) lines.pop();
  return lines;
}
function newlineCount(content: string): number { return (content.match(/\n/g) ?? []).length; }
function lineCount(content: string): number { return fileLines(content).length; }
function fileKey(root: string, absolute: string): string {
  const relative = relativePath(root, absolute);
  if (!isAbsolute(relative) && !/^\.\.(?:[\\/]|$)/.test(relative)) return relative.split(/[\\/]/).join('/');
  return absolute.split(/[\\/]/).join('/');
}
function safePath(path: string): string { return path.replace(/[\r\n\t]/g, ' '); }
function lineAt(content: string, offset: number): number { return newlineCount(content.slice(0, offset)) + 1; }
function lineNumber(value: number, width: number): string { return `${String(value).padStart(Math.max(6, width))}\t`; }

function metadata(path: string, totalLines: number, operation: 'read' | 'write' | 'edit', editResult?: string): string {
  return `<metadata>\npath: ${safePath(path)}\ntotal_lines: ${totalLines}\noperation: ${operation}\nstatus: success${editResult ? `\nedit_result: ${editResult}` : ''}\n</metadata>`;
}
function formatAggregate(path: string, content: string, ranges: Range[], operation: 'read' | 'edit', editResult?: string): string {
  const lines = fileLines(content);
  const visible = normalizeRanges(ranges)
    .map(range => ({ start: Math.min(range.start, lines.length), end: Math.min(range.end, lines.length) }))
    .filter(range => range.start <= range.end);
  const body = [operation === 'read'
    ? 'Aggregated file view: combines ranges revealed by this and previous reads. Gaps are not shown.'
    : 'Aggregated file view: combines previously revealed ranges with the current post-edit content for affected lines. Gaps are not shown.'];
  let previousEnd = 0;
  for (const range of visible) {
    if (range.start > previousEnd + 1) body.push(`--- Lines ${previousEnd + 1}-${range.start - 1} not shown ---`);
    for (let number = range.start; number <= range.end; number++) body.push(`${lineNumber(number, lines.length)}${lines[number - 1]}`);
    previousEnd = range.end;
  }
  body.push(metadata(path, lines.length, operation, editResult));
  return body.join('\n');
}
function formatWholeFile(path: string, content: string): string {
  const lines = fileLines(content);
  return [...lines.map((line, index) => `${lineNumber(index + 1, lines.length)}${line}`), metadata(path, lines.length, 'write')].join('\n');
}

/** Apply one successful exact-string replacement's effect to the tracked revealed line ranges. */
function adjustRanges(ranges: Range[], change: EditChange): Range[] {
  const adjusted = ranges.map(range => {
    if (range.end < change.start) return { ...range };
    if (range.start > change.oldEnd) return { start: range.start + change.delta, end: range.end + change.delta };
    return { start: Math.min(range.start, change.start), end: Math.max(change.newEnd, range.end > change.oldEnd ? range.end + change.delta : range.end) };
  });
  if (change.newEnd >= change.start) adjusted.push({ start: change.start, end: change.newEnd });
  return normalizeRanges(adjusted);
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'File operation failed'; }
function assertArguments(call: ToolCall, allowed: string[], required: string[]): void {
  const keys = Object.keys(call.arguments);
  if (keys.some(key => !allowed.includes(key)) || required.some(key => !(key in call.arguments))) {
    throw new AppError('invalid_input', `Invalid ${call.name} arguments`);
  }
}
function canonicalEditList(value: unknown): Array<{ oldText: string; newText: string }> {
  if (!Array.isArray(value) || value.length === 0) throw new AppError('invalid_input', 'Edit requires at least one exact oldText/newText replacement');
  return value.map(edit => {
    if (!edit || typeof edit !== 'object' || Array.isArray(edit)) throw new AppError('invalid_input', 'Each edit requires string oldText and newText');
    const item = edit as Record<string, unknown>;
    if (Object.keys(item).some(key => key !== 'oldText' && key !== 'newText') || typeof item.oldText !== 'string' || item.oldText.length === 0 || typeof item.newText !== 'string') {
      throw new AppError('invalid_input', 'Each edit requires a non-empty string oldText and a string newText');
    }
    return { oldText: item.oldText, newText: item.newText };
  });
}

/** File tools are Agent-handler-owned; Harness supplies only the scoped, permission-checked file capability. */
export class FileAssistantResponseHandler implements AssistantResponseHandler {
  readonly handlerId = 'file-content';
  private data: State;
  private revision: number;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    private readonly filesCapability: AgentFileCapability,
    private readonly agentId: string,
    initial: AssistantResponseHandlerData,
    private readonly persist: (revision: number, data: JsonObject) => Promise<AssistantResponseHandlerData>,
  ) {
    this.revision = initial.revision;
    this.data = parseState(initial.data);
  }

  tools(_scope: AssistantResponseHandlerContext['scope']): RuntimeTool[] {
    const definitions = [createReadToolDefinition('/'), createWriteToolDefinition('/'), createEditToolDefinition('/')];
    return definitions.map(definition => ({
      definition: { name: definition.name, description: definition.description, parameters: definition.parameters },
      execute: async () => { throw new AppError('handler_tool_only', 'File tools execute through the Assistant Response Handler'); },
    }));
  }

  overrideToolNames(_scope: AssistantResponseHandlerContext['scope']): string[] { return ['read', 'write', 'edit']; }

  canHandle(response: AssistantMessage): boolean {
    return response.content.some(part => part.type === 'toolCall' && fileToolNames.has(part.name));
  }

  async handle(response: AssistantMessage, context: AssistantResponseHandlerContext): Promise<void> {
    const calls = response.content.filter((part): part is ToolCall => part.type === 'toolCall' && fileToolNames.has(part.name));
    const fileCallIds = calls.map(call => call.id);
    const lastByPath = new Map<string, number>();
    const latestViews = new Map<string, string>();
    for (const call of context.toolCalls) {
      if (!fileToolNames.has(call.name) || typeof call.arguments.path !== 'string') continue;
      try {
        const resolved = await this.filesCapability.fileInvocation(this.agentId, call.name, call.arguments.path);
        lastByPath.set(fileKey(resolved.root, resolved.path), context.toolCalls.findIndex(candidate => candidate.id === call.id));
      } catch { /* The normal handler path records this as an error result when its turn arrives. */ }
    }
    for (const call of calls) {
      try {
        context.validateToolCall(call);
      } catch (error) {
        await context.beforeToolCall(call, fileCallIds);
        await context.recordToolResult(call, { content: [{ type: 'text', text: `${call.name} failed: ${errorMessage(error)}\n\n<metadata>\npath: ${safePath(typeof call.arguments.path === 'string' ? call.arguments.path : '(unknown)')}\noperation: ${call.name}\nstatus: error\n</metadata>` }], isError: true });
        continue;
      }
      await context.beforeToolCall(call, fileCallIds);
      let result: Operation;
      try {
        result = await this.perform(call, context);
      } catch (error) {
        if (error instanceof AppError && error.code === 'handler_state_persistence_failure') throw error;
        result = {
          call,
          path: typeof call.arguments.path === 'string' ? call.arguments.path : '(unknown)',
          result: { content: [{ type: 'text', text: `${call.name} failed: ${errorMessage(error)}` }], isError: true },
          status: 'error',
          operation: call.name as Operation['operation'],
        };
      }

      const currentIndex = context.toolCalls.findIndex(candidate => candidate.id === result.call.id);
      if (result.view) latestViews.set(result.path, result.view);
      const isFinalForPath = lastByPath.get(result.path) === currentIndex;
      const visibleView = isFinalForPath ? result.view ?? latestViews.get(result.path) : undefined;
      const keepView = !!visibleView;
      const entryMetadata: JsonObject = keepView ? { fileViewPath: result.path } : {};
      const error = result.result.content.find(content => content.type === 'text')?.text ?? `${result.operation} failed for ${result.path}.`;
      const text = result.result.isError
        ? `${error}\n\n<metadata>\npath: ${safePath(result.path)}\noperation: ${result.operation}\nstatus: error\n</metadata>`
        : keepView ? visibleView! : `${result.operation} succeeded for ${safePath(result.path)}.`;
      await context.recordToolResult(result.call, { content: [{ type: 'text', text }], isError: result.result.isError }, entryMetadata);
      if (keepView) await context.hideFileViews(result.path, result.call.id);
      if (result.suppress && result.status === 'success') await context.suppressToolCallArguments([result.call.id]);
    }
  }

  private updateState(change: (draft: State) => void): Promise<void> {
    const operation = this.saving.then(async () => {
      const draft = structuredClone(this.data) as State;
      change(draft);
      try {
        const saved = await this.persist(this.revision, draft as unknown as JsonObject);
        this.revision = saved.revision;
        this.data = parseState(saved.data);
      } catch {
        throw new AppError('handler_state_persistence_failure', 'Could not persist file handler state; execution must be restored before retrying', 500);
      }
    });
    this.saving = operation;
    return operation;
  }

  private async perform(call: ToolCall, context: AssistantResponseHandlerContext): Promise<Operation> {
    if (typeof call.arguments.path !== 'string' || !call.arguments.path) throw new AppError('invalid_input', 'A non-empty file path is required');
    const action = call.name as Operation['operation'];
    return this.filesCapability.operation(this.agentId, async () => {
      context.scope.signal.throwIfAborted();
      const resolved = await this.filesCapability.fileInvocation(this.agentId, action, call.arguments.path as string);
      const files = await this.filesCapability.files(this.agentId);
      const canonical = resolved.path;
      const path = fileKey(resolved.root, canonical);

      if (action === 'read') {
        assertArguments(call, ['path', 'offset', 'limit'], ['path']);
        if (call.arguments.offset !== undefined && typeof call.arguments.offset !== 'number') throw new AppError('invalid_input', 'Read offset must be a positive whole number');
        if (call.arguments.limit !== undefined && typeof call.arguments.limit !== 'number') throw new AppError('invalid_input', 'Read limit must be a positive whole number');
        const content = (await files.read.readFile(canonical)).toString('utf8');
        const lines = fileLines(content);
        const offset = call.arguments.offset === undefined ? 1 : call.arguments.offset as number;
        const limit = call.arguments.limit === undefined ? Math.max(1, lines.length) : call.arguments.limit as number;
        if (!Number.isSafeInteger(offset) || offset < 1 || !Number.isSafeInteger(limit) || limit < 1) throw new AppError('invalid_input', 'Read offset and limit must be positive whole numbers');
        if (offset > lines.length && lines.length !== 0) throw new AppError('invalid_input', `Offset ${offset} is beyond end of file (${lines.length} lines total)`);
        const start = Math.min(offset, Math.max(1, lines.length));
        const end = Math.min(lines.length, start + limit - 1);
        await this.updateState(draft => {
          const file = draft.files[path] ??= { ranges: [] };
          if (end >= start) file.ranges = normalizeRanges([...file.ranges, { start, end }]);
        });
        const view = formatAggregate(path, content, this.data.files[path]?.ranges ?? [], 'read');
        return { call, path, result: { content: [{ type: 'text', text: view }], isError: false }, view, status: 'success', operation: action };
      }

      if (action === 'write') {
        assertArguments(call, ['path', 'content'], ['path', 'content']);
        if (typeof call.arguments.content !== 'string') throw new AppError('invalid_input', 'Write content must be text');
        await files.write.mkdir(dirname(canonical));
        await files.write.writeFile(canonical, call.arguments.content);
        context.scope.signal.throwIfAborted();
        const content = (await files.read.readFile(canonical)).toString('utf8');
        const count = lineCount(content);
        await this.updateState(draft => { draft.files[path] = { ranges: count ? [{ start: 1, end: count }] : [] }; });
        const view = formatWholeFile(path, content);
        return { call, path, result: { content: [{ type: 'text', text: view }], isError: false }, view, status: 'success', operation: action, suppress: true };
      }

      assertArguments(call, ['path', 'edits'], ['path', 'edits']);
      const edits = canonicalEditList(call.arguments.edits);
      const original = (await files.edit.readFile(canonical)).toString('utf8');
      const crlf = original.includes('\r\n');
      const normalizedOriginal = original.replace(/\r\n/g, '\n');
      const matches = edits.map(edit => {
        const index = normalizedOriginal.indexOf(edit.oldText);
        if (index < 0) throw new AppError('edit_failed', 'Requested oldText was not found; file was not changed');
        if (normalizedOriginal.indexOf(edit.oldText, index + 1) >= 0) throw new AppError('edit_failed', 'Requested oldText is ambiguous; use a unique exact match');
        return { ...edit, originalIndex: index };
      }).sort((left, right) => left.originalIndex - right.originalIndex);
      for (let index = 1; index < matches.length; index++) {
        const previous = matches[index - 1]!;
        if (previous.originalIndex + previous.oldText.length > matches[index]!.originalIndex) throw new AppError('invalid_input', 'Edit oldText matches must not overlap');
      }

      let content = normalizedOriginal;
      const changes: EditChange[] = [];
      for (const edit of [...matches].reverse()) {
        const index = edit.originalIndex;
        if (content.slice(index, index + edit.oldText.length) !== edit.oldText) throw new AppError('edit_failed', 'Edit matches overlap after replacement; the file was not changed');
        const start = lineAt(content, index);
        const previousLineCount = lineCount(content);
        const nextContent = content.slice(0, index) + edit.newText + content.slice(index + edit.oldText.length);
        const delta = lineCount(nextContent) - previousLineCount;
        changes.push({ start, oldEnd: start + newlineCount(edit.oldText), newEnd: edit.newText ? start + newlineCount(edit.newText) : start - 1, delta });
        content = nextContent;
      }
      context.scope.signal.throwIfAborted();
      const output = crlf ? content.replace(/\n/g, '\r\n') : content;
      await files.edit.writeFile(canonical, output);
      await this.updateState(draft => {
        const file = draft.files[path] ??= { ranges: [] };
        for (const change of changes) file.ranges = adjustRanges(file.ranges, change);
      });
      const current = (await files.read.readFile(canonical)).toString('utf8');
      const editResult = `applied ${edits.length} exact string replacement${edits.length === 1 ? '' : 's'}`;
      const view = formatAggregate(path, current, this.data.files[path]?.ranges ?? [], 'edit', editResult);
      return { call, path, result: { content: [{ type: 'text', text: view }], isError: false }, view, status: 'success', operation: action };
    });
  }
}

export function fileAssistantResponseHandlerFactory(fileCapability: AgentFileCapability, agentId: string): AssistantResponseHandlerFactory {
  return { handlerId: 'file-content', create: (data, persist) => new FileAssistantResponseHandler(fileCapability, agentId, data, persist) };
}

function parseState(data: JsonObject): State {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { files: {} };
  const files: State['files'] = {};
  const source = (data as { files?: unknown }).files;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    for (const [path, value] of Object.entries(source)) {
      if (!value || typeof value !== 'object' || !Array.isArray((value as FileState).ranges)) continue;
      const ranges = (value as FileState).ranges.filter((range): range is Range => !!range && Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end));
      files[path] = { ranges: normalizeRanges(ranges) };
    }
  }
  return { files };
}
