import type { ReactNode } from 'react';

export interface SidebarHeaderProps {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Full-width sidebar heading, sharing its height with navigation-rail controls. */
export function SidebarHeader({ children, actions, className = '' }: SidebarHeaderProps) {
  return <header className={`shared-sidebar-header${className ? ` ${className}` : ''}`}>
    <div className="shared-sidebar-header__content">{children}</div>
    {actions != null && <div className="shared-sidebar-header__actions">{actions}</div>}
  </header>;
}
