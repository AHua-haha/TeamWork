import type { Message, TextContent } from '@earendil-works/pi-ai';

/** Pi preserves the native Responses item phase in its versioned text signature. */
export function textPhase(block: TextContent): 'commentary' | 'final_answer' | undefined {
  if (!block.textSignature) return;
  try {
    const value = JSON.parse(block.textSignature);
    if (value?.v === 1 && typeof value.id === 'string' && ['commentary', 'final_answer'].includes(value.phase)) return value.phase;
  } catch { /* Other providers use opaque signatures with no message phase. */ }
}

export interface FinalAnswer { text: string; contentIndices: number[] }

/** Select only a naturally completed answer, after tools and provider generation have finished. */
export function finalAnswer(message: Message): FinalAnswer | null {
  if (message.role !== 'assistant' || message.stopReason !== 'stop' || message.content.some(block => block.type === 'toolCall')) return null;
  const text = message.content.flatMap((block, index) => block.type === 'text' && block.text.trim() ? [{ block, index, phase: textPhase(block) }] : []);
  const explicit = text.filter(item => item.phase === 'final_answer');
  const selected = explicit.length ? explicit : text.filter(item => item.phase === undefined);
  return selected.length ? { text: selected.map(item => item.block.text).join('\n'), contentIndices: selected.map(item => item.index) } : null;
}
