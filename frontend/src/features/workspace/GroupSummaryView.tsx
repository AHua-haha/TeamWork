import { useEffect, useState } from 'react';
import type { ContextClient, GroupSummary } from '../../shared/backend-client/context-client.js';
import { SequenceInspector } from '../../shared/ui/index.js';

export function GroupSummaryInspector({ summary, retainedMessages }: { summary: GroupSummary; retainedMessages: number }) {
  return <>
    <header className="context-content-head"><div><span className="eyebrow">GROUP CHAT</span><h2>Shared summary</h2></div><span className="context-revision">Revision {summary.revision}</span></header>
    <p className="group-summary-coverage">Summarized messages {summary.from}–{summary.through} · {retainedMessages} recent messages retained</p>
    <SequenceInspector items={[summary]} getKey={item => item.messageId}
      renderRow={item => <><strong>Shared summary</strong><span>Messages {item.from}–{item.through}</span></>}
      renderDetail={item => <article className="context-message-detail"><span className="eyebrow">SHARED GROUP CONTEXT</span><h3>Summary</h3>
        <dl className="group-summary-fields"><dt>Revision</dt><dd>{item.revision}</dd><dt>Summarized prefix</dt><dd>{item.from}–{item.through}</dd>
          <dt>Analyzed through</dt><dd>{item.analyzedThrough}</dd><dt>Retained messages</dt><dd>{retainedMessages}</dd></dl>
        <p className="context-rendered-text">{item.text}</p>
        <details className="context-message-metadata"><summary>Summary metadata</summary><pre>{JSON.stringify({ messageId: item.messageId, sourceDigest: item.sourceDigest, time: item.time }, null, 2)}</pre></details>
      </article>} />
  </>;
}

/** Inspect only the saved shared summary. Reading never starts maintenance. */
export function GroupSummaryView({ workspaceId, client }: { workspaceId: string; client: ContextClient }) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; summary: GroupSummary | null; retainedMessages: number }>({ loading: true, error: null, summary: null, retainedMessages: 30 });
  useEffect(() => {
    let active = true;
    setState({ loading: true, error: null, summary: null, retainedMessages: 30 });
    void client.summary(workspaceId).then(result => { if (active) setState({ loading: false, error: null, ...result }); },
      cause => { if (active) setState({ loading: false, error: cause instanceof Error ? cause.message : 'Group summary could not be loaded', summary: null, retainedMessages: 30 }); });
    return () => { active = false; };
  }, [client, workspaceId]);
  if (state.loading) return <p className="context-loading" role="status">Loading group summary…</p>;
  if (state.error) return <div className="context-error" role="alert">{state.error}</div>;
  if (!state.summary) return <><header className="context-content-head"><h2>Shared summary</h2></header><p className="context-loading">No group summary generated yet.</p></>;
  return <GroupSummaryInspector summary={state.summary} retainedMessages={state.retainedMessages} />;
}
