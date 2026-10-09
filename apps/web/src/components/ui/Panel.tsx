import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface PanelProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned action in the header — usually a `<PanelLink>` or a Button. */
  action?: ReactNode;
  /** Removes the body padding, for panels whose body is a full-bleed table. */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}

/** The white card everything on a page sits in. */
export function Panel({
  title,
  subtitle,
  action,
  flush = false,
  className,
  bodyClassName,
  children,
}: PanelProps) {
  const hasHeader = Boolean(title || subtitle || action);

  return (
    <section
      className={cn(
        'overflow-hidden rounded-panel border border-line bg-surface shadow-card',
        className,
      )}
    >
      {hasHeader && (
        <header className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-title font-heavy text-ink">{title}</h2>}
            {subtitle && <p className="mt-1 text-sub text-muted">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn(!flush && 'px-4 pb-4', hasHeader ? '' : !flush && 'pt-4', bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

export interface PanelLinkProps {
  onClick?: () => void;
  href?: string;
  children: ReactNode;
}

/** The small blue "Open portfolio →" affordance in a panel header. */
export function PanelLink({ onClick, href, children }: PanelLinkProps) {
  const className =
    'rounded text-micro font-heavy tracking-normal text-blue transition-colors hover:text-blue-2';

  if (href) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  );
}

/** A plain bordered card, lighter than a Panel — used inside panel bodies. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn('rounded-card border border-line bg-surface p-3.5 shadow-card-soft', className)}
    >
      {children}
    </div>
  );
}

/** The soft inset row used for lists inside panels. */
export function ListItem({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2.5 rounded-xl border border-line-soft bg-surface-2 p-2.5',
        className,
      )}
    >
      {children}
    </div>
  );
}
