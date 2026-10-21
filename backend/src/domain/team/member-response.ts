import { AppError } from '../../foundation/types.js';

export interface MemberResponse { body: string; names: string[]; bodyOffset: number }

/** Agent routing has one explicit leading envelope; the Markdown body is never scanned. */
export function parseMemberResponse(text: string): MemberResponse {
  const start = text.search(/\S/u);
  const prefix = start < 0 ? '' : text.slice(start);
  let bodyOffset = 0;
  const names: string[] = [];
  if (prefix.startsWith('<mentions')) {
    const invalid = (): never => { throw new AppError('invalid_mentions', 'Start with <mentions> containing a JSON array of exact member names, then </mentions> and your response body. Omit the block or leave it empty when no member should run.'); };
    if (!prefix.startsWith('<mentions>')) invalid();
    const end = text.indexOf('</mentions>', start + '<mentions>'.length);
    if (end < 0) invalid();
    const content = text.slice(start + '<mentions>'.length, end).trim();
    let value: unknown = [];
    if (content) { try { value = JSON.parse(content); } catch { invalid(); } }
    if (!Array.isArray(value) || value.some(name => typeof name !== 'string' || !name || name.trim() !== name)) invalid();
    const seen = new Set<string>();
    for (const name of value as string[]) {
      const key = name.toLowerCase();
      if (!seen.has(key)) { seen.add(key); names.push(name); }
    }
    if (names.length > 1) throw new AppError('invalid_mentions', 'Mention at most one member per response; revise the leading mention header.');
    const after = end + '</mentions>'.length;
    const separator = /^(?:[ \t]*\r?\n)+/u.exec(text.slice(after))?.[0].length ?? 0;
    bodyOffset = after + separator;
  }
  const body = text.slice(bodyOffset);
  if (!body.trim()) throw new AppError('invalid_input', 'A published agent response must contain a nonempty body after its optional mention header.');
  return { body, names, bodyOffset };
}
