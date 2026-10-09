import { cn } from '../../lib/cn';

export interface ProgressProps {
  /** 0–100. Values above 100 clamp the bar but keep the label honest. */
  value: number;
  /** Switches the fill to the amber/orange gradient. */
  risk?: boolean;
  label?: string;
  className?: string;
}

export function Progress({ value, risk = false, label, className }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn('h-1.5 min-w-[78px] overflow-hidden rounded-full bg-track', className)}
    >
      <span
        className={cn(
          'block h-full rounded-full transition-[width] duration-500',
          risk ? 'bg-progress-risk' : 'bg-progress-fill',
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export interface ProgressWithLabelProps extends ProgressProps {
  caption?: string;
}

/** Bar plus the "69% consumed" caption, as the portfolio table shows it. */
export function ProgressWithLabel({ caption, ...props }: ProgressWithLabelProps) {
  return (
    <div className="min-w-[90px]">
      <Progress {...props} />
      {caption && <p className="mt-1 text-micro tracking-normal text-muted">{caption}</p>}
    </div>
  );
}
