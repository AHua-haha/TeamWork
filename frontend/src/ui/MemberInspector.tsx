import { useEffect, useMemo, useState } from 'react';
import { WorkspaceClient, type Member, type MemberInspection } from '../client/workspace-client.js';

export function MemberInspector({ workspaceId, member }: { workspaceId: string; member: Member }) {
  const client = useMemo(() => new WorkspaceClient(), []);
  const [inspection, setInspection] = useState<MemberInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true; setInspection(null); setError(null);
    client.inspectMember(workspaceId, member.memberId).then(next => { if (current) setInspection(next); }, cause => { if (current) setError(cause instanceof Error ? cause.message : 'Inspection unavailable'); });
    return () => { current = false; };
  }, [client, workspaceId, member.memberId, member.revision, reload]);
  if (error) return <p role="alert">{error} <button type="button" className="text-button" onClick={() => setReload(n => n + 1)}>Retry inspection</button></p>;
  if (!inspection) return <p>Reading submitted configuration…</p>;
  const { configuration, harnesses, member: selected } = inspection;
  const options = selected.settings.modelOptions.find(m => m.connectionId === selected.settings.connectionId && m.modelId === selected.settings.modelId);
  return <div className="member-inspection">
    <h3>Submitted member configuration</h3>
    <p>Read only. Discuss member changes with the lead. Pending config files do not change this view.</p>
    <dl className="member-facts"><dt>Model</dt><dd>{selected.settings.modelId ?? 'None'} · {selected.settings.connectionId ?? 'No provider'}</dd><dt>Run options</dt><dd>{options ? Object.entries(options).filter(([key]) => !['connectionId', 'modelId'].includes(key)).map(([key, value]) => `${key}: ${value}`).join(' · ') || 'Provider defaults' : 'Provider defaults'}</dd></dl>
    {harnesses.map(harness => <section className="inspected-harness" key={harness.id}>
      <h3>{harness.id === 'project' ? 'Project harness' : 'Command harness'}</h3>
      <p className="harness-tools">{harness.tools.length ? harness.tools.map(tool => <code key={tool}>{tool}</code>) : 'No command execution allowed.'}</p>
      {harness.parts.map(part => <div className="inspected-part" key={part.id}><h4>{part.id === 'design' ? 'Design management' : part.id === 'implementation' ? 'Implementation' : 'Member configuration drafts'}</h4>
        <p>{part.commit === 'user' ? 'Commit requires user acceptance.' : 'Agent commits allowed.'}</p><ul>{part.paths.map(path => <li key={path}><code>{path}</code></li>)}</ul>
        {part.exclude.length > 0 && <p>Excluded: {part.exclude.join(', ')}</p>}
      </div>)}
      {harness.id === 'command' && <ul className="command-rules">{selected.harness.allowedCommands.map((rule, i) => <li key={i}><span>{rule.kind === 'exact' ? 'Exact command' : 'Executable with arguments'}</span><code>{rule.kind === 'exact' ? JSON.stringify(rule.argv) : rule.executable}</code></li>)}</ul>}
      <details><summary>Fixed operating rules</summary><pre>{harness.prompt}{harness.parts.map(p => `\n\n${p.id}: ${p.prompt}`).join('')}</pre></details>
    </section>)}
    {configuration ? <section className="member-config-source"><h3>Accepted configuration files</h3><p>{configuration.path}</p><small>Submitted {new Date(configuration.submittedAt).toLocaleString()}</small>
      {Object.entries(configuration.files).map(([path, text]) => <details key={path}><summary>{path}</summary><pre>{text || '(empty)'}</pre></details>)}
    </section> : <p>No submitted source bundle is available yet.</p>}
  </div>;
}
