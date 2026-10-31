import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell, ThreadColumn, ThreadRow } from './AppShell.js';
import { NavigationRailButton } from './NavigationRailButton.js';
import { SidebarHeader } from './SidebarHeader.js';
import { SidebarSection } from './SidebarSection.js';
import './layout.css';
import './app-shell.stories.css';

const meta = {
  title: 'Shared/AppShell',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;
type Story = StoryObj;

function DemoIcon({ name }: { name: 'home' | 'projects' | 'history' | 'search' }) {
  const paths = {
    home: 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',
    projects: 'M3 6h6l2 3h10v11H3ZM3 6V4h6l2 2',
    history: 'M3 11a9 9 0 1 1 2 7M3 5v6h6M12 7v5l3 2',
    search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function LayoutExample({ style }: { style?: CSSProperties }) {
  return <AppShell
    className="shared-app-shell-demo"
    style={style}
    toolbar={<><strong>Window toolbar</strong><span>48 px high · spans the entire window</span></>}
    navigationRail={<><NavigationRailButton label="Home" icon={<DemoIcon name="home" />} active /><NavigationRailButton label="Projects" icon={<DemoIcon name="projects" />} /><NavigationRailButton label="History" icon={<DemoIcon name="history" />} /></>}
    sidebar={<>
      <SidebarHeader actions={<button type="button" aria-label="Search conversations"><DemoIcon name="search" /></button>}>
        <strong>Workspace</strong>
      </SidebarHeader>
      <div className="shared-sidebar-items shared-app-shell-demo__sidebar-content">
        <button type="button">New conversation</button>
        <SidebarSection title="Projects">
          <div className="shared-sidebar-items">
            <button type="button" aria-current="page">Current project</button>
            <button type="button">Another project</button>
          </div>
        </SidebarSection>
        <SidebarSection title="Recent">
          <div className="shared-sidebar-items">
            <button type="button">A recent conversation</button>
          </div>
        </SidebarSection>
      </div>
    </>}
  >
    <ThreadColumn>
      <div className="shared-app-shell-demo__thread-heading"><strong>Thread column</strong><span>832 px maximum content width · avatar excluded</span></div>
      <ThreadRow avatar={<span className="shared-app-shell-demo__avatar" role="img" aria-label="Assistant">A</span>}>
        <article><p className="shared-app-shell-demo__width-sample">Updated the design note. Backend build passed, and compiled prompts match the source. Restart the backend to load them.</p><p>The toolbar, navigation rail and sidebar are slots. Their buttons and data remain owned by the consuming screen.</p></article>
      </ThreadRow>
      <ThreadRow><div className="shared-app-shell-demo__user-message">The user message stays inside the same content column.</div></ThreadRow>
      <ThreadRow avatar={<span className="shared-app-shell-demo__avatar" role="img" aria-label="Assistant">A</span>}>
        <article><p>Content grows vertically and scrolls in the main pane. The toolbar stays above all three regions, while the rail and sidebar retain their widths.</p><div className="shared-app-shell-demo__content-block">A table, code block or message renderer can use this width without reserving space for an avatar.</div></article>
      </ThreadRow>
      <div className="shared-app-shell-demo__composer" aria-label="Composer layout placeholder"><span>Composer placeholder</span><span>This example defines layout only.</span></div>
    </ThreadColumn>
  </AppShell>;
}

export const ReferenceLayout: Story = {
  render: () => <LayoutExample />,
};

export const ConstrainedWidth: Story = {
  render: () => <LayoutExample style={{ width: '100%', maxWidth: 1100, height: 720 }} />,
};

export const NavigationAlignment: Story = {
  render: () => <LayoutExample />,
};

export const TallerSidebarHeader: Story = {
  render: () => <div className="shared-app-shell-demo--taller-header"><LayoutExample /></div>,
};

export const ContentWithoutAvatars: Story = {
  render: () => <AppShell
    className="shared-app-shell-demo"
    toolbar={<strong>Optional slots · rail and sidebar omitted</strong>}
  >
    <ThreadColumn>
      <ThreadRow><p>The same centered thread column also works without avatars, navigation or a sidebar.</p></ThreadRow>
    </ThreadColumn>
  </AppShell>,
};
