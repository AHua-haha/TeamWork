import type { Meta, StoryObj } from '@storybook/react-vite';
import { SequenceInspector } from './SequenceInspector.js';

type DemoPart = { type: 'thinking' | 'text' | 'tool'; label: string; content: string };
type DemoEntry = { role: string; title: string; parts: DemoPart[] };

const entries: DemoEntry[] = [
  { role: 'system', title: 'System instructions', parts: [{ type: 'text', label: 'Text', content: 'The Agent follows the workspace instructions and preserves its context.' }] },
  { role: 'group', title: 'Operations · shared message', parts: [{ type: 'text', label: 'Text', content: 'The development database uses a project-specific service.' }] },
  { role: 'assistant', title: 'Assistant response', parts: [{ type: 'thinking', label: 'Thinking', content: 'I should inspect the current project state before reporting a result.' }, { type: 'text', label: 'Text', content: 'I will inspect the current project state and report the result.' }] },
  { role: 'tool', title: 'read_file', parts: [{ type: 'tool', label: 'Tool call', content: '{ "path": "README.md" }' }, { type: 'text', label: 'Tool result', content: 'Project documentation loaded successfully.' }] },
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
      renderRow={(entry, index) => <><strong>{String(index + 1).padStart(2, '0')} · {entry.role}</strong><br /><span>{entry.title}</span></>}
      renderDetail={(entry, index) => <><div className="eyebrow">ENTRY {String(index + 1).padStart(2, '0')} · {entry.role}</div><h2>{entry.title}</h2><div className="context-parts">{entry.parts.map((part, partIndex) => <section className={`context-part context-part-${part.type}`} key={`${part.type}-${partIndex}`}><strong>{part.label}</strong>{part.type === 'tool' ? <pre>{part.content}</pre> : <p>{part.content}</p>}</section>)}</div></>}
    />
  </div>,
};

export const Empty: Story = {
  render: () => <div style={{ padding: 24 }}><SequenceInspector items={[]} renderRow={() => null} renderDetail={() => null} /></div>,
};
