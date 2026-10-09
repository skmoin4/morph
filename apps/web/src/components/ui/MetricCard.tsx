import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '../../lib/cn';

/** Colours the big number: good / warn / bad, or neutral ink. */
export type MetricState = 'neutral' | 'good' | 'warn' | 'bad';

const STATE_TEXT: Record<MetricState, string> = {
  neutral: 'text-ink',
  good: 'text-green',
  warn: 'text-amber',
  bad: 'text-red',
};

export interface MetricCardProps {
  label: string;
  value: ReactNode;
  /** The small line under the value, e.g. "4 confirmed bookings". */
  foot?: ReactNode;
  state?: MetricState;
  /** Percentage or point movement; sign drives the arrow and colour. */
  delta?: { value: string; direction: 'up' | 'down'; isGood?: boolean };
  loading?: boolean;
  onClick?: () => void;
  className?: string;
}

export function MetricCard({
  label,
  value,
  foot,
  state = 'neutral',
  delta,
  loading = false,
  onClick,
  className,
}: MetricCardProps) {
  if (loading) return <MetricCardSkeleton className={className} />;

  const body = (
    <>
      <p className="truncate text-micro font-heavy uppercase text-muted" title={label}>
        {label}
      </p>
      <p className={cn('mt-2 truncate text-metric font-black', STATE_TEXT[state])}>{value}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {delta && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-micro font-heavy tracking-normal',
              // "Down" is not automatically bad — falling cost is good.
              (delta.isGood ?? delta.direction === 'up') ? 'text-green' : 'text-red',
            )}
          >
            {delta.direction === 'up' ? (
              <ArrowUp aria-hidden className="size-3" />
            ) : (
              <ArrowDown aria-hidden className="size-3" />
            )}
            {delta.value}
          </span>
        )}
        {foot && <span className="truncate text-sub text-muted">{foot}</span>}
      </div>
    </>
  );

  const classes = cn(
    'min-w-0 rounded-card border border-line bg-surface p-3.5 text-left shadow-card-soft',
    onClick &&
      'cursor-pointer transition-[transform,box-shadow] duration-150 hover:-translate-y-px hover:shadow-card',
    className,
  );

  return onClick ? (
    <button type="button" onClick={onClick} className={classes}>
      {body}
    </button>
  ) : (
    <div className={classes}>{body}</div>
  );
}

export function MetricCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('rounded-card border border-line bg-surface p-3.5 shadow-card-soft', className)}
    >
      <div className="h-3 w-20 animate-pulse rounded bg-line" />
      <div className="mt-3 h-7 w-24 animate-pulse rounded bg-line" />
      <div className="mt-2 h-3 w-28 animate-pulse rounded bg-line-soft" />
    </div>
  );
}

/** The six-across KPI row from the prototype; wraps down on smaller screens. */
export function MetricRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3',
        'sm:grid-cols-[repeat(3,minmax(0,1fr))] xl:grid-cols-[repeat(6,minmax(0,1fr))]',
        className,
      )}
    >
      {children}
    </div>
  );
}
