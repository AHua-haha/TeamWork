import type { ReactNode } from 'react';

export interface WindowToolbarProps {
  /** Persistent logo; remains visible when the sidebar closes. */
  logo?: ReactNode;
  /** Application name and optional supporting information. */
  brand: ReactNode;
  /** Title/information for the currently displayed main panel. */
  title: ReactNode;
  actions?: ReactNode;
  sidebarOpen: boolean;
  onSidebarToggle: () => void;
  sidebarId?: string;
  className?: string;
}

/** Three presentation slots aligned to the shell's rail, sidebar and main pane. */
export function WindowToolbar({
  logo, brand, title, actions, sidebarOpen, onSidebarToggle, sidebarId, className = '',
}: WindowToolbarProps) {
  const toggleLabel = sidebarOpen ? 'Hide sidebar' : 'Show sidebar';
  return <div className={`shared-window-toolbar${className ? ` ${className}` : ''}`} data-sidebar-open={sidebarOpen}
    data-logo-present={logo != null}>
    <div className="shared-window-toolbar__identity">
      <div className="shared-window-toolbar__brand-group">
        {logo != null && <div className="shared-window-toolbar__logo">{logo}</div>}
        <div className="shared-window-toolbar__brand">{brand}</div>
      </div>
      <button type="button" className="shared-window-toolbar__toggle" onClick={onSidebarToggle}
        aria-label={toggleLabel} title={toggleLabel} aria-expanded={sidebarOpen} aria-controls={sidebarId}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
        </svg>
      </button>
    </div>
    <div className="shared-window-toolbar__title"><div className="shared-window-toolbar__title-content">{title}</div></div>
    {actions != null && <div className="shared-window-toolbar__actions">{actions}</div>}
  </div>;
}
