import { createHash } from 'node:crypto';
import type { GroupContextMessage } from '../../agent/data/context.js';
import { AppError, identity } from '../../agent/data/model.js';
import { groupEnvelope, type GroupContextEntry } from './group-chat.js';

export const groupSummaryTokenThreshold = 32_000;
export const retainedGroupMessages = 30;
export const maxGroupSummaryCharacters = 24_000;
export interface GroupSummary {
  revision: number; from: number; through: number; analyzedThrough: number;
  sourceDigest: string; text: string; messageId: string; time: number;
}
export interface GroupSummaryInput {
  previous?: GroupSummary; messages: GroupContextMessage[]; baseRevision: number;
  from: number; through: number; analyzedThrough: number; sourceDigest: string; uncoveredTokens: number;
}
export type GroupSummarySubmission = Pick<GroupSummaryInput, 'baseRevision' | 'from' | 'through' | 'analyzedThrough' | 'sourceDigest'> & { text: string };

export function validateGroupSummaryText(text: unknown): asserts text is string {
  if (typeof text !== 'string' || !text.trim() || text.length > maxGroupSummaryCharacters)
    throw new AppError('invalid_input', `Submit nonempty summary text of at most ${maxGroupSummaryCharacters} characters`);
}

export function validateGroupSummary(value: unknown): asserts value is GroupSummary {
  if (!value || typeof value !== 'object') throw new AppError('corrupt_data', 'Invalid group summary', 500);
  const summary = value as GroupSummary;
  identity(summary.messageId, 'summary messageId');
  if (!Number.isSafeInteger(summary.revision) || summary.revision < 1 || !Number.isSafeInteger(summary.from) || summary.from < 1
    || !Number.isSafeInteger(summary.through) || summary.through < summary.from || !Number.isSafeInteger(summary.analyzedThrough) || summary.analyzedThrough - summary.through !== retainedGroupMessages
    || typeof summary.sourceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(summary.sourceDigest)
    || typeof summary.text !== 'string' || !summary.text.trim() || summary.text.length > maxGroupSummaryCharacters
    || !Number.isSafeInteger(summary.time) || summary.time < 0) throw new AppError('corrupt_data', 'Invalid group summary fields', 500);
}

/** A pinned prefix plus its previous summary; original recent messages never enter the summarizer. */
export function prepareGroupSummary(messages: GroupContextMessage[], resetPosition: number, previous?: GroupSummary, analyzedThrough = messages.at(-1)?.position ?? resetPosition): GroupSummaryInput {
  const snapshot = messages.filter(message => message.position <= analyzedThrough);
  if (!Number.isSafeInteger(analyzedThrough) || analyzedThrough < resetPosition || analyzedThrough > (messages.at(-1)?.position ?? resetPosition))
    throw new AppError('context_conflict', 'Summary source boundary is unavailable', 409);
  const through = snapshot.length > retainedGroupMessages ? snapshot[snapshot.length - retainedGroupMessages - 1]!.position : (previous?.through ?? resetPosition);
  const prefix = snapshot.filter(message => message.position > (previous?.through ?? resetPosition) && message.position <= through);
  const from = resetPosition + 1;
  const sourceDigest = createHash('sha256').update(JSON.stringify({ previous: previous ?? null, from, through, analyzedThrough,
    messages: prefix.map(message => ({ position: message.position, entry: message.entry })) })).digest('hex');
  const uncoveredTokens = snapshot.filter(message => message.position > (previous?.analyzedThrough ?? resetPosition))
    .reduce((sum, message) => sum + Math.max(1, Math.ceil(JSON.stringify(message.entry.message).length / 4)), 0);
  return { ...(previous ? { previous: structuredClone(previous) } : {}), messages: structuredClone(prefix), baseRevision: previous?.revision ?? 0,
    from, through, analyzedThrough, sourceDigest, uncoveredTokens };
}

export function groupSummaryEntry(workspaceId: string, summary: GroupSummary): GroupContextEntry {
  return { messageId: summary.messageId, message: { role: 'user', timestamp: summary.time,
    content: groupEnvelope('system') + summary.text },
    metadata: { source: 'group-summary', workspaceId, groupPosition: summary.through, summaryRevision: summary.revision,
      summaryFrom: summary.from, summaryThrough: summary.through, analyzedThrough: summary.analyzedThrough, author: { type: 'system', name: 'Team shared context' } } };
}
