import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  /** One line saying what this is and why it is empty. */
  description?: string;
  /** The clear next action. Every empty state should offer one where it can. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('mx-auto max-w-sm py-6 text-center', className)}>
      <div
        aria-hidden
        className="mx-auto grid size-11 place-items-center rounded-card bg-surface-2 text-muted-2 [&>svg]:size-5"
      >
        {icon ?? <Inbox />}
      </div>
      <h3 className="mt-3 text-title font-heavy text-ink">{title}</h3>
      {description && <p className="mt-1.5 text-sub text-muted">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
