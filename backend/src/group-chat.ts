import type { RunState, ContextEntry } from './types.js';
import { AppError, identity, position } from './types.js';

export const maxChatCharacters = 20_000;
export const defaultMentionLimit = 32;
export type ChatAuthor = { type: 'user' } | { type: 'member'; memberId: string; name: string; runId: string };
export interface ChatMessage {
  workspaceId: string; messageId: string; position: number; exchangeId: string;
  author: ChatAuthor; text: string; recipients: string[]; time: number;
}
export interface ChatSnapshot {
  workspaceId: string; position: number; mentionLimit: number; messages: ChatMessage[]; more: boolean;
  runs: { exchangeId: string; run: RunState }[];
}
export interface ChatPublication {
  workspaceId: string; author: ChatAuthor; text: string; recipients: string[]; exchangeId?: string;
}
export interface ChatStore {
  publishChat(input: ChatPublication): Promise<{ message: ChatMessage; runs: RunState[] }>;
  chatSnapshot(workspaceId: string, after?: number, limit?: number): Promise<ChatSnapshot>;
  syncChatMember(memberId: string): Promise<void>;
  configureChat(workspaceId: string, mentionLimit: number): Promise<void>;
  stopChat(workspaceId: string): Promise<RunState[]>;
}

export function validateChatMessage(value: unknown): asserts value is ChatMessage {
  if (!value || typeof value !== 'object') throw new AppError('invalid_data', 'Invalid chat message');
  const message = value as ChatMessage;
  identity(message.workspaceId); identity(message.messageId); identity(message.exchangeId);
  position(message.position);
  if (!message.position || !Number.isSafeInteger(message.time) || message.time < 0) throw new AppError('invalid_data', 'Invalid chat position or time');
  chatText(message.text);
  if (!Array.isArray(message.recipients) || new Set(message.recipients).size !== message.recipients.length) throw new AppError('invalid_data', 'Invalid chat recipients');
  for (const recipient of message.recipients) identity(recipient);
  if (!message.author || !['user', 'member'].includes(message.author.type)) throw new AppError('invalid_data', 'Invalid chat author');
  if (message.author.type === 'member') {
    identity(message.author.memberId); identity(message.author.runId);
    if (typeof message.author.name !== 'string' || !message.author.name) throw new AppError('invalid_data', 'Invalid chat author name');
  }
}

export function chatText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxChatCharacters) throw new AppError('invalid_input', `A group message has 1–${maxChatCharacters} characters`);
  return value;
}

/** Explicit routing tokens; an @ inside an email or identifier is ordinary text. */
export function mentions(text: string): string[] {
  for (const match of text.matchAll(/(^|[^\p{L}\p{N}_.@-])@\{/gu)) {
    const tail = text.slice(match.index! + match[1]!.length + 2);
    const end = tail.indexOf('}');
    if (end < 1 || /[{}\r\n]/.test(tail.slice(0, end))) throw new AppError('invalid_input', 'Use a complete named mention, for example @{Backend Worker}');
  }
  const result = new Map<string, string>();
  const pattern = /(^|[^\p{L}\p{N}_.@-])@(?:\{([^{}\r\n]+)\}|([A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?))/gu;
  for (const match of text.matchAll(pattern)) {
    const name = (match[2] ?? match[3])!;
    result.set(name.toLowerCase(), name);
  }
  return [...result.values()];
}

export function groupEntry(message: ChatMessage): ContextEntry {
  const author = message.author.type === 'user' ? 'User' : message.author.name;
  return {
    messageId: message.messageId,
    message: { role: 'user', content: `[Group message ${message.position} from ${author}]\n${message.text}`, timestamp: message.time },
    metadata: { source: 'group-chat', workspaceId: message.workspaceId, groupPosition: message.position, author: message.author },
  };
}

export function mentionLimit(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 1000) throw new AppError('invalid_input', 'mentionLimit is an integer from 1 to 1,000');
  return value as number;
}
