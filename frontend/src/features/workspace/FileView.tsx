import { writableContextPath } from './context-path.js';
import { Fragment, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { BackendError } from '../../shared/backend-client/index.js';
import type { Author, ContextFeed, ContextFile, ContextVersion, ProjectFile, WorkspaceClient } from '../../shared/backend-client/index.js';
import { errorText } from './FileTree.js';
import { Glyph } from './Glyph.js';
import { Markdown } from '../chat/Markdown.js';
import { resolveLink } from '../chat/markdown-parser.js';

export type FileSource = 'context' | 'project';
export interface FileTarget { source: FileSource; path: string }
type Loaded = ProjectFile | ContextFile;

export const isWritable = (target: FileTarget) => target.source === 'project' || writableContextPath(target.path);
const isContextFile = (file: Loaded): file is ContextFile => 'author' in file;
const formatTime = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const authorLabel = (author: Author) => author.type === 'user' ? 'edited in app' : author.type === 'lead' ? 'edited by lead' : 'changed on disk';
const actionLabel = (version: ContextVersion) => ({ create: 'Created', update: 'Edited', move: `Moved from ${version.fromPath}`, delete: 'Deleted' })[version.action];

/**
 * `file` is the current version as last read and `draft` is the text being edited; the file is dirty when they differ.
 * `incoming` holds a newer current version that conflicts with the draft until the user picks one.
 */
interface ViewState { file: Loaded | null; draft: string; incoming: Loaded | null; deleted: boolean; error: string | null }
type ViewAction =
  | { type: 'read'; file: Loaded }
  | { type: 'failed'; error: string; missing: boolean }
  | { type: 'edit'; draft: string }
  | { type: 'saved'; content: string; revision: string }
  | { type: 'deleted' }
  | { type: 'discard' }
  | { type: 'take' };

function reduce(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case 'read': {
      const { file } = action;
      const clean = !state.file || state.draft === state.file.content;
      if (clean || file.content === state.file!.content || file.content === state.draft) return { file, draft: clean ? file.content : state.draft, incoming: null, deleted: false, error: null };
      return { ...state, incoming: file, deleted: false, error: null };
    }
    case 'failed': return action.missing && state.file ? { ...state, incoming: null, deleted: true, error: null } : { ...state, error: action.error };
    case 'edit': return { ...state, draft: action.draft };
    case 'saved': return state.file ? { ...state, file: { ...state.file, content: action.content, revision: action.revision }, incoming: null, deleted: false } : state;
    case 'deleted': return state.file ? { ...state, incoming: null, deleted: true } : state;
    case 'discard': return state.file ? { ...state, draft: state.file.content } : state;
    case 'take': return state.incoming ? { ...state, file: state.incoming, draft: state.incoming.content, incoming: null } : state;
  }
}

interface FileViewProps {
  client: WorkspaceClient;
  workspaceId: string;
  workspaceName: string;
  target: FileTarget;
  feed: ContextFeed | null;
  startEditing: boolean;
  onMoved(path: string): void;
  onOpenLink(target: FileTarget): void;
  onRename(): void;
  onDelete(): void;
  onDirty(dirty: boolean): void;
}

/** Shows one file with Markdown preview and plain-text editing; context files follow the change feed. */
export function FileView({ client, workspaceId, workspaceName, target, feed, startEditing, onMoved, onOpenLink, onRename, onDelete, onDirty }: FileViewProps) {
  const { source, path } = target;
  const [state, dispatch] = useReducer(reduce, { file: null, draft: '', incoming: null, deleted: false, error: null });
  const markdown = /\.(md|markdown)$/i.test(path);
  const [mode, setMode] = useState<'preview' | 'text'>(markdown && !startEditing ? 'preview' : 'text');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [version, setVersion] = useState<ContextFile | null>(null);
  const reads = useRef(0);
  const text = useRef<HTMLTextAreaElement>(null);
  const writable = isWritable(target);
  const loaded = state.file !== null;
  const dirty = loaded && state.draft !== state.file!.content;
  const canSave = writable && loaded && (dirty || state.deleted) && !saving;
  const shown = markdown ? mode : 'text';

  const refresh = useCallback(async () => {
    const token = ++reads.current;
    try {
      const file = source === 'context' ? await client.readContext(workspaceId, { path }) : await client.readProject(workspaceId, path);
      if (token === reads.current) dispatch({ type: 'read', file });
    } catch (cause) {
      if (token === reads.current) dispatch({ type: 'failed', error: errorText(cause), missing: cause instanceof BackendError && cause.status === 404 });
    }
  }, [client, workspaceId, source, path]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!feed || source !== 'context') return;
    const key = path.toLowerCase();
    return feed.onRecord(record => {
      for (const change of record.files) {
        if (change.action === 'move' && change.fromPath?.toLowerCase() === key) { onMoved(change.path); return; }
        if (change.path.toLowerCase() !== key) continue;
        if (change.action === 'delete') { reads.current++; dispatch({ type: 'deleted' }); }
        else void refresh();
      }
    });
  }, [feed, source, path, refresh, onMoved]);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => { if (startEditing && loaded) text.current?.focus(); }, [startEditing, loaded]);

  async function save(base = state.deleted ? null : state.file?.revision ?? null) {
    if (!state.file || saving) return;
    const content = state.draft;
    setSaving(true); setSaveError(null);
    try {
      const result = source === 'context' ? await client.saveContext(workspaceId, path, content, base) : await client.saveProject(workspaceId, path, content, base);
      dispatch({ type: 'saved', content, revision: result.revision });
      void refresh();
    } catch (cause) {
      const conflict = cause instanceof BackendError && (cause.code === 'stale_revision' || cause.code === 'file_exists');
      setSaveError(conflict ? 'Not saved: the file changed since it was loaded. Review the latest version, then save again.' : errorText(cause));
      if (conflict) void refresh();
    } finally { setSaving(false); }
  }
  async function restore(old: ContextFile) {
    if (!state.file) return;
    setSaving(true); setSaveError(null);
    try {
      await client.saveContext(workspaceId, path, old.content, state.deleted ? null : state.file.revision, `Restored the version from ${formatTime(old.updatedAt)}`);
      setVersion(null);
      void refresh();
    } catch (cause) { setSaveError(errorText(cause)); }
    finally { setSaving(false); }
  }
  async function showVersion(entry: ContextVersion) {
    if (!entry.revision) return;
    setSaveError(null);
    try { setVersion(entry.revision === state.file?.revision ? null : await client.readContext(workspaceId, { revision: entry.revision })); }
    catch (cause) { setSaveError(errorText(cause)); }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(version?.content ?? state.draft);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { setSaveError('The clipboard is not available in this browser.'); }
  }
  const openLink = (href: string) => {
    const resolved = resolveLink(path, href);
    if (resolved) onOpenLink({ source, path: resolved });
  };

  const content = version?.content ?? state.draft;
  const meta = version ?? state.file;
  const folders = path.split('/');
  const name = folders.pop()!;
  return <div className="file-view" onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (canSave && !version) void save(); }
  }}>
    <header className="file-head">
      <nav className="file-crumbs" aria-label="File location" title={path}>
        {[workspaceName, ...(source === 'context' ? ['Context base'] : []), ...folders].map((part, index) => <Fragment key={index}><span className="crumb">{part}</span><span className="crumb-separator" aria-hidden="true">›</span></Fragment>)}
        <strong>{name}</strong>
        {dirty && <span className="file-dirty" title="Unsaved changes" aria-label="Unsaved changes">●</span>}
      </nav>
      <div className="file-actions">
        {markdown && <div className="segmented" role="group" aria-label="View mode">
          <button type="button" aria-pressed={shown === 'preview'} aria-label="Preview" title="Preview" onClick={() => setMode('preview')}><Glyph name="eye" /></button>
          <button type="button" aria-pressed={shown === 'text'} aria-label="Plain text" title="Plain text" onClick={() => setMode('text')}><Glyph name="code" /></button>
        </div>}
        {source === 'context' && <button type="button" className="tree-action" aria-pressed={historyOpen} aria-label="Version history" title="Version history" onClick={() => { setHistoryOpen(!historyOpen); setVersion(null); }}><Glyph name="history" /></button>}
        {source === 'project' && <button type="button" className="tree-action" aria-label="Reload from disk" title="Reload from disk" onClick={() => void refresh()}><Glyph name="refresh" /></button>}
        <button type="button" className="tree-action" disabled={!loaded} aria-label={copied ? 'Copied' : 'Copy contents'} title={copied ? 'Copied' : 'Copy contents'} onClick={() => void copy()}><Glyph name={copied ? 'check' : 'copy'} /></button>
        {writable && source === 'context' && !state.deleted && <>
          <button type="button" className="tree-action" aria-label="Rename or move" title="Rename or move" onClick={onRename}><Glyph name="pencil" /></button>
          <button type="button" className="tree-action danger" aria-label="Delete file" title="Delete file" onClick={onDelete}><Glyph name="trash" /></button>
        </>}
        {writable && !version && (dirty || state.deleted) && <>
          {dirty && <button type="button" className="secondary-button" disabled={saving} onClick={() => dispatch({ type: 'discard' })}>Discard</button>}
          <button type="button" className="primary-button" disabled={!canSave} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button>
        </>}
      </div>
    </header>
    {historyOpen && state.file && <FileHistory key={`${path}:${state.file.revision}`} client={client} workspaceId={workspaceId} path={path} current={state.file.revision} selected={version?.revision ?? null} onSelect={entry => void showVersion(entry)} />}
    {saveError && <div className="file-banner file-banner-error" role="alert">{saveError}<button type="button" onClick={() => setSaveError(null)}>Dismiss</button></div>}
    {state.error && <div className="file-banner file-banner-error" role="alert">{state.error}<button type="button" onClick={() => void refresh()}>Retry</button></div>}
    {state.incoming && <div className="file-banner" role="status">This file changed since you started editing.
      <button type="button" disabled={saving} onClick={() => { setSaveError(null); dispatch({ type: 'take' }); }}>Load latest</button>
      <button type="button" disabled={saving} onClick={() => void save(state.incoming!.revision)}>Save mine over it</button></div>}
    {state.deleted && <div className="file-banner" role="status">This file was deleted.{writable ? ' Saving creates it again.' : ''}</div>}
    {version && <div className="file-banner" role="status">Viewing an earlier version.
      {writable && <button type="button" disabled={saving || dirty} title={dirty ? 'Save or discard your changes first' : undefined} onClick={() => void restore(version)}>Restore this version</button>}
      <button type="button" onClick={() => setVersion(null)}>Back to current</button></div>}
    <div className="file-body">
      {!loaded ? <div className="file-empty">{state.error ? 'This file could not be opened.' : 'Loading…'}</div>
        : shown === 'preview' ? <div className="file-preview"><Markdown source={content} onLink={openLink} /></div>
        : <textarea ref={text} className="file-text" value={content} readOnly={!writable || version !== null} spellCheck={false} aria-label={`Contents of ${path}`}
          onChange={event => dispatch({ type: 'edit', draft: event.target.value })} />}
    </div>
    {meta && <footer className="file-foot">
      {version ? 'Version from ' : 'Updated '}{formatTime(meta.updatedAt)} · {formatSize(meta.size)}
      {isContextFile(meta) && <> · {authorLabel(meta.author)}{meta.reason && <> · {meta.reason}</>}</>}
      {!writable && <> · read-only</>}
    </footer>}
  </div>;
}

/** The file's versions, newest first; selecting one shows it read-only in the viewer. */
function FileHistory({ client, workspaceId, path, current, selected, onSelect }: {
  client: WorkspaceClient; workspaceId: string; path: string; current: string; selected: string | null; onSelect(entry: ContextVersion): void;
}) {
  const [versions, setVersions] = useState<ContextVersion[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (before: number | null) => {
    setLoading(true); setError(null);
    try {
      const page = await client.contextHistory(workspaceId, path, before);
      setVersions(list => before === null ? page.versions : [...list, ...page.versions]);
      setNext(page.next);
    } catch (cause) { setError(errorText(cause)); }
    finally { setLoading(false); }
  }, [client, workspaceId, path]);
  useEffect(() => { void load(null); }, [load]);
  return <section className="file-history" aria-label="Version history">
    {error && <div className="tree-note tree-error" role="alert">{error}<button type="button" onClick={() => void load(null)}>Retry</button></div>}
    {loading && !versions.length && <div className="tree-note">Loading history…</div>}
    <ol>{versions.map(entry => <li key={entry.seq}>
      <button type="button" disabled={!entry.revision} aria-current={(selected ?? current) === entry.revision ? 'true' : undefined} onClick={() => onSelect(entry)}>
        <strong>{actionLabel(entry)}{entry.revision === current && <span className="history-current">current</span>}</strong>
        <span>{formatTime(entry.time)} · {authorLabel(entry.author)}</span>
        {entry.reason && <em>{entry.reason}</em>}
      </button>
    </li>)}</ol>
    {next !== null && <button type="button" className="text-button" disabled={loading} onClick={() => void load(next)}>{loading ? 'Loading…' : 'Load older'}</button>}
  </section>;
}
