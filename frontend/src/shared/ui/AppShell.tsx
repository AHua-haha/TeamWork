import type { CSSProperties, ReactNode, Ref } from 'react';

export interface AppShellProps {
  /** Full-width toolbar above the rail, sidebar and main pane. */
  toolbar: ReactNode;
  navigationRail?: ReactNode;
  sidebar?: ReactNode;
  /** Controlled visibility; the sidebar stays mounted while closed. */
  sidebarOpen?: boolean;
  sidebarId?: string;
  /** Access to the main scroll pane for local presentation effects. */
  mainRef?: Ref<HTMLElement>;
  children: ReactNode;
  navigationLabel?: string;
  sidebarLabel?: string;
  className?: string;
  style?: CSSProperties;
}

/** Optional application frame. Load shared/ui/styles.css once in the host. */
export function AppShell({
  toolbar, navigationRail, sidebar, sidebarOpen = true, sidebarId, mainRef, children,
  navigationLabel = 'Primary navigation', sidebarLabel = 'Sidebar', className = '', style,
}: AppShellProps) {
  return <div className={`shared-app-shell tw:box-border tw:flex tw:h-full tw:w-full tw:min-h-0 tw:min-w-0 tw:flex-col tw:overflow-hidden tw:[--shared-visible-rail-width:var(--shared-rail-width)] tw:[--shared-visible-sidebar-width:var(--shared-sidebar-width)] tw:data-[rail-present=false]:[--shared-visible-rail-width:0px] tw:data-[sidebar-open=false]:[--shared-visible-sidebar-width:0px] ${className}`} style={style}
    data-rail-present={navigationRail != null} data-sidebar-open={sidebar != null && sidebarOpen}>
    <header data-slot="toolbar" className="shared-app-shell__toolbar tw:box-border tw:flex tw:h-[var(--shared-toolbar-height)] tw:min-w-0 tw:flex-[0_0_var(--shared-toolbar-height)] tw:items-center tw:overflow-auto">{toolbar}</header>
    <div className="shared-app-shell__body tw:grid tw:min-h-0 tw:min-w-0 tw:flex-auto tw:grid-cols-[var(--shared-visible-rail-width)_var(--shared-visible-sidebar-width)_minmax(0,1fr)] tw:grid-rows-[minmax(0,1fr)] tw:transition-[grid-template-columns] tw:duration-[var(--shared-sidebar-transition-duration)] tw:ease-[var(--shared-sidebar-transition-easing)]">
      {navigationRail != null && <nav data-slot="rail" className="shared-app-shell__rail tw:box-border tw:col-start-1 tw:row-start-1 tw:flex tw:w-[var(--shared-rail-width)] tw:min-h-0 tw:min-w-0 tw:flex-col tw:items-center tw:overflow-auto" aria-label={navigationLabel}>{navigationRail}</nav>}
      {sidebar != null && <aside data-slot="sidebar" className="shared-app-shell__sidebar tw:visible tw:box-border tw:col-start-2 tw:row-start-1 tw:min-h-0 tw:min-w-0 tw:overflow-hidden tw:transition-[visibility] tw:delay-0 tw:duration-0 tw:ease-linear tw:aria-hidden:invisible tw:aria-hidden:delay-[var(--shared-sidebar-transition-duration)]" id={sidebarId} aria-label={sidebarLabel}
        aria-hidden={!sidebarOpen} inert={!sidebarOpen}>
        <div className="shared-app-shell__sidebar-content tw:box-border tw:h-full tw:w-[var(--shared-sidebar-width)] tw:overflow-x-hidden tw:overflow-y-auto">{sidebar}</div>
      </aside>}
      <main ref={mainRef} className="shared-app-shell__main tw:relative tw:col-start-3 tw:row-start-1 tw:min-h-0 tw:min-w-0 tw:overflow-auto">{children}</main>
    </div>
  </div>;
}

export interface ThreadColumnProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** Centers the content width and reserves separate space for adjacent avatars. */
export function ThreadColumn({ children, className = '', style }: ThreadColumnProps) {
  return <div className={`shared-thread-column tw:box-border tw:flex tw:min-h-full tw:w-full tw:justify-center tw:px-[calc(var(--shared-thread-avatar-size,32px)+var(--shared-thread-avatar-gap,12px)+var(--shared-thread-edge-padding,16px))] ${className}`} style={style}>
    <div data-slot="thread-content" className="shared-thread-column__content tw:box-border tw:w-[var(--shared-thread-width,724px)] tw:max-w-full tw:min-w-0 tw:text-[length:var(--shared-thread-font-size,14px)] tw:leading-[var(--shared-thread-line-height,1.65)]">{children}</div>
  </div>;
}

export interface ThreadRowProps {
  children: ReactNode;
  /** Positioned in the leading gutter, outside the content-width budget. */
  avatar?: ReactNode;
  className?: string;
}

/** A presentation row; the caller supplies message content and avatar semantics. */
export function ThreadRow({ children, avatar, className = '' }: ThreadRowProps) {
  return <div className={`shared-thread-row tw:relative tw:min-w-0 ${avatar != null ? 'shared-thread-row--with-avatar tw:min-h-[var(--shared-thread-avatar-size,32px)]' : ''} ${className}`}>
    {avatar != null && <div className="shared-thread-row__avatar tw:absolute tw:[inset-block-start:0] tw:[inset-inline-end:calc(100%+var(--shared-thread-avatar-gap,12px))] tw:grid tw:size-[var(--shared-thread-avatar-size,32px)] tw:place-items-center tw:[&>*]:max-h-full tw:[&>*]:max-w-full">{avatar}</div>}
    <div className="shared-thread-row__content tw:min-w-0 tw:[overflow-wrap:anywhere]">{children}</div>
  </div>;
}
