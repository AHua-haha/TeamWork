import type { CSSProperties, ReactNode } from 'react';

export interface ThreadColumnProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** Centers the content width and reserves separate space for adjacent avatars. */
export function ThreadColumn({ children, className = '', style }: ThreadColumnProps) {
  return <div className={`local-thread-column${className ? ` ${className}` : ''}`} style={style}>
    <div className="local-thread-column__content">{children}</div>
  </div>;
}

export interface ThreadRowProps {
  children: ReactNode;
  /** Positioned in the leading gutter, outside the content-width budget. */
  avatar?: ReactNode;
  className?: string;
}

/** A presentation row; the caller supplies message content and avatar semantics. */
export function ThreadRow({ children, avatar, className = '' }: ThreadRowProps) {
  return <div className={`local-thread-row${avatar != null ? ' local-thread-row--with-avatar' : ''}${className ? ` ${className}` : ''}`}>
    {avatar != null && <div className="local-thread-row__avatar">{avatar}</div>}
    <div className="local-thread-row__content">{children}</div>
  </div>;
}
