import { useEffect, useState } from 'react';
import type { CurrentDesign, Member, WorkspaceClient } from '../client/workspace-client.js';
import { designMembers, designName, designTitle, sameDesign, designReference } from './design-state.js';
import { Markdown } from './Markdown.js';
import { resolveLink } from './markdown-parser.js';
import type { DesignsState } from './useDesigns.js';

export function DesignTab({ client, workspaceId, catalog, members, selected, onSelect, onMember, onImplementation, onDiscuss, onContextFile }: {
  client: WorkspaceClient; workspaceId: string; catalog: DesignsState; members: Member[]; selected: string | null;
  onSelect(path: string): void; onMember(memberId: string): void; onImplementation(path: string): void;
  onDiscuss(path: string): void; onContextFile(path: string): void;
}) {
  const [current, setCurrent] = useState<{ path: string; file: CurrentDesign | null; error: string | null } | null>(null);
  useEffect(() => { if (selected === null && catalog.designs[0]) onSelect(catalog.designs[0].path); }, [selected, catalog.designs, onSelect]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    setCurrent(null);
    client.readDesign(workspaceId, selected).then(file => {
      if (active) setCurrent({ path: selected, file, error: null });
    }, cause => {
      if (active) setCurrent({ path: selected, file: null, error: cause instanceof Error ? cause.message : 'Design could not be loaded' });
    });
    return () => { active = false; };
  }, [client, workspaceId, selected, catalog.generation]);
  const file = current?.path === selected ? current.file : null;
  const error = current?.path === selected ? current.error : null;
  const related = selected ? designMembers(selected, members) : { working: [], dependencies: [] };
  const openLink = (from: string, href: string) => {
    if (!selected) return;
    const path = resolveLink(from, href);
    if (!path) return;
    const design = catalog.designs.find(item => sameDesign(item.path, path));
    if (design) onSelect(design.path); else onContextFile(path);
  };
  return <section className="design-tab" aria-label="Current project designs">
    <header className="design-header"><div><span className="eyebrow">DESIGN</span><h2>Project design</h2></div>
      <button type="button" className="secondary-button" disabled={catalog.loading} onClick={() => void catalog.refresh()}>{catalog.loading ? 'Refreshing…' : 'Refresh'}</button>
    </header>
    {catalog.error && <div className="sidebar-error" role="alert">Design updates failed: {catalog.error}<button type="button" onClick={() => void catalog.refresh()}>Retry</button></div>}
    {catalog.truncated && <p className="design-notice" role="status">The design listing is incomplete. Open a member’s design link or browse Files to inspect other records.</p>}
    {!catalog.loading && !catalog.error && !catalog.designs.length && !selected && <div className="design-empty"><h3>No designs yet</h3><p>Ask the lead to help define the project design and its implementation scope.</p></div>}
    {catalog.loading && !catalog.designs.length && !selected && <p className="sidebar-muted">Reading designs…</p>}
    {(catalog.designs.length > 0 || selected) && <div className="design-layout">
      <nav className="design-list" aria-label="Designs"><ul>{catalog.designs.map(design => <li key={design.path}>
        <button type="button" aria-current={selected && sameDesign(selected, design.path) ? 'true' : undefined} onClick={() => onSelect(design.path)}>
          <strong>{designName(design.path)}</strong><span>{design.path}</span>
        </button>
      </li>)}</ul></nav>
      <div className="design-detail">
        {selected && <>
          <div className="design-detail-head"><div><h3>{file?.design ? designTitle(file.design.content, file.path) : designName(selected)}</h3><span className="design-path">{selected}</span></div>
            <button type="button" className="secondary-button" onClick={() => onDiscuss(selected)}>Discuss with lead</button>
          </div>
          {!current && <p className="sidebar-muted">Reading current design…</p>}
          {(error || file?.designIssue) && <div className="design-notice" role="alert">This design is unavailable: {error || file?.designIssue}
            <button type="button" className="text-button" onClick={() => onContextFile(file?.path ?? `design/${designReference(selected)}`)}>Open source file</button>
          </div>}
          {file?.design && <>
            <div className="design-content">{file.design.documents.map(document => <section key={document.path} aria-label={document.path}>{file.design!.documents.length > 1 && <h4>{document.path}</h4>}<Markdown source={document.content} onLink={href => openLink(document.path,href)} /></section>)}</div>
            <section className="design-section"><h4>Implementation</h4>
              {file.design.implementation.length ? <ul className="scope-paths">{file.design.implementation.map(path => <li key={path}>
                <button type="button" className="text-button" onClick={() => onImplementation(path)}>{path}</button>
              </li>)}</ul> : <p>No implementation paths mapped.</p>}
            </section>
          </>}
          <section className="design-section"><h4>Members working on this design</h4>
            <MemberLinks members={related.working} onMember={onMember} empty="No members assigned. This design remains part of the project." />
          </section>
          <section className="design-section"><h4>Members using this dependency</h4>
            <MemberLinks members={related.dependencies} onMember={onMember} empty="No members use it as a dependency." />
          </section>
        </>}
      </div>
    </div>}
  </section>;
}
function MemberLinks({ members, onMember, empty }: { members: Member[]; onMember(id: string): void; empty: string }) {
  return members.length ? <ul className="design-members">{members.map(member => <li key={member.memberId}>
    <button type="button" className="text-button" onClick={() => onMember(member.memberId)}>{member.name}</button><span>{member.role}</span>
  </li>)}</ul> : <p>{empty}</p>;
}
