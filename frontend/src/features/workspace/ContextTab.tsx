import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContextClient, ContextEntry, GroupContextEntry, Member } from '../../shared/backend-client/index.js';
import { BackendError } from '../../shared/backend-client/index.js';
import { SequenceInspector } from '../../shared/ui/index.js';
import { ContextMessageDetail, contextMessageLabel, contextMessageRole } from './context-message.js';

const PAGE_SIZE = 100;
type Source = { kind: 'group' } | { kind: 'member'; memberId: string };
type Entry = ContextEntry | GroupContextEntry;
type State = { entries: Entry[]; revision: number | null; nextOffset: number | null; loading: boolean; error: string | null; stale: boolean };
const initial: State = { entries: [], revision: null, nextOffset: 0, loading: false, error: null, stale: false };

/** Read-only browser inspector for original group context and member Agent context. */
export function ContextTab({ workspaceId, members, client }: { workspaceId: string; members: readonly Member[]; client: ContextClient }) {
  const [source, setSource] = useState<Source>({ kind: 'group' });
  const [state, setState] = useState<State>(initial);
  const [selectedKey, setSelectedKey] = useState<string>();
  const generation = useRef(0);
  const sourceKey = source.kind === 'group' ? 'group' : `member:${source.memberId}`;
  const sourceLabel = source.kind === 'group' ? 'Group chat' : members.find(member => member.memberId === source.memberId)?.name ?? 'Member';

  const load = useCallback(async (reset: boolean, sourceValue = source, currentState = state) => {
    const current = ++generation.current;
    const offset = reset ? 0 : currentState.nextOffset;
    if (offset === null) return;
    setState(old => ({ ...old, loading: true, error: null, ...(reset ? { entries: [], revision: null, nextOffset: 0, stale: false } : {}) }));
    try {
      const options = { offset, limit: PAGE_SIZE, ...(!reset && currentState.revision !== null ? { revision: currentState.revision } : {}) };
      const page = sourceValue.kind === 'group'
        ? await client.group(workspaceId, options)
        : await client.member(workspaceId, sourceValue.memberId, options);
      if (current !== generation.current) return;
      setState(old => ({ entries: reset ? page.entries : [...old.entries, ...page.entries], revision: page.revision, nextOffset: page.nextOffset, loading: false, error: null, stale: false }));
    } catch (cause) {
      if (current !== generation.current) return;
      if (cause instanceof BackendError && cause.code === 'context_changed') {
        setState(old => ({ ...old, loading: false, stale: true, error: 'Context changed while paging. Refresh to load one consistent revision.' }));
      } else setState(old => ({ ...old, loading: false, error: cause instanceof Error ? cause.message : 'Context could not be loaded' }));
    }
  }, [client, source, state, workspaceId]);

  useEffect(() => {
    generation.current++;
    setState({ ...initial, loading: true }); setSelectedKey(undefined);
    void load(true, source, initial);
    return () => { generation.current++; };
  }, [sourceKey, workspaceId, client]);

  const refresh = () => { setSelectedKey(undefined); void load(true, source, initial); };
  const key = (entry: Entry, index: number) => `${entry.messageId}:${index}`;

  return <section className="context-tab" aria-label="Workspace conversation context">
    <aside className="context-source-list" aria-label="Context sources">
      <div className="context-source-heading"><div><span className="eyebrow">CONTEXT</span><h2>Message history</h2></div><button type="button" className="secondary-button" onClick={refresh} disabled={state.loading}>Refresh</button></div>
      <button type="button" className={`context-source${source.kind === 'group' ? ' selected' : ''}`} aria-pressed={source.kind === 'group'} onClick={() => setSource({ kind: 'group' })}>Group chat<span>Shared messages</span></button>
      <h3>Members</h3>
      {!members.length && <p className="context-source-note">No workspace members found.</p>}
      {members.map(member => <button key={member.memberId} type="button" className={`context-source${source.kind === 'member' && source.memberId === member.memberId ? ' selected' : ''}`} aria-pressed={source.kind === 'member' && source.memberId === member.memberId} onClick={() => setSource({ kind: 'member', memberId: member.memberId })}>{member.name}<span>{member.role}{member.running ? ' · working' : ''}</span></button>)}
    </aside>
    <div className="context-content">
      <header className="context-content-head"><div><span className="eyebrow">{sourceLabel}</span><h2>{state.entries.length} message{state.entries.length === 1 ? '' : 's'}</h2></div>{state.revision !== null && <span className="context-revision">Revision {state.revision}</span>}</header>
      {state.error && <div className="context-error" role="alert">{state.error}{state.stale && <button type="button" className="text-button" onClick={refresh}>Reload from start</button>}</div>}
      {state.loading && !state.entries.length ? <p className="context-loading" role="status">Loading {sourceLabel.toLowerCase()}…</p> : state.entries.length ? <>
        <SequenceInspector items={state.entries} getKey={key} selectedKey={selectedKey} onSelect={(entry, index) => setSelectedKey(key(entry, index))}
          renderRow={(entry, index) => <><strong>{String(index + 1).padStart(3, '0')} · {contextMessageRole(entry.message)}</strong><span>{contextMessageLabel(entry.message)}</span></>}
          renderDetail={(entry, index) => <ContextMessageDetail entry={entry} index={index} />} empty={<p>Select a context message.</p>} />
        {state.nextOffset !== null && <button className="load-more-button" type="button" disabled={state.loading} onClick={() => void load(false)}>{state.loading ? 'Loading…' : 'Load more'}</button>}
        {state.loading && state.entries.length > 0 && <p className="context-loading" role="status">Loading more messages…</p>}
      </> : !state.error ? <p className="context-loading">No context messages are available.</p> : null}
    </div>
  </section>;
}
