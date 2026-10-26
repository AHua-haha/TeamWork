import { useEffect, useState } from 'react';
import type { ContextClient, GroupSemanticIndex, GroupSemanticNode } from '../../shared/backend-client/context-client.js';

type Member = { memberId: string; name: string };

function RangeBranch({ node, selectedId, onSelect }: { node: GroupSemanticNode; selectedId?: string; onSelect: (id: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  return <li>
    <div className="semantic-range-row">
      {node.children.length ? <button className="semantic-range-toggle" type="button" aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.topic}`} onClick={() => setExpanded(value => !value)}>
        <svg viewBox="0 0 16 16" aria-hidden="true" className={expanded ? 'is-expanded' : ''}><path d="m6 3 5 5-5 5" /></svg>
      </button> : <span className="semantic-range-toggle" />}
      <button type="button" className={`semantic-range-node${selectedId === node.id ? ' is-selected' : ''}`}
        aria-pressed={selectedId === node.id} onClick={() => onSelect(node.id)}>
        <strong>{node.topic}</strong><span>Messages {node.firstPosition}–{node.lastPosition}</span>
      </button>
    </div>
    {expanded && node.children.length > 0 && <ul>{node.children.map(child => <RangeBranch key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} />)}</ul>}
  </li>;
}

function findNode(nodes: readonly GroupSemanticNode[], id?: string): GroupSemanticNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
}

export function SemanticRangeInspector({ index, members }: { index: GroupSemanticIndex; members: readonly Member[] }) {
  const [selectedId, setSelectedId] = useState<string>();
  const selected = findNode(index.tree, selectedId) ?? index.tree[0];
  return <>
    <header className="context-content-head"><div><span className="eyebrow">GROUP CHAT</span><h2>Semantic ranges</h2></div><span className="context-revision">Revision {index.revision}</span></header>
    <p className="semantic-index-coverage">Analyzed group messages {index.from}–{index.through}</p>
    <section className="sequence-inspector semantic-range-inspector" aria-label="Semantic range inspector">
      <nav className="sequence-inspector-list semantic-range-tree" aria-label="Semantic range hierarchy"><ul>
        {index.tree.map(node => <RangeBranch key={node.id} node={node} selectedId={selected?.id} onSelect={setSelectedId} />)}
      </ul></nav>
      <div className="sequence-inspector-detail" aria-live="polite">
        {selected ? <article className="context-message-detail">
          <span className="eyebrow">MESSAGES {selected.firstPosition}–{selected.lastPosition}</span><h3>{selected.topic}</h3>
          <dl className="semantic-range-fields">
            <dt>Range ID</dt><dd>{selected.id}</dd>
            <dt>First message</dt><dd>{selected.firstPosition}</dd>
            <dt>Last message</dt><dd>{selected.lastPosition}</dd>
            <dt>Involved members</dt><dd>{selected.involvedMemberIds.length ? <ul>{selected.involvedMemberIds.map(id => <li key={id}>{members.find(member => member.memberId === id)?.name ?? id}</li>)}</ul> : 'None'}</dd>
            <dt>Child ranges</dt><dd>{selected.children.length}</dd>
          </dl>
          <h4>Summary</h4><p className="context-rendered-text">{selected.summary}</p>
          <details className="context-message-metadata"><summary>Index metadata</summary><dl className="semantic-range-fields"><dt>Revision</dt><dd>{index.revision}</dd><dt>Source digest</dt><dd>{index.sourceDigest}</dd></dl></details>
        </article> : <p className="context-loading">No semantic ranges generated yet.</p>}
      </div>
    </section>
  </>;
}

/** Reads only the saved Team index. Selection and expansion never invoke the backend. */
export function SemanticRangesView({ workspaceId, members, client }: { workspaceId: string; members: readonly Member[]; client: ContextClient }) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; index: GroupSemanticIndex | null }>({ loading: true, error: null, index: null });
  useEffect(() => {
    let active = true;
    setState({ loading: true, error: null, index: null });
    void client.semantic(workspaceId).then(({ index }) => { if (active) setState({ loading: false, error: null, index }); },
      cause => { if (active) setState({ loading: false, error: cause instanceof Error ? cause.message : 'Semantic ranges could not be loaded', index: null }); });
    return () => { active = false; };
  }, [client, workspaceId]);
  if (state.loading) return <p className="context-loading" role="status">Loading semantic ranges…</p>;
  if (state.error) return <div className="context-error" role="alert">{state.error}</div>;
  if (!state.index) return <><header className="context-content-head"><h2>Semantic ranges</h2></header><p className="context-loading">No semantic ranges generated yet.</p></>;
  return <SemanticRangeInspector index={state.index} members={members} />;
}
