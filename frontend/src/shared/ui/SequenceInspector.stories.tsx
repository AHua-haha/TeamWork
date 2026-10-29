import type { Meta, StoryObj } from '@storybook/react-vite';
import { SequenceInspector } from './SequenceInspector.js';

type DemoPart = { type: 'thinking' | 'text' | 'tool'; label: string; content: string };
type DemoEntry = { role: string; tool?: string; status?: 'success' | 'failed'; hidden?: boolean; title: string; parts: DemoPart[] };

const entries: DemoEntry[] = [
  { role: 'system', title: 'System instructions', parts: [{ type: 'text', label: 'Text', content: 'The Agent follows the workspace instructions and preserves its context.' }] },
  { role: 'group', title: 'Operations · shared message', parts: [{ type: 'text', label: 'Text', content: 'The development database uses a project-specific service.' }] },
  { role: 'assistant', title: 'Assistant response', parts: [{ type: 'thinking', label: 'Thinking', content: 'I should inspect the current project state before reporting a result.' }, { type: 'text', label: 'Text', content: 'I will inspect the current project state and report the result.' }] },
  { role: 'tool', tool: 'read', status: 'success', title: 'Read file', parts: [{ type: 'tool', label: 'Tool call', content: '{ "path": "README.md" }' }, { type: 'text', label: 'Tool result', content: 'Project documentation loaded successfully.' }] },
  { role: 'tool', tool: 'edit', status: 'failed', hidden: true, title: 'Edit file', parts: [{ type: 'tool', label: 'Tool call', content: '{ "path": "README.md" }' }, { type: 'text', label: 'Tool result', content: 'The requested text was not found.' }] },
];

const meta = {
  title: 'Shared/SequenceInspector',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => <div className="storybook-light-demo">
    <h1>Agent context</h1>
    <p className="storybook-muted">Chronological persisted message entries</p>
    <SequenceInspector
      items={entries}
      getKey={(entry, index) => `${entry.role}-${index}`}
      renderRow={(entry, index) => <div className="sequence-inspector-meta" aria-label={`Message ${index + 1}, ${entry.role}${entry.tool ? `, ${entry.tool} tool` : ''}${entry.status ? `, ${entry.status}` : ''}${entry.hidden ? ', hidden' : ''}`}><span className="sequence-inspector-order">{String(index + 1).padStart(2, '0')}</span><span className={`sequence-inspector-badge is-${entry.role}`}>{entry.role}</span>{entry.tool && <span className="sequence-inspector-badge is-tool">{entry.tool}</span>}{entry.status && <span className={`sequence-inspector-badge is-${entry.status}`}>{entry.status}</span>}{entry.hidden && <span className="sequence-inspector-badge is-hidden">hidden</span>}</div>}
      renderDetail={(entry, index) => <><div className="eyebrow">ENTRY {String(index + 1).padStart(2, '0')} · {entry.role}</div><h2>{entry.title}</h2><div className="context-parts">{entry.parts.map((part, partIndex) => <section className={`context-part context-part-${part.type}`} key={`${part.type}-${partIndex}`}><strong>{part.label}</strong>{part.type === 'tool' ? <pre>{part.content}</pre> : <p>{part.content}</p>}</section>)}</div></>}
    />
  </div>,
};

export const Empty: Story = {
  render: () => <div style={{ padding: 24 }}><SequenceInspector items={[]} renderRow={() => null} renderDetail={() => null} /></div>,
};
