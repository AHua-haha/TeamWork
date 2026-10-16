import { useEffect, useMemo, useState } from 'react';
import { WorkspaceClient, type Member, type MemberInspection } from '../client/workspace-client.js';
import { memberStatus } from './team-state.js';

export function MemberInspector({ workspaceId, member, onDesign, onImplementation }: { workspaceId: string; member: Member; onDesign(path: string): void; onImplementation(path: string): void }) {
  const client = useMemo(() => new WorkspaceClient(), []);
  const [inspection, setInspection] = useState<MemberInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const scopeKey = JSON.stringify(member.harness);
  useEffect(() => {
    let current = true; setInspection(null); setError(null);
    client.inspectMember(workspaceId, member.memberId).then(next => { if (current) setInspection(next); }, cause => { if (current) setError(cause instanceof Error ? cause.message : 'Inspection unavailable'); });
    return () => { current = false; };
  }, [client, workspaceId, member.memberId, member.revision, scopeKey, reload]);
  if (error) return <p role="alert">{error} <button type="button" className="text-button" onClick={() => setReload(n => n + 1)}>Retry inspection</button></p>;
  if (!inspection) return <p>Reading active configuration…</p>;
  const { configuration, harnesses, member: selected } = inspection;
  const options = selected.settings.modelOptions.find(m => m.connectionId === selected.settings.connectionId && m.modelId === selected.settings.modelId);
  const status = memberStatus(member);
  return <div className="member-inspection">
    <h3>{selected.name}</h3><p className="member-inspection-role">{selected.role} · {status.label}</p>
    {status.reasons.length > 0 && <p className="member-reasons">{status.reasons.join(' · ')}</p>}
    <h4>Responsibility</h4><p className="member-inspection-responsibility">{selected.responsibility || 'None specified'}</p>
    <dl className="member-facts"><dt>Model</dt><dd>{selected.settings.modelId ?? 'None'} · {selected.settings.connectionId ?? 'No provider'}</dd><dt>Run options</dt><dd>{options ? Object.entries(options).filter(([key]) => !['connectionId', 'modelId'].includes(key)).map(([key, value]) => `${key}: ${value}`).join(' · ') || 'Provider defaults' : 'Provider defaults'}</dd></dl>
    <h4>Working designs</h4><PathLinks paths={selected.harness.designScope.working} onOpen={onDesign} />
    <h4>Dependency designs</h4><PathLinks paths={selected.harness.designScope.dependencies} onOpen={onDesign} />
    <h4>Implementation · read & edit</h4><PathLinks paths={selected.harness.implementationScope.paths} onOpen={onImplementation} />
    <h4>Implementation · read only</h4><PathLinks paths={selected.harness.implementationScope.usePaths} onOpen={onImplementation} />
    <p className="member-inspection-note">Permissions derive from accepted designs. Read-only paths take precedence on overlap.</p>
    {harnesses.map(harness => <section className="inspected-harness" key={harness.id}>
      <h3>{harness.id === 'management' ? 'Management harness' : harness.id === 'implementation' ? 'Implementation harness' : 'Execute harness'}</h3>
      <p className="harness-tools">{harness.tools.length ? harness.tools.map(tool => <code key={tool}>{tool}</code>) : 'No command execution allowed.'}</p>
      {harness.parts.map(part => <div className="inspected-part" key={part.id}><h4>{part.id === 'design' ? 'Design management' : part.id === 'implementation' ? 'Implementation' : 'Member configuration drafts'}</h4>
        <p>{part.commit === 'user' ? 'Commit requires user acceptance.' : 'Agent commits allowed.'}</p><ul>{part.paths.map(path => <li key={path}><code>{path}</code></li>)}</ul>
        {part.exclude.length > 0 && <p>Excluded: {part.exclude.join(', ')}</p>}
      </div>)}
      {harness.id === 'execute' && <ul className="command-rules">{selected.harness.allowedCommands.map((rule, i) => <li key={i}><span>{rule.kind === 'exact' ? 'Exact command' : 'Executable with arguments'}</span><code>{rule.kind === 'exact' ? JSON.stringify(rule.argv) : rule.executable}</code></li>)}</ul>}
      <details><summary>Fixed operating rules</summary><pre>{harness.prompt}{harness.parts.map(p => `\n\n${p.id}: ${p.prompt}`).join('')}</pre></details>
    </section>)}
    <section className="member-config-source"><details><summary>Complete active run settings</summary><pre>{JSON.stringify(selected.settings, null, 2)}</pre></details></section>
    {configuration ? <section className="member-config-source"><h3>Active configuration files</h3><p>{configuration.path}</p>
      {Object.entries(configuration.files).map(([path, text]) => <details key={path}><summary>{path}</summary><pre>{text || '(empty)'}</pre></details>)}
      <details><summary>Source metadata</summary><dl className="member-facts"><dt>Member ID</dt><dd>{selected.memberId}</dd><dt>Revision</dt><dd>{selected.revision}</dd><dt>Format</dt><dd>{configuration.formatVersion ?? 'Legacy'}</dd><dt>Digest</dt><dd>{configuration.digest}</dd><dt>Accepted source</dt><dd>{configuration.acceptedRevision ?? 'Backend initialized'}</dd><dt>Attributed to</dt><dd>{configuration.submittedBy}</dd><dt>Source captured</dt><dd>{new Date(configuration.submittedAt).toLocaleString()}</dd></dl></details>
    </section> : <p>No submitted source bundle is available yet.</p>}
  </div>;
}
function PathLinks({ paths, onOpen }: { paths: string[]; onOpen(path: string): void }) { return paths.length ? <ul className="member-detail-paths">{paths.map(path => <li key={path}><button type="button" className="text-button" onClick={() => onOpen(path)}>{path}</button></li>)}</ul> : <p className="member-inspection-note">None assigned</p>; }
