import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** App supplies the mounted window-bar slot; feature controls retain their own state. */
export const WindowToolbarTarget = createContext<HTMLElement | null>(null);

export function WindowToolbar({ title, children }: { title: string; children?: ReactNode }) {
  const target = useContext(WindowToolbarTarget);
  if (!target) return null;
  return createPortal(<>
    <h1 className="window-toolbar-title">{title}</h1>
    {children && <div className="window-toolbar-actions">{children}</div>}
  </>, target);
}
