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

const meta = { title: 'Shared/SequenceInspector', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj;

const badgeClass = 'tw:inline-flex tw:min-h-5 tw:w-fit tw:max-w-full tw:items-center tw:truncate tw:rounded-full tw:px-[7px] tw:py-0.5 tw:text-[11px] tw:leading-[1.2] tw:font-semibold';
const badgeColors: Record<string, string> = {
  assistant: 'tw:text-[#24598c] tw:bg-[#dcecff]',
  system: 'tw:text-[#66508c] tw:bg-[#eee7fb]',
  group: 'tw:text-[#226b70] tw:bg-[#def1f1]',
  tool: 'tw:text-[#684c86] tw:bg-[#eee5f7]',
  success: 'tw:text-[#2e6a43] tw:bg-[#dff2e4]',
  failed: 'tw:text-[#9a3d3d] tw:bg-[#fbe3e3]',
  hidden: 'tw:text-[#65717d] tw:bg-[#e8ebee]',
};
function Badge({ value }: { value: string }) {
  return <span className={`${badgeClass} ${badgeColors[value] ?? badgeColors.tool}`}>{value}</span>;
}

// Per-consumer theme variables; shared geometry/behavior remain unchanged.
const demoClass = 'tw:box-border tw:min-h-dvh tw:bg-[#f7f9fb] tw:p-6 tw:text-[#263442] tw:[--line:#d7dee7] tw:[--surface:#fff] tw:[--surface-raised:#eaf2fb] tw:[--accent:#2563a8] tw:[--muted:#667586] tw:[&>.sequence-inspector]:shadow-[0_8px_24px_rgb(30_55_80/8%)]';

export const Default: Story = {
  render: () => <div className={demoClass}>
    <h1 className="tw:m-0 tw:text-[2em] tw:font-bold tw:text-[#17212b]">Agent context</h1>
    <p className="tw:text-[#667586]">Chronological persisted message entries</p>
    <SequenceInspector items={entries} getKey={(entry, index) => `${entry.role}-${index}`}
      renderRow={(entry, index) => <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2" aria-label={`Message ${index + 1}, ${entry.role}${entry.tool ? `, ${entry.tool} tool` : ''}${entry.status ? `, ${entry.status}` : ''}${entry.hidden ? ', hidden' : ''}`}><span className="tw:flex-[0_0_2ch] tw:text-right tw:font-mono tw:text-[11px] tw:text-[#9aa6b2]">{String(index + 1).padStart(2, '0')}</span><Badge value={entry.role} />{entry.tool && <span className={`${badgeClass} ${badgeColors.tool}`}>{entry.tool}</span>}{entry.status && <Badge value={entry.status} />}{entry.hidden && <Badge value="hidden" />}</div>}
      renderDetail={(entry, index) => <><div className="tw:font-mono tw:text-[10px] tw:font-semibold tw:tracking-[.14em] tw:text-[#769081]">ENTRY {String(index + 1).padStart(2, '0')} · {entry.role}</div><h2>{entry.title}</h2><div className="tw:mt-5 tw:grid tw:gap-3">{entry.parts.map((part, partIndex) => <section className="tw:rounded-lg tw:border tw:border-solid tw:border-[#d7dee7] tw:bg-[#fbfcfe] tw:px-3.5 tw:py-3" key={`${part.type}-${partIndex}`}><strong>{part.label}</strong>{part.type === 'tool' ? <pre className="tw:overflow-x-auto">{part.content}</pre> : <p>{part.content}</p>}</section>)}</div></>}
    />
  </div>,
};
export const Empty: Story = {
  render: () => <div className={demoClass}><SequenceInspector items={[]} renderRow={() => null} renderDetail={() => null} /></div>,
};
