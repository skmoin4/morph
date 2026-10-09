import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface PageHeaderProps {
  /** The small blue uppercase line above the title. */
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned controls: filters, then the primary action. */
  actions?: ReactNode;
  className?: string;
}

/** The page header pattern used on every screen. */
export function PageHeader({ eyebrow, title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="text-micro font-heavy uppercase text-blue">{eyebrow}</p>}
        <h1 className="mt-1 text-display font-black text-ink">{title}</h1>
        {subtitle && <p className="mt-1.5 text-body text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
