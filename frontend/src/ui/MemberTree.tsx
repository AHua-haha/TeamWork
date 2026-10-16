import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { DesignSummary, Member } from '../client/workspace-client.js';
import { memberTree, type MemberTreeNode } from './member-tree.js';
import { memberStatus } from './team-state.js';
import { memberColor } from './group-work.js';
import { Glyph } from './Glyph.js';

export function MemberTree({ name, designs, members, selected, onSelect, onDesign }: { name: string; designs: DesignSummary[]; members: Member[]; selected: string | null; onSelect(id: string): void; onDesign(path: string): void }) {
  const nodes = useMemo(() => memberTree(designs, members), [designs, members]);
  const rootMembers = members.filter(member => member.lead || !member.harness.designScope.working.length);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) return;
    const card = root.current?.querySelector<HTMLElement>('.member-scope-card.selected');
    let parent = card?.parentElement;
    while (parent && parent !== root.current) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);
  const cards = (items: Member[], scope: string | null) => items.length ? items.map(member => <MemberCard key={member.memberId} member={member} scope={scope} selected={selected === member.memberId} onSelect={() => onSelect(member.memberId)} />) : <span className="member-unassigned">No member assigned</span>;
  const fileRow = (item: MemberTreeNode) => <div className="member-design-row" key={item.path}>
    <button type="button" className="member-design-file" onClick={() => onDesign(item.path)}><Glyph name="file" /><span>{item.name}</span>{item.unavailable && <small>Unavailable</small>}</button><span className="member-card-connector" aria-hidden="true" /><div className="member-attached-cards">{cards(item.members, item.path)}</div>
  </div>;
  const node = (item: MemberTreeNode): ReactNode => item.folder ? <details className="member-design-folder" key={item.path} open><summary><Glyph name="chevron" /><Glyph name="folder" />{item.name}</summary><div className="member-design-children">{item.members.length > 0 && fileRow(item)}{item.children.map(node)}</div></details> : fileRow(item);
  return <div ref={root} className="member-design-tree" aria-label="Design file tree with assigned members"><div className="member-design-row workspace-root"><span className="member-design-file"><Glyph name="folder" />{name}</span><span className="member-card-connector" aria-hidden="true" /><div className="member-attached-cards">{cards(rootMembers, null)}</div></div><div className="member-design-children">{nodes.map(node)}</div></div>;
}
function MemberCard({ member, scope, selected, onSelect }: { member: Member; scope: string | null; selected: boolean; onSelect(): void }) {
  const [preview, setPreview] = useState(false), previewId = useId();
  const status = memberStatus(member);
  return <article className={`member-scope-card ${selected ? 'selected' : ''}`} style={{ '--member-color': memberColor(member.memberId) } as CSSProperties} onMouseLeave={() => setPreview(false)}>
    <div className="member-card-scope">{scope ?? (member.lead ? 'Workspace design & member management' : 'No working design assigned')}</div>
    <div className="member-card-person"><div className="member-avatar-container"><button type="button" className="member-avatar" aria-label={`Open ${member.name} active details`} aria-describedby={preview ? previewId : undefined} aria-expanded={selected} onMouseEnter={() => setPreview(true)} onFocus={() => setPreview(true)} onBlur={() => setPreview(false)} onKeyDown={event => { if (event.key === 'Escape') setPreview(false); }} onClick={() => { setPreview(false); onSelect(); }}>{member.name.slice(0, 1).toUpperCase()}</button>
      <div id={previewId} role="tooltip" className="member-popover" hidden={!preview}>
        <strong>{member.name}</strong><p>{member.role} · {status.label}</p>
        {status.reasons.length > 0 && <p className="member-reasons">{status.reasons.join(' · ')}</p>}
        <h4>Working designs</h4><ScopeList paths={member.harness.designScope.working} />
        <h4>Dependencies</h4><ScopeList paths={member.harness.designScope.dependencies} />
        <h4>Harness configuration</h4><p>Management: {member.lead ? 'Designs and members' : 'Assigned designs'} · user commits</p><p>Implementation: {member.harness.implementationScope.paths.length ? 'Read/edit · agent commits' : 'No edits assigned'}</p><ScopeList paths={member.harness.implementationScope.paths} />
        <p>Read only</p><ScopeList paths={member.harness.implementationScope.usePaths} />
        <p>Execute: {member.harness.allowedCommands.length ? `${member.harness.allowedCommands.length} command allowances` : 'No general execution'}</p>
        {member.harness.allowedCommands.map((rule, index) => <code key={index}>{rule.kind === 'exact' ? JSON.stringify(rule.argv) : rule.executable}</code>)}
      </div>
    </div><div className="member-card-identity"><strong>{member.name}</strong><span>{member.role}</span></div><span className={`member-card-status ${status.label.replaceAll(' ', '-').toLowerCase()}`}>{status.label}</span></div>
    <p className="member-card-responsibility">{member.responsibility || 'No responsibility given yet.'}</p>
  </article>;
}
function ScopeList({ paths }: { paths: string[] }) { return paths.length ? <ul>{paths.map(path => <li key={path}><code>{path}</code></li>)}</ul> : <p>None assigned</p>; }
