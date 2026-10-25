import { createHash } from 'node:crypto';
import type { GroupContextMessage, GroupSemanticIndex, GroupSemanticNode } from '../../agent/data/context.js';
import { AppError, identity, position } from '../../agent/data/model.js';

export const semanticTokenThreshold = 32_000;
export interface GroupSemanticSubmission {
  baseRevision: number;
  through: number;
  sourceDigest: string;
  tree: GroupSemanticNode[];
}

export function semanticSourceDigest(messages: readonly GroupContextMessage[]): string {
  const source = messages.map(item => ({ position: item.position, messageId: item.entry.messageId, entry: item.entry }));
  return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}

export function semanticTokenCount(messages: readonly GroupContextMessage[]): number {
  // Keep the trigger based on public group content only. This deliberately excludes
  // system prompts/tools used by the maintenance model.
  return messages.reduce((total, item) => total + Math.max(1, Math.ceil(JSON.stringify(item.entry.message).length / 4)), 0);
}

export function validateSemanticNode(value: unknown, maxPosition: number, parent?: { first: number; last: number }): asserts value is GroupSemanticNode {
  if (!value || typeof value !== 'object') throw new AppError('invalid_input', 'Invalid semantic range node');
  const node = value as GroupSemanticNode;
  identity(node.id, 'semantic node id');
  if (!Number.isSafeInteger(node.firstPosition) || node.firstPosition < 1 || !Number.isSafeInteger(node.lastPosition) || node.lastPosition < node.firstPosition || node.lastPosition > maxPosition)
    throw new AppError('invalid_input', 'Invalid semantic range');
  if (parent && (node.firstPosition < parent.first || node.lastPosition > parent.last)) throw new AppError('invalid_input', 'Semantic child range is outside its parent');
  if (typeof node.topic !== 'string' || !node.topic.trim() || node.topic.length > 1000 || typeof node.summary !== 'string' || !node.summary.trim() || node.summary.length > 100_000)
    throw new AppError('invalid_input', 'Semantic range topic and summary are required');
  if (!Array.isArray(node.involvedMemberIds) || new Set(node.involvedMemberIds).size !== node.involvedMemberIds.length) throw new AppError('invalid_input', 'Invalid semantic involved members');
  for (const id of node.involvedMemberIds) identity(id, 'involved member');
  if (!Array.isArray(node.children)) throw new AppError('invalid_input', 'Invalid semantic range children');
  let previous = 0;
  for (const child of node.children) {
    validateSemanticNode(child, maxPosition, { first: node.firstPosition, last: node.lastPosition });
    if (child.firstPosition <= previous) throw new AppError('invalid_input', 'Semantic sibling ranges overlap or are unordered');
    previous = child.lastPosition;
  }
}

export function validateSemanticSubmission(value: unknown, startPosition: number): asserts value is GroupSemanticSubmission {
  if (!value || typeof value !== 'object') throw new AppError('invalid_input', 'Invalid semantic submission');
  const submission = value as GroupSemanticSubmission;
  if (!Number.isSafeInteger(submission.baseRevision) || submission.baseRevision < 0 || !Number.isSafeInteger(submission.through) || submission.through < startPosition)
    throw new AppError('invalid_input', 'Invalid semantic submission revision or boundary');
  if (typeof submission.sourceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(submission.sourceDigest)) throw new AppError('invalid_input', 'Invalid semantic source digest');
  if (!Array.isArray(submission.tree) || !submission.tree.length) throw new AppError('invalid_input', 'Semantic tree is required');
  let previous = startPosition - 1;
  for (const node of submission.tree) {
    validateSemanticNode(node, submission.through);
    if (node.firstPosition !== previous + 1) throw new AppError('invalid_input', 'Semantic root ranges must cover the complete source prefix');
    previous = node.lastPosition;
  }
  if (previous !== submission.through) throw new AppError('invalid_input', 'Semantic root ranges do not cover the submitted boundary');
}

export function validateSemanticInvolvement(tree: readonly GroupSemanticNode[], messages: readonly GroupContextMessage[], memberIds: ReadonlySet<string>): void {
  const byPosition = new Map(messages.map(message => [message.position, message]));
  const visit = (node: GroupSemanticNode): void => {
    const expected = new Set<string>();
    for (let position = node.firstPosition; position <= node.lastPosition; position++) {
      const message = byPosition.get(position);
      if (!message) throw new AppError('invalid_input', 'Semantic range references a missing group message');
      const author = message.entry.metadata.author as { type?: unknown; memberId?: unknown } | undefined;
      if (author?.type === 'member' && typeof author.memberId === 'string') expected.add(author.memberId);
      const recipients = message.entry.metadata.recipients;
      if (Array.isArray(recipients)) for (const recipient of recipients) if (typeof recipient === 'string') expected.add(recipient);
    }
    const actual = new Set(node.involvedMemberIds);
    for (const memberId of actual) {
      if (!memberIds.has(memberId)) throw new AppError('invalid_input', 'Semantic involvement references an unknown member');
    }
    if (actual.size !== expected.size || [...actual].some(memberId => !expected.has(memberId))) throw new AppError('invalid_input', 'Semantic involvement must match authoritative senders and mentions');
    for (const child of node.children) visit(child);
  };
  for (const node of tree) visit(node);
}

export function validateSemanticIndex(value: unknown): asserts value is GroupSemanticIndex {
  if (!value || typeof value !== 'object') throw new AppError('corrupt_data', 'Invalid semantic index', 500);
  const index = value as GroupSemanticIndex;
  if (!Number.isSafeInteger(index.revision) || index.revision < 1 || !Number.isSafeInteger(index.from) || index.from < 1 || !Number.isSafeInteger(index.through) || index.through < index.from)
    throw new AppError('corrupt_data', 'Invalid semantic index boundary', 500);
  if (typeof index.sourceDigest !== 'string' || !/^[a-f0-9]{64}$/.test(index.sourceDigest) || !Array.isArray(index.tree)) throw new AppError('corrupt_data', 'Invalid semantic index', 500);
  let previous = index.from - 1;
  for (const node of index.tree) {
    validateSemanticNode(node, index.through);
    if (node.firstPosition !== previous + 1) throw new AppError('corrupt_data', 'Semantic index roots do not cover the source', 500);
    previous = node.lastPosition;
  }
  if (previous !== index.through) throw new AppError('corrupt_data', 'Semantic index does not cover its boundary', 500);
}

