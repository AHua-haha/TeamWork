/** A small Markdown subset parsed to plain data; rendering never injects HTML, so raw HTML shows as text. */
export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong' | 'em' | 'del'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] };
export type Align = 'left' | 'center' | 'right' | null;
export type Block =
  | { type: 'heading'; level: number; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'code'; language: string; text: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { type: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { type: 'rule' };

const fence = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/;
const heading = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const rule = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const quote = /^ {0,3}>/;
const marker = /^( {0,3})([-*+]|(\d{1,9})[.)])(?: +|$)/;
const delimiterRow = /^ {0,3}\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const indent = (line: string) => line.length - line.trimStart().length;

export function parseMarkdown(source: string): Block[] {
  return blocks(source.replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/^\t+/, tabs => '    '.repeat(tabs.length))));
}

function listStart(line: string): { ordered: boolean; start: number; width: number; rest: string } | null {
  const match = marker.exec(line);
  if (!match) return null;
  const gap = match[0].length - match[1]!.length - match[2]!.length;
  const width = match[1]!.length + match[2]!.length + (gap >= 1 && gap <= 4 ? gap : 1);
  return { ordered: match[3] !== undefined, start: Number(match[3] ?? 1), width, rest: line.slice(width) };
}

const startsBlock = (line: string) => fence.test(line) || heading.test(line) || rule.test(line) || quote.test(line) || listStart(line) !== null;
const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));

function blocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) { index++; continue; }
    const opening = fence.exec(line);
    if (opening) {
      const close = new RegExp(`^ {0,3}${opening[1]![0] === '`' ? '`' : '~'}{${opening[1]!.length},}\\s*$`);
      const body: string[] = [];
      for (index++; index < lines.length && !close.test(lines[index]!); index++) body.push(lines[index]!);
      index++;
      out.push({ type: 'code', language: opening[2]!, text: body.join('\n') });
      continue;
    }
    const title = heading.exec(line);
    if (title) { out.push({ type: 'heading', level: title[1]!.length, children: parseInline(title[2] ?? '') }); index++; continue; }
    if (rule.test(line)) { out.push({ type: 'rule' }); index++; continue; }
    if (quote.test(line)) {
      const body: string[] = [];
      for (; index < lines.length && quote.test(lines[index]!); index++) body.push(lines[index]!.replace(/^ {0,3}> ?/, ''));
      out.push({ type: 'quote', children: blocks(body) });
      continue;
    }
    const first = listStart(line);
    if (first) {
      const items: Block[][] = [];
      for (let item: typeof first | null = first; item; ) {
        const body = [item.rest];
        for (index++; index < lines.length; index++) {
          const next = lines[index]!;
          if (!next.trim()) {
            let ahead = index + 1;
            while (ahead < lines.length && !lines[ahead]!.trim()) ahead++;
            if (ahead < lines.length && indent(lines[ahead]!) >= item.width) { body.push(''); continue; }
            break;
          }
          if (indent(next) >= item.width) body.push(next.slice(item.width));
          else if (startsBlock(next)) break;
          else body.push(next.trim());
        }
        items.push(blocks(body));
        let ahead = index;
        while (ahead < lines.length && !lines[ahead]!.trim()) ahead++;
        const following = ahead < lines.length ? listStart(lines[ahead]!) : null;
        item = following && following.ordered === first.ordered ? following : null;
        if (item) index = ahead;
      }
      out.push({ type: 'list', ordered: first.ordered, start: first.start, items });
      continue;
    }
    if (line.includes('|') && index + 1 < lines.length && delimiterRow.test(lines[index + 1]!)) {
      const head = cells(line);
      const align = cells(lines[index + 1]!).map((cell): Align => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : null);
      if (align.length === head.length) {
        const rows: Inline[][][] = [];
        for (index += 2; index < lines.length && lines[index]!.trim() && !startsBlock(lines[index]!); index++) {
          const row = cells(lines[index]!);
          rows.push(head.map((_, column) => parseInline(row[column] ?? '')));
        }
        out.push({ type: 'table', align, head: head.map(cell => parseInline(cell)), rows });
        continue;
      }
    }
    const body = [line.trim()];
    for (index++; index < lines.length && lines[index]!.trim() && !startsBlock(lines[index]!); index++) body.push(lines[index]!.trim());
    out.push({ type: 'paragraph', children: parseInline(body.join('\n')) });
  }
  return out;
}

const punctuation = /[!-/:-@[-`{-~]/;
const wordCharacter = /[\p{L}\p{N}]/u;
const emphasis: [string, 'strong' | 'em' | 'del'][] = [['**', 'strong'], ['__', 'strong'], ['~~', 'del'], ['*', 'em'], ['_', 'em']];
const link = /^\[((?:[^[\]\\]|\\.)*)\]\(\s*<?([^\s<>()]*)>?(?:\s+"[^"]*")?\s*\)/;

/** The index of the closing delimiter, skipping longer runs of a single-character delimiter. */
function closing(text: string, delimiter: string, from: number): number {
  for (let at = text.indexOf(delimiter, from); at >= 0; at = text.indexOf(delimiter, at + 1)) {
    if (delimiter.length === 1) {
      let end = at;
      while (text[end] === delimiter) end++;
      if (end - at > 1) { at = end - 1; continue; }
    }
    if (at === from || /\s/.test(text[at - 1]!)) continue;
    if (delimiter[0] === '_' && wordCharacter.test(text[at + delimiter.length] ?? '')) continue;
    return at;
  }
  return -1;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let plain = '';
  const flush = () => { if (plain) out.push({ type: 'text', text: plain }); plain = ''; };
  let index = 0;
  scan: while (index < text.length) {
    const char = text[index]!;
    const rest = text.slice(index);
    if (char === '\\' && punctuation.test(text[index + 1] ?? '')) { plain += text[index + 1]; index += 2; continue; }
    if (char === '`') {
      const ticks = /^`+/.exec(rest)![0];
      const end = text.indexOf(ticks, index + ticks.length);
      if (end < 0) { plain += ticks; index += ticks.length; continue; }
      flush();
      out.push({ type: 'code', text: text.slice(index + ticks.length, end).replace(/\n/g, ' ') });
      index = end + ticks.length;
      continue;
    }
    if (char === '!' && text[index + 1] === '[') {
      const image = link.exec(rest.slice(1));
      if (image) { plain += image[1]; index += image[0].length + 1; continue; }
    }
    if (char === '[') {
      const found = link.exec(rest);
      if (found) {
        flush();
        out.push({ type: 'link', href: found[2]!, children: parseInline(found[1]!) });
        index += found[0].length;
        continue;
      }
    }
    if (char === '<') {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/.exec(rest);
      if (auto) { flush(); out.push({ type: 'link', href: auto[1]!, children: [{ type: 'text', text: auto[1]! }] }); index += auto[0].length; continue; }
    }
    for (const [delimiter, type] of emphasis) {
      if (!rest.startsWith(delimiter) || /\s/.test(text[index + delimiter.length] ?? ' ')) continue;
      if (delimiter[0] === '_' && wordCharacter.test(text[index - 1] ?? '')) continue;
      const end = closing(text, delimiter, index + delimiter.length);
      if (end < 0) continue;
      flush();
      out.push({ type, children: parseInline(text.slice(index + delimiter.length, end)) });
      index = end + delimiter.length;
      continue scan;
    }
    plain += char;
    index++;
  }
  flush();
  return out;
}

/** Links open in a new tab only for web and mail addresses; any other scheme is shown as text. */
export function externalHref(href: string): string | null {
  return /^(https?:|mailto:)/i.test(href) ? href : null;
}

/** Resolves a relative link against the folder of `from`; null when it leaves the root or has a scheme. */
export function resolveLink(from: string, href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/') || href.startsWith('#')) return null;
  const target = href.replace(/[?#].*$/, '');
  if (!target) return null;
  const parts = from.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    let name: string;
    try { name = decodeURIComponent(segment); }
    catch { return null; }
    if (name === '' || name === '.') continue;
    if (name === '..') { if (!parts.pop()) return null; continue; }
    parts.push(name);
  }
  return parts.length ? parts.join('/') : null;
}
