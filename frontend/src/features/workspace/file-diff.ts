export interface DiffLine { kind: 'context' | 'add' | 'delete' | 'hunk' | 'note'; before: number | null; after: number | null; text: string }
/** Interpret Git's unified text patch without treating file contents as markup. */
export function diffLines(patch: string): DiffLine[] {
  let before = 0, after = 0, inHunk = false;
  const result: DiffLine[] = [];
  for (const text of patch.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) { before = Number(hunk[1]); after = Number(hunk[2]); inHunk = true; result.push({ kind: 'hunk', before: null, after: null, text }); }
    else if (inHunk && text.startsWith('+')) result.push({ kind: 'add', before: null, after: after++, text: text.slice(1) });
    else if (inHunk && text.startsWith('-')) result.push({ kind: 'delete', before: before++, after: null, text: text.slice(1) });
    else if (inHunk && text.startsWith(' ')) result.push({ kind: 'context', before: before++, after: after++, text: text.slice(1) });
    else if (text.startsWith('Binary files') || text.startsWith('\\ No newline') || text.startsWith('old mode') || text.startsWith('new mode')) result.push({ kind: 'note', before: null, after: null, text });
  }
  return result;
}
