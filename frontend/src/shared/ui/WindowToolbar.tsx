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
  return <div className={`shared-window-toolbar tw:box-border tw:grid tw:h-full tw:w-full tw:min-w-0 tw:flex-auto tw:grid-cols-[minmax(max-content,calc(var(--shared-toolbar-rail-space)+var(--shared-toolbar-sidebar-space)))_minmax(0,1fr)_auto] tw:items-center tw:transition-[grid-template-columns] tw:duration-[var(--shared-sidebar-transition-duration,200ms)] tw:ease-[var(--shared-sidebar-transition-easing,ease)] tw:[--shared-toolbar-rail-space:var(--shared-visible-rail-width,var(--shared-rail-width,56px))] tw:[--shared-toolbar-sidebar-space:var(--shared-visible-sidebar-width,var(--shared-sidebar-width,264px))] tw:data-[sidebar-open=false]:[--shared-toolbar-sidebar-space:0px] tw:motion-reduce:duration-0 ${className}`} data-sidebar-open={sidebarOpen}
    data-logo-present={logo != null}>
    <div data-slot="toolbar-identity" className="shared-window-toolbar__identity tw:box-border tw:col-start-1 tw:flex tw:h-full tw:min-w-0 tw:items-center tw:gap-[var(--shared-toolbar-brand-toggle-gap,8px)] tw:ps-3 tw:pe-0">
      <div className="shared-window-toolbar__brand-group tw:flex tw:min-w-0 tw:flex-none tw:items-center tw:gap-2 tw:overflow-hidden">
        {logo != null && <div className="shared-window-toolbar__logo tw:grid tw:size-6 tw:flex-[0_0_24px] tw:place-items-center tw:[&>*]:max-h-full tw:[&>*]:max-w-full">{logo}</div>}
        <div className="shared-window-toolbar__brand tw:flex tw:min-w-0 tw:flex-auto tw:items-center tw:gap-2 tw:overflow-hidden">{brand}</div>
      </div>
      <button type="button" className="shared-window-toolbar__toggle tw:box-border tw:inline-flex tw:size-8 tw:flex-none tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-lg tw:border-0 tw:bg-transparent tw:p-0 tw:text-inherit tw:hover:bg-[var(--shared-sidebar-hover,#eef1f4)] tw:focus-visible:outline-2 tw:focus-visible:outline-current tw:focus-visible:-outline-offset-2" onClick={onSidebarToggle}
        aria-label={toggleLabel} title={toggleLabel} aria-expanded={sidebarOpen} aria-controls={sidebarId}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
        </svg>
      </button>
    </div>
    <div data-slot="toolbar-title" className="shared-window-toolbar__title tw:box-border tw:col-start-2 tw:flex tw:h-full tw:min-w-0 tw:items-center tw:ps-[var(--shared-toolbar-brand-toggle-gap,8px)] tw:pe-3"><div className="shared-window-toolbar__title-content tw:min-w-0 tw:truncate">{title}</div></div>
    {actions != null && <div data-slot="toolbar-actions" className="shared-window-toolbar__actions tw:box-border tw:col-start-3 tw:flex tw:h-full tw:min-w-0 tw:items-center tw:justify-end tw:gap-2 tw:px-3">{actions}</div>}
  </div>;
}
