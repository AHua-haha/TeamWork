import type { ContextPage, ContextPageInput } from '../../context-page.js';
import { validateMessage, validateRun } from '../../agent/data/validation.js';
import type { GroupContextMessage } from '../../agent/data/context.js';
import type { GroupSummary, GroupSummaryInput, GroupSummarySubmission } from './group-summary.js';
import type { ImageContent, Message, JsonObject } from '@earendil-works/pi-ai';
import { validateChatImages, type ChatImage, type PreparedChatImage, type ChatImageStore } from './chat-images.js';
import type { RunState } from '../../agent/data/model.js';
import { AppError, identity, position } from '../../agent/data/model.js';

export const maxChatCharacters = 20_000;
export const defaultMentionLimit = 32;
export type ChatAuthor = { type: 'user' } | { type: 'member'; memberId: string; name: string; runId: string };
export interface ChatMessage {
  workspaceId: string; messageId: string; position: number; exchangeId: string;
  author: ChatAuthor; text: string; attachments?: ChatImage[]; recipients: string[]; time: number;
}
export interface GroupContextEntry { messageId: string; message: Message; metadata: JsonObject }
export interface FinalReference { agentId: string; runId: string; messageId: string; position: number; contentIndices?: number[]; /** UTF-16 offset in the joined selected text; backend-owned. */ bodyOffset?: number; /** Historical accepted response-tool records only. */ toolCallId?: string }
export interface TimelineBase { workspaceId: string; entryId: string; position: number; revision: number; exchangeId: string; time: number }
export type TimelineEntry = TimelineBase & (
  | { kind: 'user'; text: string; messageId: string; attachments?: ChatImage[] }
  | { kind: 'member'; memberId: string; name: string; run: RunState; working: { after: number; through: number | null }; finalRef: FinalReference | null; text: string | null }
);
export interface TimelineChange { cursor: number; entry: TimelineEntry }
export interface ChatReset { workspaceId: string; resetCursor: number; resetPosition: number }
export interface TimelineSnapshot { resetCursor: number; workspaceId: string; cursor: number; changes: TimelineChange[]; more: boolean; mentionLimit: number }
export interface ChatAcceptance { message: ChatMessage; runs: RunState[]; entries: TimelineEntry[] }
/** Stored member publications contain a reference, never a duplicate final body. */
export type StoredChatMessage = Omit<ChatMessage, 'text'> & { text?: string; finalRef?: FinalReference };
export function validateTimelineEntry(value: unknown): asserts value is TimelineEntry {
  if (!value || typeof value !== 'object') throw new AppError('invalid_data', 'Invalid timeline entry');
  const entry = value as TimelineEntry;
  identity(entry.workspaceId); identity(entry.entryId); identity(entry.exchangeId);
  position(entry.position); position(entry.revision);
  if (!entry.position || !entry.revision || !Number.isSafeInteger(entry.time) || entry.time < 0) throw new AppError('invalid_data', 'Invalid timeline position or time');
  if (entry.kind === 'user') { identity(entry.messageId); chatText(entry.text, entry.attachments); return; }
  if (entry.kind !== 'member') throw new AppError('invalid_data', 'Invalid timeline entry kind');
  identity(entry.memberId); validateRun(entry.run);
  if (entry.run.agentId !== entry.memberId || entry.run.runId !== entry.entryId || typeof entry.name !== 'string' || !entry.name || !entry.working) throw new AppError('invalid_data', 'Invalid timeline member');
  position(entry.working.after);
  if (entry.working.through !== null) { position(entry.working.through); if (entry.working.through < entry.working.after) throw new AppError('invalid_data', 'Invalid working range'); }
  if (entry.working.through !== entry.run.endPosition || (entry.run.status === 'running' && entry.finalRef !== null)) throw new AppError('invalid_data', 'Invalid timeline lifecycle');
  if (entry.finalRef) {
    identity(entry.finalRef.messageId); position(entry.finalRef.position);
    const indices = entry.finalRef.contentIndices;
    if (indices !== undefined && (!Array.isArray(indices) || !indices.length || indices.some((value, index) => !Number.isSafeInteger(value) || value < 0 || (index > 0 && value <= indices[index - 1]!)) || entry.finalRef.toolCallId !== undefined)) throw new AppError('invalid_data', 'Invalid final text selection');
    if (entry.finalRef.bodyOffset !== undefined && (!Number.isSafeInteger(entry.finalRef.bodyOffset) || entry.finalRef.bodyOffset < 0 || indices === undefined || entry.finalRef.toolCallId !== undefined)) throw new AppError('invalid_data', 'Invalid final body offset');
    if (entry.finalRef.toolCallId !== undefined && (typeof entry.finalRef.toolCallId !== 'string' || !entry.finalRef.toolCallId || entry.finalRef.toolCallId.length > 1024)) throw new AppError('invalid_data', 'Invalid final response action');
    if (entry.run.status !== 'completed' || entry.finalRef.agentId !== entry.memberId || entry.finalRef.runId !== entry.run.runId || entry.finalRef.position + (entry.finalRef.toolCallId ? 1 : 0) !== entry.working.through || entry.finalRef.position <= entry.working.after) throw new AppError('invalid_data', 'Invalid timeline final reference');
  }
  if (entry.text !== null && typeof entry.text !== 'string') throw new AppError('invalid_data', 'Invalid timeline text');
}
export interface ChatSnapshot {
  workspaceId: string; position: number; resetPosition: number; mentionLimit: number; messages: ChatMessage[]; more: boolean;
  runs: { exchangeId: string; run: RunState }[];
}
export interface ChatPublication {
  memberRevisions?: Record<string, number>;
  workspaceId: string; author: ChatAuthor; text: string; images?: PreparedChatImage[]; recipients: string[]; exchangeId?: string; finalMessageId?: string;
}
export interface ChatStore extends ChatImageStore {
  inspectGroupContext(workspaceId: string, input?: ContextPageInput): Promise<ContextPage<GroupContextEntry>>;
  readGroupContext(workspaceId: string, after: number, through?: number): Promise<GroupContextMessage[]>;
  readGroupSummary?(workspaceId: string): Promise<GroupSummary | undefined>;
  summaryInput?(workspaceId: string): Promise<GroupSummaryInput>;
  submitGroupSummary?(workspaceId: string, submission: GroupSummarySubmission): Promise<GroupSummary>;
  publishChat(input: ChatPublication): Promise<ChatAcceptance>;
  chatSnapshot(workspaceId: string, after?: number, limit?: number): Promise<ChatSnapshot>;
  chatTimeline(workspaceId: string, after?: number, limit?: number): Promise<TimelineSnapshot>;
  configureChat(workspaceId: string, mentionLimit: number): Promise<void>;
  stopChat(workspaceId: string): Promise<RunState[]>;
  resetChat(workspaceId: string): Promise<ChatReset>;
}

export function validateChatMessage(value: unknown): asserts value is ChatMessage {
  if (!value || typeof value !== 'object') throw new AppError('invalid_data', 'Invalid chat message');
  const message = value as ChatMessage;
  identity(message.workspaceId); identity(message.messageId); identity(message.exchangeId);
  position(message.position);
  if (!message.position || !Number.isSafeInteger(message.time) || message.time < 0) throw new AppError('invalid_data', 'Invalid chat position or time');
  chatText(message.text, message.attachments);
  validateRouting(message.author, message.recipients);
}

function validateRouting(author: ChatAuthor, recipients: string[]): void {
  if (!Array.isArray(recipients) || new Set(recipients).size !== recipients.length) throw new AppError('invalid_data', 'Invalid chat recipients');
  for (const recipient of recipients) identity(recipient);
  if (!author || !['user', 'member'].includes(author.type)) throw new AppError('invalid_data', 'Invalid chat author');
  if (author.type === 'member') {
    identity(author.memberId); identity(author.runId);
    if (typeof author.name !== 'string' || !author.name) throw new AppError('invalid_data', 'Invalid chat author name');
  }
}

export function chatText(value: unknown, attachments?: ChatImage[]): string {
  if (attachments !== undefined) validateChatImages(attachments);
  if (typeof value !== 'string' || (!value.trim() && !attachments?.length) || value.length > maxChatCharacters) throw new AppError('invalid_input', `A group message needs text (at most ${maxChatCharacters} characters) or pictures`);
  return value;
}

/** Explicit routing tokens; an @ inside an email or identifier is ordinary text. */
export function userMentions(text: string): string[] {
  for (const match of text.matchAll(/(^|[^\p{L}\p{N}_.@-])@\{/gu)) {
    const tail = text.slice(match.index! + match[1]!.length + 2);
    const end = tail.indexOf('}');
    if (end < 1 || /[{}\r\n]/.test(tail.slice(0, end))) throw new AppError('invalid_input', 'Use a complete named mention, for example @{Backend Worker}');
  }
  const result = new Map<string, string>();
  const pattern = /(^|[^\p{L}\p{N}_.@-])@(?:\{([^{}\r\n]+)\}|([A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?))/gu;
  for (const match of text.matchAll(pattern)) {
    // A bare @scope/package is a technical identifier, not a routing token.
    if (match[3] && text[match.index! + match[0].length] === '/') continue;
    const name = (match[2] ?? match[3])!;
    result.set(name.toLowerCase(), name);
  }
  return [...result.values()];
}

export function groupSender(message: Pick<ChatMessage, 'author'>): string {
  return message.author.type === 'user' ? 'Sender: User [user]' : `Sender: ${message.author.name} [member: ${message.author.memberId}]`;
}

export function groupEntry(message: ChatMessage, images: ImageContent[] = [], finalRef?: FinalReference): GroupContextEntry {
  const text = `[Group message ${message.position}]\n${groupSender(message)}\n${message.recipients.length ? `[Mentioned members: ${message.recipients.join(', ')}]\n` : ''}${message.text}`;
  return {
    messageId: message.messageId,
    message: { role: 'user', content: images.length ? [{ type: 'text', text }, ...images.map(image => ({...image}))] : text, timestamp: message.time },
    metadata: { source: 'group-chat', workspaceId: message.workspaceId, groupPosition: message.position, exchangeId: message.exchangeId, author: {...message.author}, recipients: [...message.recipients],
      ...(message.attachments ? {attachments: message.attachments.map(image => ({...image}))} : {}), ...(finalRef ? {finalRef: {...structuredClone(finalRef)}} : {}) },
  };
}

export function mentionLimit(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1000) throw new AppError('invalid_input', 'mentionLimit is an integer from 1 to 1,000');
  return value as number;
}

/** Validate Team's envelope independently of Agent's mutable context model. */
export function validateGroupContextEntry(value: unknown): asserts value is GroupContextEntry {
  if (!value || typeof value !== 'object') throw new AppError('corrupt_data', 'Invalid group context entry', 500);
  const entry = value as GroupContextEntry;
  identity(entry.messageId, 'messageId'); validateMessage(entry.message);
  if (entry.message.role !== 'user' || !entry.metadata || entry.metadata.source !== 'group-chat') throw new AppError('corrupt_data', 'Group context requires public user-role content', 500);
  const metadata = entry.metadata;
  const text = typeof entry.message.content === 'string' ? entry.message.content : entry.message.content[0]?.type === 'text' ? entry.message.content[0].text : '';
  const record = {workspaceId: metadata.workspaceId, messageId: entry.messageId, position: metadata.groupPosition,
    exchangeId: metadata.exchangeId, author: metadata.author, recipients: metadata.recipients, time: entry.message.timestamp,
    text, ...(metadata.attachments ? {attachments: metadata.attachments} : {})} as unknown as ChatMessage;
  identity(record.workspaceId); identity(record.exchangeId); position(record.position);
  if (!record.position || !Number.isSafeInteger(record.time) || record.time < 0) throw new AppError('corrupt_data', 'Invalid group position or time', 500);
  validateRouting(record.author, record.recipients);
  const prefix = `[Group message ${record.position}]\n${groupSender(record)}\n${record.recipients.length ? `[Mentioned members: ${record.recipients.join(', ')}]\n` : ''}`;
  if (!text.startsWith(prefix)) throw new AppError('corrupt_data', 'Group sender content differs from authoritative metadata', 500);
  chatText(text.slice(prefix.length), record.attachments);
  const images = typeof entry.message.content === 'string' ? [] : entry.message.content.filter(block => block.type === 'image');
  if (images.length !== (record.attachments?.length ?? 0)) throw new AppError('corrupt_data', 'Group picture blocks differ from metadata', 500);
  if (images.some((image, index) => image.mimeType !== record.attachments![index]!.mimeType)) throw new AppError('corrupt_data', 'Group picture MIME differs from metadata', 500);
  if (metadata.finalRef !== undefined) {
    const ref = metadata.finalRef as unknown as FinalReference;
    if (!ref || record.author.type !== 'member' || ref.agentId !== record.author.memberId || ref.runId !== record.author.runId) throw new AppError('corrupt_data', 'Invalid group final origin', 500);
    identity(ref.messageId); position(ref.position);
    if (!ref.position) throw new AppError('corrupt_data', 'Invalid group final origin position', 500);
  }
}

/** The Agent port is a detached projection of Team-owned Pi messages, not reconstructed text. */
export function groupContextMessage(entry: GroupContextEntry): GroupContextMessage {
  if (entry.metadata.source === 'group-summary') return { position: Number(entry.metadata.groupPosition), entry, sender: 'Sender: Team shared context [system]' };
  const author = entry.metadata.author as unknown as ChatAuthor;
  const ref = entry.metadata.finalRef as unknown as FinalReference | undefined;
  return {position: Number(entry.metadata.groupPosition), sender: groupSender({author}), entry,
    ...(ref ? {origin: {agentId: ref.agentId, messageId: ref.messageId}} : {})};
}
