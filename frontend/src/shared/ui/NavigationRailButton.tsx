import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface NavigationRailButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label' | 'aria-current'> {
  icon: ReactNode;
  label: string;
  active?: boolean;
}

/** Icon-only navigation control; the consumer owns selection and navigation. */
export function NavigationRailButton({
  icon, label, active = false, className = '', type = 'button', title = label, ...buttonProps
}: NavigationRailButtonProps) {
  return <button {...buttonProps} type={type} title={title} aria-label={label}
    aria-current={active ? 'page' : undefined}
    className={`shared-navigation-rail-button tw:box-border tw:inline-flex tw:h-[var(--shared-sidebar-header-height,48px)] tw:min-h-[var(--shared-sidebar-header-height,48px)] tw:w-[min(100%,var(--shared-sidebar-header-height,48px))] tw:flex-[0_0_var(--shared-sidebar-header-height,48px)] tw:cursor-pointer tw:items-center tw:justify-center tw:border-0 tw:bg-transparent tw:p-0 tw:[font:inherit] tw:text-inherit tw:focus-visible:outline-2 tw:focus-visible:outline-current tw:focus-visible:-outline-offset-3 tw:disabled:cursor-default tw:[&:not(:disabled):not([aria-current=page]):is(:hover,:focus-visible)]:bg-[var(--shared-sidebar-hover,#eef1f4)] ${className}`}>
    <span className="shared-navigation-rail-button__icon tw:inline-flex tw:size-[var(--shared-navigation-icon-size,20px)] tw:items-center tw:justify-center tw:text-[length:var(--shared-navigation-icon-size,20px)] tw:leading-none tw:[&>svg]:size-full" aria-hidden="true">{icon}</span>
  </button>;
}
