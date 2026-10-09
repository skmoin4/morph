import { cn } from '../../lib/cn';

/** A loading placeholder. Always `aria-hidden` — screen readers get a live region instead. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded bg-line', className)} />;
}

/**
 * Announces a loading state once, for assistive technology, while the visible
 * skeletons do the work for sighted users.
 */
export function LoadingAnnouncer({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {label}
    </span>
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}
