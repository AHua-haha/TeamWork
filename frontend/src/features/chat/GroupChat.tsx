import { backendClient } from '../../shared/backend-client/index.js';
import { useImageDraft } from './useImageDraft.js';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { imageUrl, type ChatImage, type GroupEntry, type GroupClient } from '../../shared/backend-client/index.js';
import type { AgentClient } from '../../shared/backend-client/index.js';
import { discussionInput, referenceLabel, type Discussion } from '../../shared/backend-client/index.js';
import type { ClientSnapshot } from '../../shared/backend-client/index.js';
import type { ChatTeamState } from '../workspace/chat-roster.js';
import { ConfirmDialog } from '../workspace/WorkspaceDialogs.js';
import { MemberModelPopover } from './MemberModelPopover.js';
import { Glyph } from '../workspace/Glyph.js';
import { Markdown } from './Markdown.js';
import { memberColor, mentionAt, mentionToken, workDuration, runActivity, isRunThinking, workToolSummary, toolSetSummary, type ActivityItem, type ToolActivity } from './group-work.js';

export function GroupChat({ workspaceId, title, team, filesOpen, onFiles, onRunning, discussion, panelLabel = 'Workspace tools' }: {
  workspaceId: string; title: string; team: ChatTeamState; filesOpen: boolean; onFiles(open: boolean): void;
  panelLabel?: string; onRunning(running: boolean): void; discussion: Discussion;
}) {
  const client = useMemo(() => backendClient.group(workspaceId), [workspaceId]);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [modelTarget, setModelTarget] = useState<{ memberId: string; anchor: HTMLButtonElement } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keepModelOpen = useCallback(() => { clearTimeout(hoverTimer.current); clearTimeout(leaveTimer.current); }, []);
  const closeModel = useCallback(() => { keepModelOpen(); setModelTarget(null); }, [keepModelOpen]);
  const openModel = useCallback((memberId: string, anchor: HTMLButtonElement, immediate = false) => {
    keepModelOpen();
    const open = () => setModelTarget({ memberId, anchor });
    if (immediate) open(); else hoverTimer.current = setTimeout(open, 350);
  }, [keepModelOpen]);
  const leaveModel = useCallback(() => {
    clearTimeout(hoverTimer.current); clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      if (!document.activeElement?.closest('.member-model-popover')) setModelTarget(null);
    }, 250);
  }, []);
  useEffect(() => { closeModel(); return keepModelOpen; }, [workspaceId, closeModel, keepModelOpen]);
  const modelMember = team.team?.members.find(member => member.memberId === modelTarget?.memberId);
  const [resetOpen, setResetOpen] = useState(false);
  useEffect(() => { closeModel(); }, [snapshot.resetCursor, closeModel]);
  const [draft, setDraft] = useState('');
  const pictures = useImageDraft();
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const timeline = useRef<HTMLDivElement>(null);
  const runningIds = snapshot.entries.flatMap(entry => entry.kind === 'member' && entry.run.status === 'running' ? [entry.memberId] : []);
  const active = runningIds.length > 0;
  useEffect(() => { client.follow(); return () => client.dispose(); }, [client]);
  useEffect(() => { onRunning(active); }, [active, onRunning]);
  const refreshTeam = team.refresh;
  useEffect(() => { if (snapshot.synchronized) void refreshTeam(); }, [snapshot.cursor, snapshot.synchronized, refreshTeam]);
  useEffect(() => { if (pinned.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; }, [snapshot.entries]);
  useEffect(() => {
    const content = timeline.current, view = viewport.current;
    if (!content || !view) return;
    const observer = new ResizeObserver(() => { if (pinned.current) view.scrollTop = view.scrollHeight; });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  const mention = dismissed ? null : mentionAt(draft, caret);
  const suggestions = mention ? (team.team?.members ?? []).filter(member => member.name.toLowerCase().includes(mention.query.toLowerCase())) : [];
  const status = snapshot.connection === 'following' ? active ? `${runningIds.length} working` : 'Ready' : snapshot.connection === 'syncing' ? 'Syncing' : snapshot.connection === 'disconnected' ? 'Reconnecting' : 'Updates stopped';
  async function send() {
    if ((!draft.trim() && !pictures.images.length) || snapshot.sending || snapshot.resetting || !snapshot.synchronized) return;
    const sent = draft; const ref = discussion.reference; const sentImages = pictures.images;
    try {
      await client.send(discussionInput(sent, ref), sentImages.map(image => image.file));
      pictures.remove(sentImages.map(image => image.id));
      setDraft(current => current === sent ? '' : current);
      if (ref) discussion.sent(ref);
      pinned.current = true; setDismissed(true);
    } catch { /* Draft/reference and the inline backend reason remain. */ }
  }
  return <div className="conversation group-conversation">
    <div className="conversation-head"><div><div className="eyebrow">WORKSPACE GROUP</div><h2>{title}</h2></div>
      <div className="conversation-actions"><span className={`status-pill ${active ? 'status-active' : ''}`}>{status}</span>
        <button type="button" className="icon-button" aria-label="Reset group chat and member context" title={active ? 'Stop team work before resetting' : 'Reset chat and member context'}
          disabled={active || snapshot.sending || snapshot.stopping || snapshot.resetting || !snapshot.synchronized} onClick={() => { closeModel(); setResetOpen(true); }}><Glyph name="trash" /></button>
        <button type="button" className="icon-button" aria-label="Refresh group chat" onClick={client.refresh}>↻</button>
        {!filesOpen && <button type="button" className="icon-button" aria-label={`Show ${panelLabel.toLowerCase()}`} onClick={() => onFiles(true)}><Glyph name="panel" /></button>}
      </div>
    </div>
    {resetOpen && <ConfirmDialog eyebrow="WORKSPACE GROUP" title="Reset chat and member context?" action="Reset chat"
      message="Permanently clear this group chat and every member’s private conversation context and message history. Project files, designs, member settings will be kept. Stop team work before resetting."
      onClose={() => setResetOpen(false)} onConfirm={async () => { await client.reset(); setResetOpen(false); pinned.current = true; }} />}
    {snapshot.error && <div className="error-banner" role="alert">{snapshot.error}<button type="button" onClick={client.refresh}>Retry</button></div>}
    <div className="group-viewport" ref={viewport} onScroll={() => { const view = viewport.current!; pinned.current = view.scrollHeight - view.scrollTop - view.clientHeight < 80; }}>
      {!snapshot.entries.length && <div className="empty-state"><div className="empty-mark">✳</div><h3>Work with your team</h3><p>Talk to the lead, or mention members with @ to bring them into the work.</p><button type="button" className="text-button" onClick={() => onFiles(true)}>Open {panelLabel.toLowerCase()}</button></div>}
      <div className="group-timeline" ref={timeline}>{snapshot.entries.map(entry => entry.kind === 'user'
        ? <article key={entry.entryId} data-entry-id={entry.entryId} className="group-user"><div className="group-user-body">{entry.text && <p>{entry.text}</p>}{entry.attachments?.length ? <div className="group-message-images">{entry.attachments.map(image => <MessageImage key={image.id} workspaceId={workspaceId} image={image} />)}</div> : null}</div><div className="group-identity group-user-identity"><span className="group-avatar" aria-hidden="true">Y</span><strong className="group-identity-name">You</strong></div></article>
        : <MemberResponse key={entry.entryId} entry={entry} canConfigure={!!team.team?.members.some(member => member.memberId === entry.memberId)} modelOpen={modelTarget?.memberId === entry.memberId}
          onModel={openModel} onModelLeave={leaveModel} />)}</div>
    </div>
    {modelTarget && modelMember && <MemberModelPopover key={modelTarget.memberId} workspaceId={workspaceId} member={modelMember} anchor={modelTarget.anchor}
      onClose={closeModel} onEnter={keepModelOpen} onLeave={leaveModel} onSaved={refreshTeam} />}
    <div className="group-composer-footer"><form className={`composer ${dragging ? 'composer-dragging' : ''}`}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); if (!snapshot.sending) setDragging(true); } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); setDragging(false); if (!snapshot.sending && !snapshot.resetting) pictures.add([...event.dataTransfer.files]); }}
      onSubmit={event => { event.preventDefault(); void send(); }}>
      {discussion.reference && <div className="composer-reference"><span>{referenceLabel(discussion.reference)}</span><button type="button" aria-label="Remove discussion reference" onClick={discussion.clear}>×</button></div>}
      <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden aria-label="Choose pictures" onChange={event => { if (!snapshot.sending && !snapshot.resetting) pictures.add([...(event.target.files ?? [])]); event.target.value = ''; }} />
      {pictures.error && <div className="group-command-error" role="alert">{pictures.error}</div>}
      {pictures.images.length > 0 && <div className="composer-images">{pictures.images.map(image => <div className="composer-image" key={image.id}>
        <img src={image.url} alt={image.file.name} /><span title={image.file.name}>{image.file.name}</span>
        <button type="button" disabled={snapshot.sending || snapshot.resetting} aria-label={`Remove ${image.file.name}`} onClick={() => pictures.remove([image.id])}>×</button>
      </div>)}</div>}
      {snapshot.commandError && <div className="group-command-error" role="alert">{snapshot.commandError}</div>}
      <textarea ref={input} className="composer-input" aria-label="Message the team" placeholder="Message the team… @ to mention a member" value={draft}
        onPaste={event => {
          const files = [...event.clipboardData.items].filter(item => item.kind === 'file').flatMap(item => { const file = item.getAsFile(); return file ? [file] : []; });
          if (files.length) { event.preventDefault(); if (!snapshot.sending && !snapshot.resetting) pictures.add(files); }
        }}
        onChange={event => { setDraft(event.target.value); setCaret(event.target.selectionStart); setDismissed(false); }}
        onSelect={event => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') setDismissed(true);
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); }
        }} />
      {mention && <div className="mention-suggestions" aria-label="Mention a member">
        {suggestions.map(member => {
          const busy = runningIds.includes(member.memberId) || member.running;
          const readiness = 'ready' in member ? member.ready : undefined;
          const unavailable = readiness === false || busy;
          return <button type="button" key={member.memberId} disabled={unavailable} onClick={() => {
            const token = mentionToken(member.name) + ' ';
            setDraft(draft.slice(0, mention.start) + token + draft.slice(caret)); setDismissed(true);
            const next = mention.start + token.length;
            requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(next, next); });
          }}><strong>{member.name}</strong><span>{busy ? 'Working' : readiness === false ? 'Cannot run' : readiness === true ? 'Available' : 'Select'}</span></button>;
        })}
        {!suggestions.length && <p>No matching members</p>}
      </div>}
      <div className="composer-actions"><button type="button" className="icon-button" aria-label="Attach pictures" title="Attach PNG, JPEG or WebP pictures" disabled={snapshot.sending || snapshot.resetting || pictures.images.length >= 4} onClick={() => picker.current?.click()}><Glyph name="plus" /></button><span className="group-composer-hint">No mention → Lead · Shift+Enter for a new line</span>
        {active && <button type="button" className="cancel-button" disabled={snapshot.stopping} onClick={() => void client.stop()}>{snapshot.stopping ? 'Stopping…' : 'Stop team'}</button>}
        <button type="submit" className="send-button" disabled={(!draft.trim() && !pictures.images.length) || snapshot.sending || snapshot.resetting || !snapshot.synchronized}>{snapshot.sending ? 'Sending…' : 'Send ↗'}</button>
      </div>
    </form></div>
  </div>;
}

function MemberResponse({ entry, canConfigure, modelOpen, onModel, onModelLeave }: {
  entry: Extract<GroupEntry, { kind: 'member' }>; canConfigure: boolean; modelOpen: boolean;
  onModel(memberId: string, anchor: HTMLButtonElement, immediate?: boolean): void; onModelLeave(): void;
}) {
  const [expanded, setExpanded] = useState(entry.finalRef === null);
  const accepted = entry.finalRef !== null;
  const seenFinal = useRef(accepted);
  const client = useMemo(() => backendClient.agent(entry.memberId, { historyAfter: entry.working.after }), [entry.memberId, entry.run.runId, entry.working.after]);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const observe = entry.run.status === 'running' || expanded;
  useEffect(() => { if (observe) client.follow(entry.run.runId); }, [client, observe, entry.run.runId]);
  useEffect(() => () => client.dispose(), [client]);
  useEffect(() => {
    if (accepted && !seenFinal.current) setExpanded(false);
    seenFinal.current = accepted;
  }, [accepted]);
  const [now, setNow] = useState(Date.now());
  const running = entry.run.status === 'running';
  useEffect(() => { if (!running) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [running]);
  const duration = workDuration(entry.run.startedAt, entry.run.endedAt ?? now);
  const status = running ? 'Working' : entry.run.status[0]!.toUpperCase() + entry.run.status.slice(1);
  const started = useMemo(() => {
    const date = new Date(entry.run.startedAt);
    return { iso: date.toISOString(), time: date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }), full: date.toLocaleString() };
  }, [entry.run.startedAt]);
  return <article className="group-member" data-entry-id={entry.entryId} style={{ '--member-color': memberColor(entry.memberId) } as CSSProperties}>
    <div className="group-identity group-member-identity"><button type="button" className="group-avatar group-avatar-config" disabled={!canConfigure}
      aria-label={`Configure ${entry.name} model`} aria-haspopup="dialog" aria-expanded={modelOpen}
      onMouseEnter={event => onModel(entry.memberId, event.currentTarget)} onMouseLeave={onModelLeave}
      onFocus={event => onModel(entry.memberId, event.currentTarget, true)} onBlur={onModelLeave}
      onClick={event => onModel(entry.memberId, event.currentTarget, true)}>{entry.name.slice(0, 1).toUpperCase()}</button><strong className="group-identity-name">{entry.name}</strong></div>
    <div className="group-run-area">
      <div className="group-run-pill group-run-info" data-status={entry.run.status}>
        <span className="run-header-status">{status}</span>
        <span className="run-header-duration">{duration}</span>
        <time className="run-header-start" dateTime={started.iso} title={`Started ${started.full}`} aria-label={`Started ${started.full}`}>{started.time}</time>
      </div>
      <button type="button" className="group-run-pill group-work-toggle" aria-expanded={expanded} aria-controls={`group-work-${entry.entryId}`}
        aria-label={`${entry.name}: ${expanded ? 'Hide' : 'Show'} working history`} onClick={() => setExpanded(value => !value)}>
        <span>Work</span>
        <span className="run-header-chevron"><Glyph name="chevron" /></span>
      </button>
    </div>
    <div className="group-run-card">
      <div className="group-member-body">
        <ResponseContent entry={entry} expanded={expanded} snapshot={snapshot} retry={() => client.follow(entry.run.runId)} />
      </div>
    </div>
  </article>;
}
function ResponseContent({ entry, expanded = false, snapshot, retry }: {
  entry: Extract<GroupEntry, { kind: 'member' }>; expanded?: boolean; snapshot?: ClientSnapshot; retry?(): void;
}) {
  const items = snapshot ? runActivity(snapshot, entry) : [];
  const thinking = snapshot ? isRunThinking(snapshot, entry) : false;
  const error = snapshot?.error && <div className="group-work-error" role="alert">{snapshot.error}<button type="button" onClick={retry}>Retry member output</button></div>;
  return <>
    {(items.length > 0 || thinking || (expanded && error)) && <div hidden={!expanded} className="group-work" id={`group-work-${entry.entryId}`} aria-label={`${entry.name} working history`}>
      {error}
      {items.map(item => item.kind === 'tools' ? <ToolSet key={item.id} item={item} running={entry.run.status === 'running'} />
        : <div key={item.id} className="work-text"><Markdown source={item.text} onLink={href => window.open(href, '_blank', 'noopener,noreferrer')} /></div>)}
      {thinking && <div className="work-thinking" role="status" aria-live="polite" aria-atomic="true" aria-label={`${entry.name} is thinking`}>
        <span>Thinking<span className="sr-only">…</span></span>
        <span className="work-thinking-dots" aria-hidden="true"><i /><i /><i /></span>
      </div>}
    </div>}
    {!expanded && error}
    {entry.text !== null && <div className="group-final">
      <Markdown source={entry.text!} onLink={href => { window.open(href, '_blank', 'noopener,noreferrer'); }} />
    </div>}
    {entry.run.status !== 'running' && !entry.finalRef && <div className="group-terminal" role="status"><p>{entry.run.error?.message ?? (entry.run.status === 'completed' ? 'Finished without a published response.' : 'No final response was published.')}</p></div>}
  </>;
}
function WorkTool({ item, running }: { item: ToolActivity; running: boolean }) {
  const summary = workToolSummary(item);
  const status = item.failed ? 'Failed' : item.result === undefined ? running ? 'Running' : 'No result recorded' : '';
  return <details className={`work-tool ${item.failed ? 'failed' : ''}`}><summary>
    <span className="work-icon"><Glyph name={summary.icon} /></span><span className="work-line-label" title={summary.label}>{summary.label}</span>
    {status && <span className="work-line-status">{status}</span>}<span className="work-disclosure"><Glyph name="chevron" /></span>
  </summary>{item.args !== undefined && <pre aria-label="Arguments">{item.args}</pre>}{item.result !== undefined && <pre aria-label="Result">{item.result}</pre>}</details>;
}

function ToolSet({ item, running }: { item: Extract<ActivityItem, { kind: 'tools' }>; running: boolean }) {
  const failed = item.tools.filter(tool => tool.failed).length;
  const pending = item.tools.filter(tool => tool.result === undefined).length;
  const status = failed ? `${failed} failed` : pending ? running ? `${pending} running` : `${pending} without result` : '';
  const label = toolSetSummary(item.tools);
  return <details className="work-tool-set"><summary aria-label={`Tool group: ${label}`}>
    <span className="work-icon"><Glyph name={workToolSummary(item.tools[0]!).icon} /></span>
    <span className="work-line-label">{label}</span>
    {status && <span className="work-line-status">{status}</span>}
    <span className="work-disclosure"><Glyph name="chevron" /></span>
  </summary><div className="work-tool-list">{item.tools.map(tool => <WorkTool key={tool.id} item={tool} running={running} />)}</div></details>;
}

function MessageImage({ workspaceId, image }: { workspaceId: string; image: ChatImage }) {
  const [failed, setFailed] = useState(false);
  const url = imageUrl(workspaceId, image.id);
  return failed ? <span className="image-load-error" role="status">Picture unavailable: {image.name}</span>
    : <a href={url} target="_blank" rel="noreferrer" aria-label={`Open ${image.name}`}><img src={url} alt={image.name} width={image.width} height={image.height} loading="lazy" onError={() => setFailed(true)} /></a>;
}
