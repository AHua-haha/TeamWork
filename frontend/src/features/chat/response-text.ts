import type { AssistantMessage, TextContent } from '@earendil-works/pi-ai';

function phase(block: TextContent): string | undefined {
  if (!block.textSignature) return;
  try {
    const value = JSON.parse(block.textSignature);
    if (value?.v === 1 && typeof value.id === 'string' && ['commentary', 'final_answer'].includes(value.phase)) return value.phase;
  } catch { /* Other provider signatures are opaque. */ }
}

/** Presentation only: hide a possible leading envelope until its body can stream. */
function bodyStart(text: string): number {
  const start = text.search(/\S/u);
  if (start < 0) return text.length;
  const prefix = text.slice(start);
  if ('<mentions>'.startsWith(prefix)) return text.length;
  if (!prefix.startsWith('<mentions')) return 0;
  const end = text.indexOf('</mentions>', start);
  if (end < 0) return text.length;
  const after = end + '</mentions>'.length;
  return after + (/^(?:[ \t]*\r?\n)+/u.exec(text.slice(after))?.[0].length ?? 0);
}

/** Preserve each source block's identity and native commentary; never decide routing or acceptance. */
export function responseTextBlocks(message: AssistantMessage): Map<number, string> {
  const blocks = message.content.flatMap((part, index) => part.type === 'text' && part.text.trim() ? [{ index, part, phase: phase(part) }] : []);
  const explicit = blocks.some(block => block.phase === 'final_answer');
  const selected = blocks.filter(block => explicit ? block.phase === 'final_answer' : block.phase === undefined);
  const offset = bodyStart(selected.map(block => block.part.text).join('\n'));
  let cursor = 0;
  return new Map(selected.map(({ index, part }) => {
    const visible = part.text.slice(Math.max(0, offset - cursor));
    cursor += part.text.length + 1;
    return [index, visible];
  }));
}
