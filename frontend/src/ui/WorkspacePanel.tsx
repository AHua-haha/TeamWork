import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ContextFeed, WorkspaceClient, type ContextOverview, type Entry, type FeedSnapshot, type Found, type Workspace } from '../client/workspace-client.js';
import { ancestorsOf, errorText, FolderTree, nameOf, useFolders } from './FileTree.js';
import { FileView, type FileSource, type FileTarget } from './FileView.js';
import { Glyph } from './Glyph.js';
import { TeamTab } from './TeamTab.js';
import type { TeamState } from './useTeam.js';
import { ConfirmDialog, PathDialog } from './WorkspaceDialogs.js';

/** Context paths compare without case, like the backend; project paths compare exactly. */
const sameTarget = (a: FileTarget, b: FileTarget) => a.source === b.source && (a.source === 'context' ? a.path.toLowerCase() === b.path.toLowerCase() : a.path === b.path);
const idle: FeedSnapshot = { seq: 0, connection: 'syncing', error: null };
const idleSnapshot = () => idle;
const noSubscribe = () => () => {};
/** Below this width the tree covers the file view, so opening a file hides the tree. */
const narrow = () => window.matchMedia('(max-width: 760px)').matches;

interface PanelProps {
  open: boolean;
  expanded: boolean;
  /** The workspace of the page, from its address. */
  workspaceId: string;
  /** The workspace's team, read by the page. */
  team: TeamState;
  onExpand(expanded: boolean): void;
  onClose(): void;
  onDirty(dirty: boolean): void;
}

/** The workspace page's sidebar: the pinned Team tab and the open files in tabs, with the workspace tree on the right. */
export function WorkspacePanel({ open, expanded, workspaceId, team, onExpand, onClose, onDirty }: PanelProps) {
  const client = useMemo(() => new WorkspaceClient(), []);
  const [visited, setVisited] = useState(open);
  if (open && !visited) setVisited(true);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setWorkspace(null); setLoadError(null);
    if (!visited) return;
    let current = true;
    client.getWorkspace(workspaceId).then(value => { if (current) setWorkspace(value); }, (cause: unknown) => { if (current) setLoadError(errorText(cause)); });
    return () => { current = false; };
  }, [client, visited, workspaceId, attempt]);

  const actions = <>
    <button type="button" className="tree-action workspace-expand" aria-label={expanded ? 'Restore panel width' : 'Expand panel'} title={expanded ? 'Restore panel width' : 'Expand panel'} onClick={() => onExpand(!expanded)}><Glyph name={expanded ? 'collapse' : 'expand'} /></button>
    <button type="button" className="tree-action" aria-label="Hide workspace files" title="Hide workspace files" onClick={onClose}><Glyph name="panel" /></button>
  </>;
  const titleBar = <PanelBar actions={actions}><span className="workspace-bar-title">WORKSPACE</span></PanelBar>;
  const notice = (content: ReactNode) => <>{titleBar}<div className="workspace-notice">{content}</div></>;

  let body: ReactNode = null;
  if (!visited) body = null;
  else if (loadError) body = notice(<div className="sidebar-error" role="alert">{loadError}<button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></div>);
  else if (!workspace) body = notice(<p className="sidebar-muted">Opening workspace…</p>);
  else body = <WorkspaceView key={workspace.workspaceId} client={client} workspace={workspace} team={team} actions={actions} onDirty={onDirty} />;

  return <aside className={`workspace-panel ${open ? 'open' : ''} ${expanded ? 'expanded' : ''}`} aria-label="Team and files" aria-hidden={!open} inert={!open}>{body}</aside>;
}

/** The panel's top bar: tabs or a title on the left, panel actions on the right. */
function PanelBar({ actions, children }: { actions: ReactNode; children: ReactNode }) {
  return <div className="workspace-bar"><div className="workspace-tabs">{children}</div><div className="workspace-bar-actions">{actions}</div></div>;
}

type DialogState = { type: 'new'; source: FileSource; folder: string } | { type: 'move' | 'delete'; path: string; folder: boolean };
/** An open file. Its handlers are made once, so the file view's effects keep their subscriptions. */
interface Tab extends FileTarget { key: number; startEditing: boolean; onDirty(dirty: boolean): void; onMoved(path: string): void }

function WorkspaceView({ client, workspace, team, actions, onDirty }: { client: WorkspaceClient; workspace: Workspace; team: TeamState; actions: ReactNode; onDirty(dirty: boolean): void }) {
  const id = workspace.workspaceId;
  const [feed, setFeed] = useState<ContextFeed | null>(null);
  const [feedFrom, setFeedFrom] = useState({ seq: workspace.context.seq });
  const [restartError, setRestartError] = useState<string | null>(null);
  const status = useSyncExternalStore(feed?.subscribe ?? noSubscribe, feed?.getSnapshot ?? idleSnapshot);
  const [overview, setOverview] = useState<ContextOverview>(workspace.context);
  const context = useFolders(useCallback((path: string) => client.contextTree(id, path), [client, id]), ['user', 'agent']);
  const project = useFolders(useCallback((path: string) => client.projectTree(id, path), [client, id]), ['']);
  const [filter, setFilter] = useState('');
  const [found, setFound] = useState<{ context: Found; project: Found } | null>(null);
  const [findError, setFindError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  /** The active file tab; null is the pinned Team tab. */
  const [activeKey, setActiveKey] = useState<number | null>(null);
  const [scopeNote, setScopeNote] = useState<string | null>(null);
  const [dirtyKeys, setDirtyKeys] = useState<ReadonlySet<number>>(() => new Set());
  const [treeOpen, setTreeOpen] = useState(true);
  const [filterFocus, setFilterFocus] = useState(0);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [closing, setClosing] = useState<number | null>(null);
  const keys = useRef(0);
  const filterInput = useRef<HTMLInputElement>(null);
  const reloadContext = context.reload;
  const active = tabs.find(tab => tab.key === activeKey) ?? null;
  const showTeam = active === null;
  const closingTab = tabs.find(tab => tab.key === closing);

  useEffect(() => {
    const next = new ContextFeed(id, feedFrom.seq);
    setFeed(next);
    next.start();
    return () => next.dispose();
  }, [id, feedFrom]);
  useEffect(() => {
    if (!feed) return;
    let timer: number | null = null;
    const stop = feed.onRecord(() => {
      timer ??= window.setTimeout(() => {
        timer = null;
        reloadContext();
        client.overview(id).then(next => setOverview(current => next.seq >= current.seq ? next : current), () => { /* The next record refreshes the overview. */ });
      }, 150);
    });
    return () => { stop(); if (timer !== null) window.clearTimeout(timer); };
  }, [feed, client, id, reloadContext]);
  useEffect(() => {
    const q = filter.trim().slice(0, 200);
    setFindError(null);
    if (!q) { setFound(null); return; }
    let current = true;
    const timer = window.setTimeout(() => {
      Promise.all([client.findContext(id, q), client.findProject(id, q)]).then(([context, project]) => { if (current) setFound({ context, project }); },
        (cause: unknown) => { if (current) setFindError(errorText(cause)); });
    }, 200);
    return () => { current = false; window.clearTimeout(timer); };
  }, [client, id, filter]);
  useEffect(() => { onDirty(dirtyKeys.size > 0); }, [dirtyKeys, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  useEffect(() => { if (filterFocus) filterInput.current?.focus(); }, [filterFocus]);

  /** Follows again from the current sequence after the feed stopped; saves stay guarded by revisions meanwhile. */
  const restartFeed = () => client.overview(id).then(next => {
    setRestartError(null); setOverview(next); reloadContext(); setFeedFrom({ seq: next.seq });
  }, (cause: unknown) => setRestartError(errorText(cause)));
  /** Activates the file's tab, opening a new tab when the file is not open yet. */
  const show = (target: FileTarget, startEditing = false) => {
    (target.source === 'context' ? context : project).expand(ancestorsOf(target.path));
    const existing = tabs.find(tab => sameTarget(tab, target));
    if (existing) setActiveKey(existing.key);
    else {
      const key = ++keys.current;
      const tab: Tab = { ...target, key, startEditing,
        onDirty: dirty => setDirtyKeys(current => current.has(key) === dirty ? current : new Set(dirty ? [...current, key] : [...current].filter(item => item !== key))),
        onMoved: path => setTabs(current => current.map(item => item.key === key ? { ...item, path } : item)) };
      setTabs(current => [...current, tab]);
      setActiveKey(key);
    }
    if (narrow()) setTreeOpen(false);
  };
  const closeTab = (key: number) => {
    const index = tabs.findIndex(tab => tab.key === key);
    const rest = tabs.filter(tab => tab.key !== key);
    setTabs(rest);
    if (active?.key === key) setActiveKey(rest[Math.min(index, rest.length - 1)]?.key ?? null);
  };
  const requestClose = (key: number) => { if (dirtyKeys.has(key)) setClosing(key); else closeTab(key); };
  const browse = () => { setTreeOpen(true); setFilterFocus(value => value + 1); };
  /** A scope path from a member card: a folder is revealed in the tree, a file opens in a tab. */
  const openScope = (path: string) => {
    setScopeNote(null);
    client.contextTree(id, path).then(() => {
      context.expand([...ancestorsOf(path), path]);
      setTreeOpen(true);
    }, (cause: unknown) => {
      const code = (cause as { code?: string }).code;
      if (code === 'invalid_path') show({ source: 'context', path });
      else setScopeNote(code === 'not_found' ? `${path} does not exist yet.` : errorText(cause));
    });
  };

  const contextActions = (entry: Entry) => entry.path.startsWith('user/') && <>
    {entry.type === 'folder' && <button type="button" className="tree-action" title="New file here" aria-label={`New file in ${entry.path}`} onClick={() => setDialog({ type: 'new', source: 'context', folder: entry.path })}><Glyph name="plus" /></button>}
    <button type="button" className="tree-action" title="Rename or move" aria-label={`Rename ${entry.path}`} onClick={() => setDialog({ type: 'move', path: entry.path, folder: entry.type === 'folder' })}><Glyph name="pencil" /></button>
    <button type="button" className="tree-action danger" title="Delete" aria-label={`Delete ${entry.path}`} onClick={() => setDialog({ type: 'delete', path: entry.path, folder: entry.type === 'folder' })}><Glyph name="trash" /></button>
  </>;
  const projectActions = (entry: Entry) => entry.type === 'folder' && <button type="button" className="tree-action" title="New file here" aria-label={`New file in ${entry.path}`} onClick={() => setDialog({ type: 'new', source: 'project', folder: entry.path })}><Glyph name="plus" /></button>;
  const selected = (source: FileSource) => active?.source === source ? active.path : null;
  const connection = { syncing: 'Connecting…', following: 'Live', disconnected: 'Reconnecting…', error: 'Updates stopped' }[status.connection];

  return <>
    <PanelBar actions={<>
      <button type="button" className="tree-action" aria-pressed={treeOpen} aria-label="File tree" title={treeOpen ? 'Hide file tree' : 'Show file tree'} onClick={() => setTreeOpen(!treeOpen)}><Glyph name="tree" /></button>
      {actions}
    </>}>
      <div className={`workspace-tab pinned ${showTeam ? 'active' : ''}`}>
        <button type="button" aria-current={showTeam ? 'true' : undefined} title="The workspace's team" onClick={() => setActiveKey(null)}>
          <span className="workspace-tab-name">Team</span>
          {team.team?.members.some(member => member.running) && <span className="team-working" aria-label="A member is working" title="A member is working" />}
        </button>
      </div>
      {tabs.map(tab => {
        const name = nameOf(tab.path);
        const current = tab.key === active?.key;
        return <div key={tab.key} className={`workspace-tab ${current ? 'active' : ''}`}>
          <button type="button" aria-current={current ? 'true' : undefined} title={`${tab.source === 'context' ? 'Context base' : 'Project'} · ${tab.path}`}
            onClick={() => setActiveKey(tab.key)} onAuxClick={event => { if (event.button === 1) requestClose(tab.key); }}>
            <span className="workspace-tab-name">{name}</span>
            {dirtyKeys.has(tab.key) && <span className="file-dirty" aria-label="Unsaved changes">●</span>}
          </button>
          <button type="button" className="workspace-tab-close" aria-label={`Close ${name}`} title="Close" onClick={() => requestClose(tab.key)}><Glyph name="close" /></button>
        </div>;
      })}
      <button type="button" className="tree-action" aria-label="Open a file" title="Open a file" onClick={browse}><Glyph name="plus" /></button>
    </PanelBar>
    <div className="workspace-body">
      <div className="workspace-viewer">
        {tabs.map(tab => <div key={tab.key} className="file-tab-panel" hidden={tab.key !== active?.key}>
          <FileView client={client} workspaceId={id} workspaceName={workspace.name} target={tab} feed={feed} startEditing={tab.startEditing}
            onMoved={tab.onMoved} onDirty={tab.onDirty} onOpenLink={target => show(target)}
            onRename={() => setDialog({ type: 'move', path: tab.path, folder: false })} onDelete={() => setDialog({ type: 'delete', path: tab.path, folder: false })} />
        </div>)}
        <div className="file-tab-panel" hidden={!showTeam}>
          <TeamTab team={team} workspace={workspace} note={scopeNote} onOpenScope={openScope} onBrowse={browse} />
        </div>
      </div>
      {treeOpen && <div className="workspace-tree-column">
        <div className="workspace-tree-head"><strong>{workspace.name}</strong><span className="workspace-directory" title={workspace.directory}>{workspace.directory}</span></div>
        <label className="workspace-filter"><span className="sr-only">Filter files</span><input ref={filterInput} type="search" value={filter} maxLength={200} onChange={event => setFilter(event.target.value)} placeholder="Filter files…" /></label>
        <div className="workspace-tree">
          {filter.trim() ? <section aria-label="Matching files">
            {findError && <div className="sidebar-error" role="alert">{findError}</div>}
            {!found && !findError && <p className="tree-note">Searching…</p>}
            {found && ([['context', 'Context base', found.context], ['project', 'Project', found.project]] as const).map(([source, label, result]) => <div key={source}>
              <div className="tree-group-head"><span>{label}</span><small>{result.paths.length}{result.truncated ? '+' : ''}</small></div>
              {!result.paths.length && <p className="tree-note">No matches</p>}
              <ul className="tree-list">{result.paths.map(path => <li key={path}><div className={`tree-row ${selected(source) === path ? 'selected' : ''}`}>
                <button type="button" className="tree-item found-item" title={path} onClick={() => show({ source, path })}><span className="tree-icon file" aria-hidden="true" /><span className="tree-name">{path}</span></button>
              </div></li>)}</ul>
            </div>)}
          </section> : <>
            <section aria-label="Context base">
              <div className="tree-section-head"><span>CONTEXT BASE</span>
                <span className={`feed-status ${status.connection}`} title={restartError ?? status.error ?? undefined}><span className="status-dot" />{connection}</span>
                {status.connection === 'error' && <button type="button" className="text-button" onClick={() => void restartFeed()}>Retry</button>}
              </div>
              <div className="tree-group-head"><span>User context</span><small>{overview.user.files} files</small>
                <button type="button" className="tree-action" title="New file" aria-label="New user context file" onClick={() => setDialog({ type: 'new', source: 'context', folder: 'user' })}><Glyph name="plus" /></button></div>
              <FolderTree tree={context} path="user" selected={selected('context')} empty="No files yet. Add notes the agent should know about you and this project." onOpen={path => show({ source: 'context', path })} actions={contextActions} />
              <div className="tree-group-head"><span>Agent context</span><small>read-only</small></div>
              <FolderTree tree={context} path="agent" selected={selected('context')} empty="Nothing yet. The agent writes its working notes here." onOpen={path => show({ source: 'context', path })} />
              {overview.problems.length > 0 && <details className="tree-problems"><summary>{overview.problems.length} {overview.problems.length === 1 ? 'file needs' : 'files need'} attention</summary>
                <ul>{overview.problems.map(problem => <li key={problem.path}><strong>{problem.path}</strong>{problem.message}</li>)}</ul></details>}
            </section>
            <section aria-label="Project files">
              <div className="tree-section-head"><span>PROJECT</span>
                <button type="button" className="tree-action" title="Refresh" aria-label="Refresh project files" onClick={project.reload}><Glyph name="refresh" /></button>
                <button type="button" className="tree-action" title="New file" aria-label="New project file" onClick={() => setDialog({ type: 'new', source: 'project', folder: '' })}><Glyph name="plus" /></button>
              </div>
              <FolderTree tree={project} path="" selected={selected('project')} empty="This folder is empty." onOpen={path => show({ source: 'project', path })} actions={projectActions} />
            </section>
          </>}
        </div>
      </div>}
    </div>
    {dialog?.type === 'new' && <PathDialog eyebrow={dialog.source === 'context' ? 'CONTEXT BASE' : 'PROJECT'} title="New file" label="Path"
      initial={`${dialog.folder ? `${dialog.folder}/` : ''}untitled.md`} action="Create file"
      hint={dialog.source === 'context' ? 'User context lives under user/. Names use letters, numbers, spaces, dots, dashes, and underscores.' : 'Relative to the workspace folder. Missing folders are created.'}
      onClose={() => setDialog(null)} onSubmit={async path => {
        const source = dialog.source;
        const created = source === 'context' ? await client.saveContext(id, path, '', null) : await client.saveProject(id, path, '', null);
        if (source === 'project') project.reload();
        setDialog(null);
        show({ source, path: created.path }, true);
      }} />}
    {dialog?.type === 'move' && <PathDialog eyebrow="CONTEXT BASE" title={dialog.folder ? 'Move folder' : 'Rename file'} label="New path" initial={dialog.path} action={dialog.folder ? 'Move folder' : 'Rename'}
      hint={dialog.folder ? 'Every file inside the folder moves with it. The new path must not exist yet.' : 'Change the name or the folder. The new path must not exist yet.'}
      onClose={() => setDialog(null)} onSubmit={async to => {
        const result = await client.moveContext(id, dialog.path, to);
        context.expand(dialog.folder ? [...ancestorsOf(to), to] : ancestorsOf(to));
        // The change feed moves open tabs too, but only while it is connected.
        setTabs(current => current.map(tab => {
          const match = tab.source === 'context' ? result.moved.find(item => sameTarget(tab, { source: 'context', path: item.from })) : undefined;
          return match ? { ...tab, path: match.to } : tab;
        }));
        setDialog(null);
      }} />}
    {dialog?.type === 'delete' && <ConfirmDialog eyebrow="CONTEXT BASE" title={dialog.folder ? 'Delete folder?' : 'Delete file?'} action="Delete"
      message={<><strong>{dialog.path}</strong>{dialog.folder ? ' and every file inside it will be deleted.' : ' will be deleted.'}</>}
      onClose={() => setDialog(null)} onConfirm={async () => {
        const result = await client.deleteContext(id, dialog.path);
        setDialog(null);
        // Clean tabs of deleted files close; a tab with unsaved changes stays open and offers to save the file again.
        setTabs(current => current.filter(tab => dirtyKeys.has(tab.key) || !result.deleted.some(path => sameTarget(tab, { source: 'context', path }))));
      }} />}
    {closingTab && <ConfirmDialog eyebrow="UNSAVED CHANGES" title="Discard your changes?" action="Discard and close"
      message={<><strong>{nameOf(closingTab.path)}</strong> has changes that are not saved. Closing it discards them.</>}
      onClose={() => setClosing(null)} onConfirm={() => { setClosing(null); closeTab(closingTab.key); }} />}
  </>;
}
