import type { CSSProperties, ReactNode } from 'react';

export interface AppShellProps {
  /** Full-width toolbar above the rail, sidebar and main pane. */
  toolbar: ReactNode;
  navigationRail?: ReactNode;
  sidebar?: ReactNode;
  children: ReactNode;
  navigationLabel?: string;
  sidebarLabel?: string;
  className?: string;
  style?: CSSProperties;
}

/** Optional application frame. Import layout.css when composing this primitive. */
export function AppShell({
  toolbar, navigationRail, sidebar, children,
  navigationLabel = 'Primary navigation', sidebarLabel = 'Sidebar', className = '', style,
}: AppShellProps) {
  return <div className={`local-app-shell${className ? ` ${className}` : ''}`} style={style}>
    <header className="local-app-shell__toolbar">{toolbar}</header>
    <div className="local-app-shell__body">
      {navigationRail != null && <nav className="local-app-shell__rail" aria-label={navigationLabel}>{navigationRail}</nav>}
      {sidebar != null && <aside className="local-app-shell__sidebar" aria-label={sidebarLabel}>{sidebar}</aside>}
      <main className="local-app-shell__main">{children}</main>
    </div>
  </div>;
}

