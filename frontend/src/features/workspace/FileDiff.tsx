import type { FileChange } from '../../shared/backend-client/index.js';
import { Glyph } from './Glyph.js';
import { diffLines } from './file-diff.js';

/** Pending file review for both scopes; approval controls live outside the diff. */
export function FileDiff({ files, selected, onSelect }: { files: FileChange[]; selected: string | null; onSelect(path: string): void }) {
  const file = files.find(item => item.path === selected) ?? files[0];
  const lines = file ? diffLines(file.patch) : [];
  return <section className="change-files" aria-label="Pending file changes">
    <div className="change-files-heading"><h3>Changed files <span>{files.length}</span></h3><span>Committed → current</span></div>
    {!file ? <p className="changes-empty">No pending design or member changes.</p> : <div className="change-diff-layout">
      <nav className="change-file-list" aria-label="Changed files">{files.map(item => <button type="button" key={item.path} className={file.path === item.path ? 'selected' : ''} aria-current={file.path === item.path ? 'true' : undefined} onClick={() => onSelect(item.path)}>
        <Glyph name="file" /><span><small>{item.path.startsWith('.rsi/context/design/') ? 'Design' : 'Members'}</small><code>{item.path.replace(/^\.rsi\//, '')}</code></span><span className={`file-action ${item.action}`} aria-label={item.action}>{item.action === 'add' ? 'A' : item.action === 'delete' ? 'D' : 'M'}</span>
      </button>)}</nav>
      <div className="change-text-diff" aria-label={`Diff for ${file.path}`}>
        <header><Glyph name="file" /><code>{file.path}</code><span>Unified diff</span></header>
        <div className="change-diff-lines">{lines.map((line, index) => <div key={index} className={`change-diff-line ${line.kind}`}>
          <span className="diff-number" aria-hidden="true">{line.before}</span><span className="diff-number" aria-hidden="true">{line.after}</span><span className="diff-sign" aria-hidden="true">{line.kind === 'add' ? '+' : line.kind === 'delete' ? '−' : ''}</span><code>{line.text || ' '}</code>
        </div>)}</div>
        {!lines.length && <p className="changes-empty">No text preview is available for this change.</p>}
        {file.truncated && <p className="changes-note">Diff preview reached its size limit.</p>}
      </div>
    </div>}
  </section>;
}
