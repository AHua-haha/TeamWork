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
    className={`local-navigation-rail-button${className ? ` ${className}` : ''}`}>
    <span className="local-navigation-rail-button__icon" aria-hidden="true">{icon}</span>
  </button>;
}
