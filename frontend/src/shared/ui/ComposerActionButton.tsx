import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';

export interface ComposerActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Changes the icon only; the consumer owns send/stop behavior. */
  running?: boolean;
}

/** One stable circular action, with an accessible label for its current action. */
export const ComposerActionButton = forwardRef<HTMLButtonElement, ComposerActionButtonProps>(function ComposerActionButton({
  running = false, className = '', type = 'button',
  'aria-label': label = running ? 'Stop response' : 'Send message', title = label, ...props
}, ref) {
  return <button {...props} ref={ref} type={type} aria-label={label} title={title} data-running={running}
    className={`tw:box-border tw:inline-flex tw:size-[calc(var(--composer-action-row-height,var(--shared-sidebar-item-height,32px))-4px)] tw:min-h-[calc(var(--composer-action-row-height,var(--shared-sidebar-item-height,32px))-4px)] tw:min-w-[calc(var(--composer-action-row-height,var(--shared-sidebar-item-height,32px))-4px)] tw:text-[14px] tw:leading-[1.65] tw:flex-none tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-full tw:border-0 tw:bg-[#2d7548] tw:p-0 tw:text-white tw:hover:bg-[#23643c] tw:focus-visible:outline-2 tw:focus-visible:outline-ui-focus tw:focus-visible:outline-offset-2 tw:disabled:cursor-default tw:disabled:opacity-50 ${className}`}>
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {running
        ? <><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" /></>
        : <path d="M12 19V5m-6 6 6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  </button>;
});
