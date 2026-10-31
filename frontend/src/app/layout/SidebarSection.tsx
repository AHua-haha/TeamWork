import type { ReactNode } from 'react';
import { useId, useState } from 'react';

export interface SidebarSectionProps {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/** Collapsible sidebar section; data loading and persistence remain feature-owned. */
export function SidebarSection({
  title, children, defaultOpen = true, open, onOpenChange, className = '',
}: SidebarSectionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const controlled = open !== undefined;
  const isOpen = controlled ? open : internalOpen;
  const panelId = useId();
  const toggle = () => {
    const next = !isOpen;
    if (!controlled) setInternalOpen(next);
    onOpenChange?.(next);
  };
  return <section className={`local-sidebar-section${isOpen ? ' is-open' : ' is-closed'}${className ? ` ${className}` : ''}`}>
    <h2 className="local-sidebar-section__heading">
      <button type="button" className="local-sidebar-section__toggle" aria-expanded={isOpen} aria-controls={panelId} onClick={toggle}>
        <span className="local-sidebar-section__title">{title}</span>
        <span className="local-sidebar-section__chevron" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg></span>
      </button>
    </h2>
    <div id={panelId} className="local-sidebar-section__body" hidden={!isOpen}>{children}</div>
  </section>;
}
