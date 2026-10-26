import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BackendError } from '../../shared/backend-client/index.js';
import type { Entry, Listing } from '../../shared/backend-client/index.js';

export const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'Request failed';
export const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
export const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
/** Every folder above `path`, outermost first. */
export const ancestorsOf = (path: string) => path.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/'));

interface FolderState { listing: Listing | null; error: string | null }
export interface Folders {
  folders: Record<string, FolderState>;
  open: ReadonlySet<string>;
  toggle(path: string): void;
  expand(paths: string[]): void;
  /** Re-reads every open folder; a folder that no longer exists closes. */
  reload(): void;
}

/** Lazily loads open folders. A folder is read again once per `reload()` generation while it is open. */
export function useFolders(load: (path: string) => Promise<Listing>, initial: string[]): Folders {
  const [roots] = useState(initial);
  const [folders, setFolders] = useState<Record<string, FolderState>>({});
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(roots));
  const [generation, setGeneration] = useState(0);
  const requested = useRef(new Map<string, number>());

  useEffect(() => {
    const update = (path: string, change: (state: FolderState | undefined) => FolderState | null) => setFolders(current => {
      const { [path]: state, ...rest } = current;
      const next = change(state);
      return next ? { ...rest, [path]: next } : rest;
    });
    for (const path of open) {
      if (requested.current.get(path) === generation) continue;
      requested.current.set(path, generation);
      const latest = () => requested.current.get(path) === generation;
      update(path, state => ({ listing: state?.listing ?? null, error: null }));
      load(path).then(listing => { if (latest()) update(path, () => ({ listing, error: null })); }, (cause: unknown) => {
        if (!latest()) return;
        if (cause instanceof BackendError && cause.status === 404 && !roots.includes(path)) {
          requested.current.delete(path);
          update(path, () => null);
          setOpen(current => new Set([...current].filter(item => item !== path)));
        } else update(path, state => ({ listing: state?.listing ?? null, error: errorText(cause) }));
      });
    }
  }, [open, generation, load, roots]);

  const toggle = useCallback((path: string) => setOpen(current => {
    const next = new Set(current);
    if (!next.delete(path)) next.add(path);
    return next;
  }), []);
  const expand = useCallback((paths: string[]) => setOpen(current => paths.every(path => current.has(path)) ? current : new Set([...current, ...paths])), []);
  const reload = useCallback(() => setGeneration(value => value + 1), []);
  return { folders, open, toggle, expand, reload };
}

interface TreeProps {
  tree: Folders;
  path: string;
  depth?: number;
  selected: string | null;
  empty: string;
  onOpen(path: string): void;
  actions?(entry: Entry): ReactNode;
}

const indent = (depth: number) => ({ paddingLeft: 8 + depth * 14 });

/** The children of one loaded folder, folders first, with nested open folders rendered in place. */
export function FolderTree({ tree, path, depth = 0, selected, empty, onOpen, actions }: TreeProps) {
  const state = tree.folders[path];
  if (!state?.listing) {
    if (state?.error) return <div className="tree-note tree-error" style={indent(depth)} role="alert">{state.error}<button type="button" onClick={tree.reload}>Retry</button></div>;
    return <div className="tree-note" style={indent(depth)}>Loading…</div>;
  }
  const entries = [...state.listing.entries].sort((a, b) => Number(a.type === 'file') - Number(b.type === 'file'));
  return <>
    {!entries.length && <div className="tree-note" style={indent(depth)}>{empty}</div>}
    <ul className="tree-list">{entries.map(entry => {
      const expanded = entry.type === 'folder' && tree.open.has(entry.path);
      return <li key={entry.path}>
        <div className={`tree-row ${entry.path === selected ? 'selected' : ''}`}>
          <button type="button" className="tree-item" style={indent(depth)} title={entry.path}
            aria-expanded={entry.type === 'folder' ? expanded : undefined} aria-current={entry.path === selected ? 'true' : undefined}
            onClick={() => entry.type === 'folder' ? tree.toggle(entry.path) : onOpen(entry.path)}>
            <span className="tree-glyph" aria-hidden="true">{entry.type === 'folder' ? (expanded ? '▾' : '▸') : ''}</span>
            <span className={`tree-icon ${entry.type}`} aria-hidden="true" />
            <span className="tree-name">{nameOf(entry.path)}</span>
          </button>
          {actions && <span className="tree-actions">{actions(entry)}</span>}
        </div>
        {expanded && <FolderTree tree={tree} path={entry.path} depth={depth + 1} selected={selected} empty="Empty folder" onOpen={onOpen} actions={actions} />}
      </li>;
    })}</ul>
    {state.listing.truncated && <div className="tree-note" style={indent(depth)}>Showing the first {entries.length} entries</div>}
    {state.error && <div className="tree-note tree-error" style={indent(depth)} role="alert">{state.error}<button type="button" onClick={tree.reload}>Retry</button></div>}
  </>;
}
