import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { GroupClient, type GroupEntry } from '../client/group-client.js';
import { AgentClient } from '../client/agent-client.js';
import { discussionInput, referenceLabel, type Discussion } from '../client/discussion-reference.js';
import type { TeamState } from './useTeam.js';
import { Glyph } from './Glyph.js';
import { Markdown } from './Markdown.js';
import { memberColor, mentionAt, mentionToken, workDuration, workingItems } from './group-work.js';

export function GroupChat({ workspaceId, title, team, filesOpen, onFiles, onRunning, discussion }: {
  workspaceId: string; title: string; team: TeamState; filesOpen: boolean; onFiles(open: boolean): void;
  onRunning(running: boolean): void; discussion: Discussion;
}) {
  const client = useMemo(() => new GroupClient(workspaceId), [workspaceId]);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [draft, setDraft] = useState('');
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const runningIds = snapshot.entries.flatMap(entry => entry.kind === 'member' && entry.run.status === 'running' ? [entry.memberId] : []);
  const active = runningIds.length > 0;
  useEffect(() => { client.follow(); return () => client.dispose(); }, [client]);
  useEffect(() => { onRunning(active); }, [active, onRunning]);
  const refreshTeam = team.refresh;
  useEffect(() => { if (snapshot.synchronized) void refreshTeam(); }, [snapshot.cursor, snapshot.synchronized, refreshTeam]);
  useEffect(() => { if (pinned.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; }, [snapshot.entries]);
  const mention = dismissed ? null : mentionAt(draft, caret);
  const suggestions = mention ? (team.team?.members ?? []).filter(member => member.name.toLowerCase().includes(mention.query.toLowerCase())) : [];
  const status = snapshot.connection === 'following' ? active ? `${runningIds.length} working` : 'Ready' : snapshot.connection === 'syncing' ? 'Syncing' : snapshot.connection === 'disconnected' ? 'Reconnecting' : 'Updates stopped';
  async function send() {
    if (!draft.trim() || snapshot.sending || !snapshot.synchronized) return;
    const sent = draft; const ref = discussion.reference;
    try {
      await client.send(discussionInput(sent, ref));
      setDraft(current => current === sent ? '' : current);
      if (ref) discussion.sent(ref);
      pinned.current = true; setDismissed(true);
    } catch { /* Draft/reference and the inline backend reason remain. */ }
  }
  return <div className="conversation group-conversation">
    <div className="conversation-head"><div><div className="eyebrow">WORKSPACE GROUP</div><h2>{title}</h2></div>
      <div className="conversation-actions"><span className={`status-pill ${active ? 'status-active' : ''}`}>{status}</span>
        <button type="button" className="icon-button" aria-label="Refresh group chat" onClick={client.refresh}>↻</button>
        {!filesOpen && <button type="button" className="icon-button" aria-label="Show design, team and files" onClick={() => onFiles(true)}><Glyph name="panel" /></button>}
      </div>
    </div>
    {snapshot.error && <div className="error-banner" role="alert">{snapshot.error}<button type="button" onClick={client.refresh}>Retry</button></div>}
    <div className="group-viewport" ref={viewport} onScroll={() => { const view = viewport.current!; pinned.current = view.scrollHeight - view.scrollTop - view.clientHeight < 80; }}>
      {!snapshot.entries.length && <div className="empty-state"><div className="empty-mark">✳</div><h3>Work with your team</h3><p>Talk to the lead, or mention members with @ to bring them into the work.</p><button type="button" className="text-button" onClick={() => onFiles(true)}>Open design and team</button></div>}
      <div className="group-timeline">{snapshot.entries.map(entry => entry.kind === 'user'
        ? <article key={entry.entryId} data-entry-id={entry.entryId} className="group-user"><div className="group-user-body"><p>{entry.text}</p></div><div className="group-identity group-user-identity"><span className="group-avatar" aria-hidden="true">Y</span><strong className="group-identity-name">You</strong></div></article>
        : <MemberResponse key={entry.entryId} entry={entry} />)}</div>
    </div>
    <div className="group-composer-footer"><form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}>
      {discussion.reference && <div className="composer-reference"><span>{referenceLabel(discussion.reference)}</span><button type="button" aria-label="Remove discussion reference" onClick={discussion.clear}>×</button></div>}
      {snapshot.commandError && <div className="group-command-error" role="alert">{snapshot.commandError}</div>}
      <textarea ref={input} className="composer-input" aria-label="Message the team" placeholder="Message the team… @ to mention a member" value={draft}
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
          const unavailable = !member.ready || busy;
          return <button type="button" key={member.memberId} disabled={unavailable} onClick={() => {
            const token = mentionToken(member.name) + ' ';
            setDraft(draft.slice(0, mention.start) + token + draft.slice(caret)); setDismissed(true);
            const next = mention.start + token.length;
            requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(next, next); });
          }}><strong>{member.name}</strong><span>{busy ? 'Working' : member.ready ? 'Available' : 'Cannot run'}</span></button>;
        })}
        {!suggestions.length && <p>No matching members</p>}
      </div>}
      <div className="composer-actions"><span className="group-composer-hint">No mention → Lead · Shift+Enter for a new line</span>
        {active && <button type="button" className="cancel-button" disabled={snapshot.stopping} onClick={() => void client.stop()}>{snapshot.stopping ? 'Stopping…' : 'Stop team'}</button>}
        <button type="submit" className="send-button" disabled={!draft.trim() || snapshot.sending || !snapshot.synchronized}>{snapshot.sending ? 'Sending…' : 'Send ↗'}</button>
      </div>
    </form></div>
  </div>;
}

function MemberResponse({ entry }: { entry: Extract<GroupEntry, { kind: 'member' }> }) {
  const [expanded, setExpanded] = useState(false);
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
    <div className="group-identity group-member-identity"><span className="group-avatar" aria-hidden="true">{entry.name.slice(0, 1).toUpperCase()}</span><strong className="group-identity-name">{entry.name}</strong></div>
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
        {expanded && <WorkingHistory entry={entry} />}
        {entry.text !== null && <div className="group-final"><Markdown source={entry.text} onLink={href => { window.open(href, '_blank', 'noopener,noreferrer'); }} /></div>}
        {!running && !entry.finalRef && <div className="group-terminal" role="status"><p>{entry.run.error?.message ?? (entry.run.status === 'completed' ? 'Finished without a published response.' : 'No final response was published.')}</p></div>}
      </div>
    </div>
  </article>;
}
function WorkingHistory({ entry }: { entry: Extract<GroupEntry, { kind: 'member' }> }) {
  const client = useMemo(() => new AgentClient(entry.memberId, { historyAfter: entry.working.after }), [entry.memberId, entry.run.runId, entry.working.after]);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  useEffect(() => { client.follow(entry.run.runId); return () => client.dispose(); }, [client, entry.run.runId]);
  const items = workingItems(snapshot, entry);
  return <div className="group-work" id={`group-work-${entry.entryId}`} aria-label={`${entry.name} working history`}>
    {snapshot.error && <div className="group-work-error" role="alert">{snapshot.error}<button type="button" onClick={() => client.follow(entry.run.runId)}>Retry work history</button></div>}
    {!items.length && <p>{snapshot.synchronized ? 'No intermediate work recorded.' : 'Loading work…'}</p>}
    {items.map(item => item.kind === 'tool'
      ? <details key={item.id} className={`work-tool ${item.failed ? 'failed' : ''}`}><summary>⌘ {item.text}<span>{item.result === undefined ? entry.run.status === 'running' ? 'Running' : 'No result recorded' : item.failed ? 'Failed' : 'Complete'}</span></summary><pre>{item.args}</pre>{item.result !== undefined && <pre>{item.result}</pre>}</details>
      : item.kind === 'reasoning' ? <details key={item.id} className="work-reasoning"><summary>Reasoning</summary><p>{item.text}</p></details>
        : <p key={item.id} className="work-text">{item.text}</p>)}
  </div>;
}
