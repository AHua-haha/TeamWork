import type { ConfigurationFileChange } from '../client/workspace-client.js';
import { Glyph } from './Glyph.js';
import { diffLines } from './configuration-diff.js';

/** Conventional file review: flat paths and a text diff, independent of acceptance controls. */
export function ConfigurationDiff({ files, selected, onSelect }: { files: ConfigurationFileChange[]; selected: string | null; onSelect(path: string): void }) {
  const file = files.find(file => file.path === selected) ?? files[0];
  return <section className="configuration-file-review" aria-label="Configuration file changes">
    <div className="configuration-file-heading"><h3>File changes <span>{files.length}</span></h3><span>Active → current</span></div>
    {!file ? <p className="configuration-empty">Current configuration matches the active snapshot.</p> : <div className="configuration-diff-layout">
      <nav className="configuration-file-list" aria-label="Changed files"><div className="configuration-file-root">.team/members/</div>
        {files.map(item => <button type="button" key={item.path} className={file.path === item.path ? 'selected' : ''} aria-current={file.path === item.path ? 'true' : undefined} onClick={() => onSelect(item.path)}>
          <Glyph name="file" /><code>{item.path.replace(/^\.team\/members\//, '')}</code><span className={`file-action ${item.action}`} aria-label={item.action}>{item.action === 'add' ? 'A' : item.action === 'delete' ? 'D' : 'M'}</span>
        </button>)}
      </nav>
      <div className="configuration-text-diff" aria-label={`Diff for ${file.path}`}>
        <header><Glyph name="file" /><code>{file.path}</code><span>Unified diff</span></header>
        <div className="configuration-diff-lines">{diffLines(file.patch).map((line, index) => <div key={index} className={`configuration-diff-line ${line.kind}`}>
          <span className="diff-number" aria-hidden="true">{line.before}</span><span className="diff-number" aria-hidden="true">{line.after}</span><span className="diff-sign" aria-hidden="true">{line.kind === 'add' ? '+' : line.kind === 'delete' ? '−' : ''}</span><code>{line.text || ' '}</code>
        </div>)}</div>
        {file.truncated && <p className="configuration-preview-note">Diff preview reached its size limit.</p>}
      </div>
    </div>}
  </section>;
}
