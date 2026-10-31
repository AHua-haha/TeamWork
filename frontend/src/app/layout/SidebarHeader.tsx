import type { ReactNode } from 'react';

export interface SidebarHeaderProps {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Full-width sidebar heading, sharing its height with navigation-rail controls. */
export function SidebarHeader({ children, actions, className = '' }: SidebarHeaderProps) {
  return <header className={`local-sidebar-header${className ? ` ${className}` : ''}`}>
    <div className="local-sidebar-header__content">{children}</div>
    {actions != null && <div className="local-sidebar-header__actions">{actions}</div>}
  </header>;
}
