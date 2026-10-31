import type { CSSProperties } from 'react';
import { useId, useRef, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell, ThreadColumn, ThreadRow } from './AppShell.js';
import { NavigationRailButton } from './NavigationRailButton.js';
import { SidebarHeader } from './SidebarHeader.js';
import { SidebarSection } from './SidebarSection.js';
import { SidebarItems } from './SidebarItems.js';
import { WindowToolbar } from './WindowToolbar.js';
import { ComposerActionButton } from './ComposerActionButton.js';
import { useComposerScrollCollapse } from './useComposerScrollCollapse.js';

const meta = {
  title: 'Shared/AppShell',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj;

function DemoIcon({ name }: { name: 'home' | 'projects' | 'history' | 'search' | 'refresh' }) {
  const paths = {
    home: 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',
    projects: 'M3 6h6l2 3h10v11H3ZM3 6V4h6l2 2',
    history: 'M3 11a9 9 0 1 1 2 7M3 5v6h6M12 7v5l3 2',
    search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    refresh: 'M20 7a8 8 0 1 0 1 8M20 3v5h-5',
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

const demoShellClass = 'tw:bg-ui-canvas tw:text-ui-text tw:[&>[data-slot=toolbar]]:border-0 tw:[&>[data-slot=toolbar]]:border-b tw:[&>[data-slot=toolbar]]:border-solid tw:[&>[data-slot=toolbar]]:border-ui-border tw:[&>[data-slot=toolbar]]:bg-ui-chrome tw:[&>[data-slot=toolbar]>strong]:px-3 tw:[&_[data-slot=rail]]:bg-ui-chrome tw:[&_[data-slot=sidebar]]:bg-ui-sidebar tw:[&_[data-slot=sidebar]]:shadow-[inset_-1px_0_#e6e6e6]';
const sidebarActionClass = 'tw:cursor-pointer tw:rounded-lg tw:border-0 tw:bg-transparent tw:px-3 tw:text-start tw:text-inherit tw:aria-[current=page]:bg-ui-selected tw:focus-visible:outline-2 tw:focus-visible:outline-ui-focus tw:focus-visible:outline-offset-2';
const sectionClass = 'tw:[&_[data-slot=sidebar-toggle]]:font-semibold tw:[&_[data-slot=sidebar-toggle]]:text-ui-muted';
const threadClass = 'tw:pt-8 tw:[&>[data-slot=thread-content]]:flex tw:[&>[data-slot=thread-content]]:flex-col tw:[&>[data-slot=thread-content]]:gap-7';
const avatarClass = 'tw:grid tw:size-full tw:place-items-center tw:rounded-full tw:bg-[#e1eee8] tw:text-xs tw:text-[#376750]';
const articleClass = 'tw:[&>p:first-child]:mt-0 tw:[&>p:last-child]:mb-0';

const toolbarActionClass = 'tw:box-border tw:inline-flex tw:size-8 tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-lg tw:border-0 tw:bg-transparent tw:p-0 tw:text-inherit tw:hover:bg-[#e5e5e5] tw:focus-visible:outline-2 tw:focus-visible:outline-ui-focus tw:focus-visible:outline-offset-2 tw:[&>svg]:size-[18px]';

function LayoutExample({ style, initialSidebarOpen = true, longConversation = false, initialRunning = false }: { style?: CSSProperties; initialSidebarOpen?: boolean; longConversation?: boolean; initialRunning?: boolean }) {
  const [sidebarOpen, setSidebarOpen] = useState(initialSidebarOpen);
  const [draft, setDraft] = useState('');
  const [previewRunning, setPreviewRunning] = useState(initialRunning);
  const viewport = useRef<HTMLElement>(null);
  const composer = useRef<HTMLFormElement>(null);
  const compact = useComposerScrollCollapse(viewport, composer);
  const sidebarId = useId();
  return <AppShell
    className={demoShellClass}
    style={{ height: '100dvh', ...style }}
    sidebarOpen={sidebarOpen}
    sidebarId={sidebarId}
    mainRef={viewport}
    toolbar={<WindowToolbar
      logo={<span className="tw:grid tw:size-6 tw:flex-none tw:place-items-center tw:rounded-md tw:bg-[#e1eee8] tw:font-bold tw:text-[#376750]" aria-hidden="true">R</span>}
      brand={<div className="tw:flex tw:min-w-0 tw:flex-col tw:[&>*]:truncate"><strong>RSI Agent</strong><span className="tw:text-xs tw:text-ui-muted">Workspace</span></div>}
      title="Current project"
      actions={<><button type="button" className={toolbarActionClass} aria-label="Refresh main panel" title="Refresh"><DemoIcon name="refresh" /></button><button type="button" className={toolbarActionClass} aria-label="More main panel actions" title="More actions">···</button></>}
      sidebarOpen={sidebarOpen}
      onSidebarToggle={() => setSidebarOpen(open => !open)}
      sidebarId={sidebarId}
    />}
    navigationRail={<><NavigationRailButton label="Home" icon={<DemoIcon name="home" />} className="tw:rounded-lg tw:aria-[current=page]:bg-[#e5e5e5]" active /><NavigationRailButton label="Projects" icon={<DemoIcon name="projects" />} className="tw:rounded-lg" /><NavigationRailButton label="History" icon={<DemoIcon name="history" />} className="tw:rounded-lg" /></>}
    sidebar={<>
      <SidebarHeader actions={<button type="button" aria-label="Search conversations" className="tw:grid tw:size-6 tw:cursor-pointer tw:place-items-center tw:rounded-lg tw:border-0 tw:bg-transparent tw:p-0 tw:text-inherit tw:focus-visible:outline-2 tw:focus-visible:outline-ui-focus tw:[&>svg]:size-4"><DemoIcon name="search" /></button>}>
        <strong>Workspace</strong>
      </SidebarHeader>
      <SidebarItems className="tw:px-3 tw:py-2">
        <button type="button" className={sidebarActionClass}>New conversation</button>
        <SidebarSection title="Projects" className={sectionClass}>
          <SidebarItems>
            <button type="button" className={sidebarActionClass} aria-current="page">Current project</button>
            <button type="button" className={sidebarActionClass}>Another project</button>
          </SidebarItems>
        </SidebarSection>
        <SidebarSection title="Recent" className={sectionClass}>
          <SidebarItems>
            <button type="button" className={sidebarActionClass}>A recent conversation</button>
          </SidebarItems>
        </SidebarSection>
      </SidebarItems>
    </>}
  >
    <ThreadColumn className={threadClass}>
      <div className="tw:mb-3 tw:flex tw:flex-col tw:gap-2"><strong>Thread column</strong><span className="tw:text-xs tw:text-ui-muted">724 px maximum content width · avatar excluded</span></div>
      <ThreadRow avatar={<span className={avatarClass} role="img" aria-label="Assistant">A</span>}>
        <article className={articleClass}><p>Updated the design note. Backend build passed, and compiled prompts match the source. Restart the backend to load them.</p><p>The toolbar, navigation rail and sidebar are slots. Their buttons and data remain owned by the consuming screen.</p></article>
      </ThreadRow>
      <ThreadRow><div className="tw:box-border tw:ms-auto tw:w-fit tw:max-w-3/4 tw:rounded-[18px] tw:bg-[#eaf2fc] tw:px-[18px] tw:py-3.5">The user message stays inside the same content column.</div></ThreadRow>
      <ThreadRow avatar={<span className={avatarClass} role="img" aria-label="Assistant">A</span>}>
        <article className={articleClass}><p>Content grows vertically and scrolls in the main pane. The toolbar stays above all three regions, while the rail and sidebar retain their widths.</p><div className="tw:rounded-xl tw:border tw:border-solid tw:border-ui-border tw:bg-[#f5f5f5] tw:p-5">A table, code block or message renderer can use this width without reserving space for an avatar.</div></article>
      </ThreadRow>
      {longConversation && Array.from({ length: 8 }, (_, index) => <ThreadRow key={index} avatar={<span className={avatarClass} role="img" aria-label="Assistant">A</span>}>
        <article className={articleClass}><p>Review note {index + 1}. The composer floats above this conversation. Only the input box has a surface; messages remain visible around it while you scroll.</p><p>At the end of the conversation, there is enough space to read this entire message above the composer.</p></article>
      </ThreadRow>)}
      <div className="tw:pointer-events-none tw:sticky tw:bottom-0 tw:z-10 tw:mt-auto tw:pt-3 tw:pb-4">
        <form ref={composer} data-compact={compact} className={`tw:pointer-events-auto tw:box-border tw:rounded-[18px] tw:border tw:border-solid tw:border-ui-border tw:bg-ui-canvas tw:px-3.5 tw:transition-[padding] tw:duration-150 tw:motion-reduce:transition-none tw:shadow-[0_8px_32px_rgb(36_48_40/12%)] tw:focus-within:border-[#8fbea0] tw:focus-within:ring-2 tw:focus-within:ring-[#8fbea055] ${compact ? 'tw:py-2' : 'tw:py-3.5'}`} aria-label="Composer layout preview" onSubmit={event => { event.preventDefault(); if (draft.trim() && !previewRunning) { setPreviewRunning(true); setDraft(''); } }}>
          <textarea aria-label="Message draft" placeholder="Message the team…" rows={2} value={draft} onChange={event => setDraft(event.target.value)} className={`tw:box-border tw:block tw:w-full tw:resize-none tw:rounded-lg tw:border-0 tw:bg-transparent tw:px-1 tw:[font:inherit] tw:text-inherit tw:outline-none tw:focus-visible:outline-none tw:transition-[min-height,max-height,padding] tw:duration-150 tw:motion-reduce:transition-none ${compact ? 'tw:min-h-6 tw:max-h-6 tw:overflow-hidden tw:py-0' : 'tw:min-h-[62px] tw:max-h-[220px] tw:py-1'}`} />
          <div role="group" aria-label="Composer actions" className="tw:mt-2 tw:box-border tw:flex tw:[--composer-action-row-height:var(--shared-sidebar-item-height,32px)] tw:h-[var(--composer-action-row-height)] tw:min-h-[var(--composer-action-row-height)] tw:min-w-0 tw:shrink-0 tw:items-center tw:justify-between tw:gap-3">
            <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-2">
              <button type="button" aria-label="Attach files" title="Attachment control (layout preview)" className="tw:inline-flex tw:size-[1lh] tw:flex-none tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-full tw:border-0 tw:bg-transparent tw:p-0 tw:text-[14px] tw:leading-[1.65] tw:text-ui-muted tw:hover:bg-ui-selected tw:focus-visible:outline-2 tw:focus-visible:outline-ui-focus">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              </button>
              <span className="tw:min-w-0 tw:truncate tw:text-xs tw:text-ui-muted" role="status">{previewRunning ? 'Preview running' : 'Layout preview'}</span>
            </div>
            <ComposerActionButton type={previewRunning ? 'button' : 'submit'} running={previewRunning} disabled={!previewRunning && !draft.trim()} onClick={previewRunning ? () => setPreviewRunning(false) : undefined} />
          </div>
        </form>
      </div>
    </ThreadColumn>
  </AppShell>;
}

export const ReferenceLayout: Story = { render: () => <LayoutExample /> };
export const ConstrainedWidth: Story = { render: () => <LayoutExample style={{ width: '100%', maxWidth: 1100, height: 720 }} /> };
export const NavigationAlignment: Story = { render: () => <LayoutExample /> };
export const TallerSidebarHeader: Story = {
  render: () => <LayoutExample style={{ '--shared-sidebar-header-height': '56px' } as CSSProperties} />,
};
export const WindowToolbarLayout: Story = { render: () => <LayoutExample /> };
export const SidebarClosed: Story = { render: () => <LayoutExample initialSidebarOpen={false} /> };
export const FloatingComposer: Story = { render: () => <LayoutExample initialSidebarOpen={false} longConversation /> };
export const ComposerRunning: Story = { render: () => <LayoutExample initialSidebarOpen={false} initialRunning /> };
export const ContentWithoutAvatars: Story = {
  render: () => <AppShell className={demoShellClass} style={{ height: '100dvh' }} toolbar={<strong>Optional slots · rail and sidebar omitted</strong>}>
    <ThreadColumn className={threadClass}>
      <ThreadRow><p>The same centered thread column also works without avatars, navigation or a sidebar.</p></ThreadRow>
    </ThreadColumn>
  </AppShell>,
};
