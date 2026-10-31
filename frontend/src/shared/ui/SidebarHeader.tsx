import type { ReactNode } from 'react';

export interface SidebarHeaderProps {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Full-width sidebar heading, sharing its height with navigation-rail controls. */
export function SidebarHeader({ children, actions, className = '' }: SidebarHeaderProps) {
  return <header className={`shared-sidebar-header tw:box-border tw:flex tw:h-[var(--shared-sidebar-header-height,48px)] tw:min-h-[var(--shared-sidebar-header-height,48px)] tw:w-full tw:min-w-0 tw:flex-[0_0_var(--shared-sidebar-header-height,48px)] tw:items-center tw:gap-3 tw:px-4 ${className}`}>
    <div className="shared-sidebar-header__content tw:min-w-0 tw:flex-auto tw:truncate">{children}</div>
    {actions != null && <div className="shared-sidebar-header__actions tw:flex tw:flex-none tw:items-center tw:gap-2">{actions}</div>}
  </header>;
}
