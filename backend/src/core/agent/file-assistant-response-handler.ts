import { dirname, isAbsolute, relative as relativePath, resolve, basename, join } from 'node:path';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { detectSupportedImageMimeTypeFromFile, resizeImage } from '@earendil-works/pi-coding-agent';
import { Type, type AssistantMessage, type JsonObject, type ToolCall, type ToolResultMessage } from '@earendil-works/pi-ai';
import type { AssistantResponseHandler, AssistantResponseHandlerContext, AssistantResponseHandlerFactory, HandlerTool } from './contracts.js';
import { AppError, type AssistantResponseHandlerData, type ContextHistory } from './data/model.js';

type Range = { start: number; end: number };
type FileState = { ranges: Range[]; visibleMessageId: string | null };
type State = { files: Record<string, FileState> };
type EditChange = { start: number; oldEnd: number; newEnd: number; delta: number };

const fileToolNames = new Set(['read', 'write', 'edit']);
const fileToolInstructions = readFileSync(new URL('../../../prompts/agent/file-tools.md', import.meta.url), 'utf8').trim();
if (!fileToolInstructions) throw new AppError('invalid_config', 'File handler instructions must not be empty', 500);

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
function metadata(path: string, totalLines: number, operation: 'read' | 'write' | 'edit', editResult?: string, markerId?: string): string {
  return `<metadata>\npath: ${safePath(path)}\ntotal_lines: ${totalLines}\noperation: ${operation}\nstatus: success${editResult ? `\nedit_result: ${editResult}` : ''}${markerId ? `\nfile_marker_id: ${markerId}` : ''}\n</metadata>`;
}
function formatAggregate(path: string, content: string, ranges: Range[], operation: 'read' | 'write' | 'edit', editResult?: string): string {
  // Keep source whitespace and line endings; only marker boundaries may add a newline.
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const visible = normalizeRanges(ranges)
    .map(range => ({ start: range.start, end: Math.min(range.end, lines.length) }))
    .filter(range => range.start <= range.end);
  // Disambiguate source that itself contains presentation-marker examples, without escaping it.
  let markerId: string | undefined;
  if (/^<<<(?:FILE_START|FILE_END|UNREVEALED_GAP)(?:\s|>>>)/m.test(content)) {
    do { markerId = randomUUID(); } while (content.includes(markerId));
  }
  const marker = (name: string, attributes = '') => `<<<${name}${attributes}${markerId ? ` marker_id="${markerId}"` : ''}>>>\n`;
  const body = [marker('FILE_START', ` path=${JSON.stringify(path)} total_lines=${lines.length}`)];
  let previousEnd = 0;
  for (const range of visible) {
    if (range.start > previousEnd + 1) body.push(marker('UNREVEALED_GAP', ` lines=${previousEnd + 1}-${range.start - 1}`));
    const revealed = lines.slice(range.start - 1, range.end).join('');
    body.push(revealed.endsWith('\n') ? revealed : `${revealed}\n`);
    previousEnd = range.end;
  }
  if (previousEnd < lines.length) body.push(marker('UNREVEALED_GAP', ` lines=${previousEnd + 1}-${lines.length}`));
  body.push(marker('FILE_END'), '\n', metadata(path, lines.length, operation, editResult, markerId));
  return body.join('');
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

/** The handler owns declarations and direct filesystem execution, independently of Harness. */
export class FileAssistantResponseHandler implements AssistantResponseHandler {
  readonly handlerId = 'file-content';
  private data: State;
  private revision: number;
  private restoreLegacyReferences: boolean;

  constructor(private readonly root: string, initial: AssistantResponseHandlerData) {
    this.revision = initial.revision;
    this.data = parseState(root, initial.data);
    const source = initial.data.files;
    this.restoreLegacyReferences = !!source && typeof source === 'object' && Object.values(source).some(value => value && typeof value === 'object' && !('visibleMessageId' in value));
  }

  restoreContext(context: ContextHistory): void {
    if (!this.restoreLegacyReferences) return;
    // Upgrade pre-reference state once from an already-loaded context, never from SQL or per operation.
    for (const entry of context.entries) {
      const path = entry.metadata.fileViewPath;
      if (typeof path !== 'string' || entry.metadata.modelContextHidden === true || entry.message.role !== 'toolResult' || entry.message.isError) continue;
      const file = this.data.files[resolve(this.root, path)];
      if (file) file.visibleMessageId = entry.messageId;
    }
    this.restoreLegacyReferences = false;
  }

  tools(): HandlerTool[] {
    const path = Type.String({ minLength: 1, description: 'Relative to the workspace root, or an absolute filesystem path.' });
    return [
      { definition: { name: 'read', description: 'Read text or an image directly from the filesystem. Text results aggregate all revealed ranges as plain source text without line numbers, with FILE_START/FILE_END boundaries and UNREVEALED_GAP markers for every omitted range. offset is 1-indexed; omit limit to reveal the remaining lines. The aggregate is not truncated. Images are returned as image blocks. Previous aggregates are hidden from future model context.', parameters: Type.Object({path, offset: Type.Optional(Type.Integer({minimum: 1})), limit: Type.Optional(Type.Integer({minimum: 1}))}, {additionalProperties: false}) } },
      { definition: { name: 'write', description: 'Create or replace a UTF-8 text file, creating parent directories as needed. Returns the full post-write file as plain source text within FILE_START/FILE_END boundaries, followed by metadata. The successful content argument is omitted from future model context.', parameters: Type.Object({path, content: Type.String()}, {additionalProperties: false}) } },
      { definition: { name: 'edit', description: 'Edit a UTF-8 text file using one or more unique exact string replacements. All oldText matches must exist once in the original file and must not overlap. Returns the current aggregate including changed lines. Use actual source text, excluding presentation markers and metadata.', parameters: Type.Object({path, edits: Type.Array(Type.Object({oldText: Type.String({minLength: 1}), newText: Type.String()}, {additionalProperties: false}), {minItems: 1})}, {additionalProperties: false}) } },
    ];
  }

  systemPrompt(): string { return fileToolInstructions; }

  overrideToolNames(): string[] { return ['read', 'write', 'edit']; }
  canHandle(response: AssistantMessage): boolean { return response.content.some(part => part.type === 'toolCall' && fileToolNames.has(part.name)); }

  async handle(response: AssistantMessage, context: AssistantResponseHandlerContext): Promise<void> {
    const calls = response.content.filter((part): part is ToolCall => part.type === 'toolCall' && fileToolNames.has(part.name));
    const fileCallIds = calls.map(call => call.id);
    for (const call of calls) {
      await context.beforeToolCall(call, fileCallIds);
      let result: {path: string; file: FileState; content: ToolResultMessage['content']};
      try {
        context.validateToolCall(call);
        result = await this.perform(call, context);
      } catch (error) {
        context.scope.signal.throwIfAborted();
        const path = typeof call.arguments.path === 'string' ? call.arguments.path : '(unknown)';
        await context.recordToolResult(call, {content: [{type: 'text', text: `${call.name} failed: ${errorMessage(error)}\n\n<metadata>\npath: ${safePath(path)}\noperation: ${call.name}\nstatus: error\n</metadata>`}], isError: true});
        continue;
      }
      context.scope.signal.throwIfAborted();
      const messageId = randomUUID();
      const previous = this.data.files[result.path]?.visibleMessageId;
      const next: State = { files: {...this.data.files, [result.path]: {...result.file, visibleMessageId: messageId}} };
      try {
        await context.recordToolResult(call, {content: result.content, isError: false}, {fileViewPath: result.path}, {
          messageId, handlerId: this.handlerId, revision: this.revision, data: next as unknown as JsonObject,
          ...(previous ? {hideMessageId: previous} : {}), suppressArguments: call.name === 'write',
        });
      } catch (error) {
        if (error instanceof AppError && error.code === 'compaction_persistence_failure') throw error;
        throw new AppError('handler_state_persistence_failure', 'Could not acknowledge the file result and handler state; restore execution before retrying. Filesystem effects may already have occurred and were not replayed.', 500);
      }
      this.data = next;
      this.revision++;
    }
  }

  private async perform(call: ToolCall, context: AssistantResponseHandlerContext): Promise<{path: string; file: FileState; content: ToolResultMessage['content']}> {
    context.scope.signal.throwIfAborted();
    if (typeof call.arguments.path !== 'string' || !call.arguments.path) throw new AppError('invalid_input', 'A non-empty file path is required');
    const path = await canonicalPath(this.root, call.arguments.path);
    const label = fileKey(this.root, path);
    const file = structuredClone(this.data.files[path] ?? {ranges: [], visibleMessageId: null});
    let content: string;
    let view: string;
    if (call.name === 'read') {
      assertArguments(call, ['path', 'offset', 'limit'], ['path']);
      const offset = call.arguments.offset === undefined ? 1 : call.arguments.offset;
      const limit = call.arguments.limit;
      if (!Number.isSafeInteger(offset) || Number(offset) < 1 || (limit !== undefined && (!Number.isSafeInteger(limit) || Number(limit) < 1))) throw new AppError('invalid_input', 'Read offset and limit must be positive whole numbers');
      const bytes = await readFile(path);
      const mimeType = await detectSupportedImageMimeTypeFromFile(path);
      if (mimeType) {
        const image = await resizeImage(bytes, mimeType, {maxWidth: 2000, maxHeight: 2000, maxBytes: 4.5 * 1024 * 1024});
        if (!image) throw new AppError('invalid_image', 'Image could not be prepared');
        file.ranges = [];
        return {path, file, content: [{type: 'text', text: `Read image file [${image.mimeType}]\n\n${metadata(label, 0, 'read')}`}, {type: 'image', mimeType: image.mimeType, data: image.data}]};
      }
      content = textContent(bytes);
      const count = lineCount(content);
      if (Number(offset) > count && count !== 0) throw new AppError('invalid_input', `Offset ${offset} is beyond end of file (${count} lines total)`);
      file.ranges = file.ranges.map(range => ({start: range.start, end: Math.min(range.end, count)})).filter(range => range.start <= range.end);
      if (count) file.ranges = normalizeRanges([...file.ranges, {start: Number(offset), end: Math.min(count, Number(offset) + (limit === undefined ? count : Number(limit)) - 1)}]);
      view = formatAggregate(label, content, file.ranges, 'read');
    } else if (call.name === 'write') {
      assertArguments(call, ['path', 'content'], ['path', 'content']);
      if (typeof call.arguments.content !== 'string') throw new AppError('invalid_input', 'Write content must be text');
      await mkdir(dirname(path), {recursive: true});
      context.scope.signal.throwIfAborted();
      await writeFile(path, call.arguments.content, 'utf8');
      content = textContent(await readFile(path));
      const count = lineCount(content);
      file.ranges = count ? [{start: 1, end: count}] : [];
      view = formatAggregate(label, content, file.ranges, 'write');
    } else {
      assertArguments(call, ['path', 'edits'], ['path', 'edits']);
      const edits = canonicalEditList(call.arguments.edits);
      const original = textContent(await readFile(path));
      const crlf = original.includes('\r\n');
      content = original.replace(/\r\n/g, '\n');
      const matches = edits.map(edit => {
        const oldText = edit.oldText.replace(/\r\n/g, '\n'), newText = edit.newText.replace(/\r\n/g, '\n');
        const index = content.indexOf(oldText);
        if (index < 0) throw new AppError('edit_failed', 'Requested oldText was not found; file was not changed');
        if (content.indexOf(oldText, index + 1) >= 0) throw new AppError('edit_failed', 'Requested oldText is ambiguous; use a unique exact match');
        return {oldText, newText, originalIndex: index};
      }).sort((left, right) => left.originalIndex - right.originalIndex);
      for (let index = 1; index < matches.length; index++) {
        const previous = matches[index - 1]!;
        if (previous.originalIndex + previous.oldText.length > matches[index]!.originalIndex) throw new AppError('invalid_input', 'Edit oldText matches must not overlap');
      }
      for (const edit of [...matches].reverse()) {
        const start = lineAt(content, edit.originalIndex), previousCount = lineCount(content);
        content = content.slice(0, edit.originalIndex) + edit.newText + content.slice(edit.originalIndex + edit.oldText.length);
        file.ranges = adjustRanges(file.ranges, {start, oldEnd: start + newlineCount(edit.oldText), newEnd: Math.min(lineCount(content), start + newlineCount(edit.newText)), delta: lineCount(content) - previousCount});
      }
      context.scope.signal.throwIfAborted();
      await writeFile(path, crlf ? content.replace(/\n/g, '\r\n') : content, 'utf8');
      content = textContent(await readFile(path));
      file.ranges = file.ranges.map(range => ({start: range.start, end: Math.min(range.end, lineCount(content))})).filter(range => range.start <= range.end);
      view = formatAggregate(label, content, file.ranges, 'edit', `applied ${edits.length} exact string replacement${edits.length === 1 ? '' : 's'}`);
    }
    return {path, file, content: [{type: 'text', text: view}]};
  }
}

export function fileAssistantResponseHandlerFactory(root: string): AssistantResponseHandlerFactory {
  return {handlerId: 'file-content', create: initial => new FileAssistantResponseHandler(root, initial)};
}

function textContent(bytes: Buffer): string {
  let text: string;
  try { text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes); }
  catch { throw new AppError('unsupported_file', 'File is not UTF-8 text or a supported image'); }
  if (text.includes('\0')) throw new AppError('unsupported_file', 'File is not UTF-8 text or a supported image');
  return text;
}

async function canonicalPath(root: string, input: string): Promise<string> {
  let path = input;
  if (path === '~' || path.startsWith('~/')) path = homedir() + path.slice(1);
  let absolute = resolve(root, path);
  const suffix: string[] = [];
  for (;;) {
    try { return join(await realpath(absolute), ...suffix); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(absolute);
      if (parent === absolute) throw error;
      suffix.unshift(basename(absolute)); absolute = parent;
    }
  }
}

function parseState(root: string, data: JsonObject): State {
  const files: State['files'] = {};
  const source = data?.files;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    for (const [path, value] of Object.entries(source)) {
      if (!value || typeof value !== 'object' || !Array.isArray((value as FileState).ranges)) continue;
      const ranges = (value as FileState).ranges.filter((range): range is Range => !!range && Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end));
      files[resolve(root, path)] = {ranges: normalizeRanges(ranges), visibleMessageId: typeof (value as FileState).visibleMessageId === 'string' ? (value as FileState).visibleMessageId : null};
    }
  }
  return {files};
}
