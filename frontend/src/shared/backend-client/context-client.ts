import type { JsonValue, Message } from '@earendil-works/pi-ai';
import { BackendError } from './agent-client.js';
import { ProtocolError } from './sse.js';

export interface ContextEntry { messageId: string; message: Message; metadata: Record<string, JsonValue> }
export type GroupContextEntry = ContextEntry;
export interface ContextPage<T = unknown> { revision: number; offset: number; total: number; nextOffset: number | null; entries: T[] }
export interface ContextPageOptions { offset?: number; limit?: number; revision?: number }
export interface GroupSemanticNode {
  id: string; firstPosition: number; lastPosition: number; topic: string; summary: string;
  involvedMemberIds: string[]; children: GroupSemanticNode[];
}
export interface GroupSemanticIndex {
  revision: number; from: number; through: number; sourceDigest: string; tree: GroupSemanticNode[];
}

function semanticNode(value: unknown): value is GroupSemanticNode {
  if (!value || typeof value !== 'object') return false;
  const node = value as GroupSemanticNode;
  return typeof node.id === 'string' && !!node.id && Number.isSafeInteger(node.firstPosition) && node.firstPosition >= 1
    && Number.isSafeInteger(node.lastPosition) && node.lastPosition >= node.firstPosition
    && typeof node.topic === 'string' && typeof node.summary === 'string'
    && Array.isArray(node.involvedMemberIds) && node.involvedMemberIds.every(id => typeof id === 'string')
    && Array.isArray(node.children) && node.children.every(semanticNode);
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string; code?: string } } | null;
    throw new BackendError(payload?.error?.message ?? `Request failed (${response.status})`, response.status, payload?.error?.code ?? 'http_error');
  }
  return response.json();
}
function validateContextEntry(value: unknown): value is ContextEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ContextEntry>;
  return typeof entry.messageId === 'string' && entry.messageId.length > 0 && !!entry.message && typeof entry.message === 'object'
    && ['system', 'user', 'assistant', 'toolResult'].includes(String(entry.message.role)) && !!entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata);
}
function page<T>(value: unknown): ContextPage<T> {
  if (!value || typeof value !== 'object') throw new ProtocolError('Invalid context page');
  const result = value as Partial<ContextPage<T>>;
  if (!Number.isSafeInteger(result.revision) || (result.revision as number) < 0 || !Number.isSafeInteger(result.offset) || (result.offset as number) < 0
    || !Number.isSafeInteger(result.total) || (result.total as number) < 0 || (result.nextOffset !== null && (!Number.isSafeInteger(result.nextOffset) || (result.nextOffset as number) < 0))
    || !Array.isArray(result.entries) || result.entries.some(entry => !validateContextEntry(entry))) throw new ProtocolError('Invalid context page');
  return result as ContextPage<T>;
}
const identity = /^[A-Za-z0-9_-]{1,64}$/;

/** Read-only paged inspection of retained Pi message context. */
export class ContextClient {
  constructor(private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis), private readonly basePath = '/workspaces') {}
  async semantic(workspaceId: string): Promise<{ index: GroupSemanticIndex | null }> {
    if (!identity.test(workspaceId)) throw new Error('Invalid workspace identity');
    const response = await this.fetcher(`${this.basePath}/${encodeURIComponent(workspaceId)}/team/chat/semantic-index`, {
      method: 'GET', headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    });
    const result = await readJson(response) as { index?: GroupSemanticIndex | null } | null;
    if (result && result.index === null) return { index: null };
    const index = result?.index;
    if (!index || !Number.isSafeInteger(index.revision) || index.revision < 1 || !Number.isSafeInteger(index.from) || index.from < 1
      || !Number.isSafeInteger(index.through) || index.through < index.from || typeof index.sourceDigest !== 'string'
      || !Array.isArray(index.tree) || !index.tree.every(semanticNode)) throw new ProtocolError('Invalid group semantic index');
    return { index };
  }
  private async read<T>(path: string, options: ContextPageOptions): Promise<ContextPage<T>> {
    const query = new URLSearchParams();
    if (options.offset !== undefined) query.set('offset', String(options.offset));
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    if (options.revision !== undefined) query.set('revision', String(options.revision));
    const suffix = query.toString();
    const response = await this.fetcher(`${path}${suffix ? `?${suffix}` : ''}`, { method: 'GET', headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
    return page<T>(await readJson(response));
  }
  group(workspaceId: string, options: ContextPageOptions = {}): Promise<ContextPage<GroupContextEntry>> {
    if (!identity.test(workspaceId)) throw new Error('Invalid workspace identity');
    return this.read(`${this.basePath}/${encodeURIComponent(workspaceId)}/team/chat/context`, options);
  }
  member(workspaceId: string, memberId: string, options: ContextPageOptions = {}): Promise<ContextPage<ContextEntry>> {
    if (!identity.test(workspaceId) || !identity.test(memberId)) throw new Error('Invalid context identity');
    return this.read(`${this.basePath}/${encodeURIComponent(workspaceId)}/team/members/${encodeURIComponent(memberId)}/context`, options);
  }
}
