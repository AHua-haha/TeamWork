import type { CSSProperties, ReactNode } from 'react';

export interface AppShellProps {
  /** Full-width toolbar above the rail, sidebar and main pane. */
  toolbar: ReactNode;
  navigationRail?: ReactNode;
  sidebar?: ReactNode;
  /** Controlled visibility; the sidebar stays mounted while closed. */
  sidebarOpen?: boolean;
  sidebarId?: string;
  children: ReactNode;
  navigationLabel?: string;
  sidebarLabel?: string;
  className?: string;
  style?: CSSProperties;
}

/** Optional application frame. Import layout.css when composing this primitive. */
export function AppShell({
  toolbar, navigationRail, sidebar, sidebarOpen = true, sidebarId, children,
  navigationLabel = 'Primary navigation', sidebarLabel = 'Sidebar', className = '', style,
}: AppShellProps) {
  return <div className={`shared-app-shell${className ? ` ${className}` : ''}`} style={style}
    data-rail-present={navigationRail != null} data-sidebar-open={sidebar != null && sidebarOpen}>
    <header className="shared-app-shell__toolbar">{toolbar}</header>
    <div className="shared-app-shell__body">
      {navigationRail != null && <nav className="shared-app-shell__rail" aria-label={navigationLabel}>{navigationRail}</nav>}
      {sidebar != null && <aside className="shared-app-shell__sidebar" id={sidebarId} aria-label={sidebarLabel}
        aria-hidden={!sidebarOpen} inert={!sidebarOpen}>
        <div className="shared-app-shell__sidebar-content">{sidebar}</div>
      </aside>}
      <main className="shared-app-shell__main">{children}</main>
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
  return <div className={`shared-thread-column${className ? ` ${className}` : ''}`} style={style}>
    <div className="shared-thread-column__content">{children}</div>
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
  return <div className={`shared-thread-row${avatar != null ? ' shared-thread-row--with-avatar' : ''}${className ? ` ${className}` : ''}`}>
    {avatar != null && <div className="shared-thread-row__avatar">{avatar}</div>}
    <div className="shared-thread-row__content">{children}</div>
  </div>;
}
