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
  return <section className={`shared-sidebar-section tw:flex tw:min-w-0 tw:flex-col tw:gap-[var(--shared-sidebar-item-gap,4px)] ${isOpen ? 'is-open' : 'is-closed'} ${className}`}>
    <h2 className="shared-sidebar-section__heading tw:m-0 tw:[font:inherit]">
      <button type="button" data-slot="sidebar-toggle" className="shared-sidebar-section__toggle tw:group tw:box-border tw:flex tw:h-[var(--shared-sidebar-item-height,32px)] tw:min-h-0 tw:w-full tw:cursor-pointer tw:items-center tw:justify-start tw:gap-1 tw:rounded-lg tw:border-0 tw:bg-transparent tw:px-2 tw:py-0 tw:text-start tw:[font:inherit] tw:text-inherit tw:hover:bg-[var(--shared-sidebar-hover,#eef1f4)] tw:focus-visible:bg-[var(--shared-sidebar-hover,#eef1f4)] tw:focus-visible:outline-2 tw:focus-visible:outline-current tw:focus-visible:-outline-offset-2" aria-expanded={isOpen} aria-controls={panelId} onClick={toggle}>
        <span className="shared-sidebar-section__title tw:min-w-0 tw:truncate">{title}</span>
        <span className="shared-sidebar-section__chevron tw:inline-grid tw:size-4 tw:flex-none tw:place-items-center tw:text-[#69727c] tw:leading-none tw:group-aria-[expanded=false]:-rotate-90" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg></span>
      </button>
    </h2>
    <div id={panelId} className="shared-sidebar-section__body tw:min-w-0 tw:[&[hidden]]:hidden" hidden={!isOpen}>{children}</div>
  </section>;
}
