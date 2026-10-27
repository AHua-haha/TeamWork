import { groupEntry, groupSender, type ChatMessage } from '../src/core/team/data/group-chat.js';
import { prepareGroupSummary, type GroupSummary } from '../src/core/team/data/group-summary.js';

export function summaryMessages(count = 40, size = 4000, workspaceId = 'workspace') {
  return Array.from({length: count}, (_, index) => {
    const position = index + 1;
    const chat: ChatMessage = { workspaceId, messageId: `g${position}`, position, exchangeId: `e${position}`, author: { type: 'user' }, text: `Message ${position}: ${'x'.repeat(size)}`, recipients: [], time: position };
    return { position, entry: groupEntry(chat), sender: groupSender(chat) };
  });
}
export function acceptedSummary(messages = summaryMessages(), previous?: GroupSummary): GroupSummary {
  const input = prepareGroupSummary(messages, 0, previous);
  return { revision: input.baseRevision + 1, from: input.from, through: input.through, analyzedThrough: input.analyzedThrough,
    sourceDigest: input.sourceDigest, text: 'Shared goals, decisions and outstanding work.', messageId: `summary-${input.baseRevision + 1}`, time: 1 };
}
