import { Check } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface StepperStep {
  key: string;
  label: string;
  description?: string;
}

/**
 * The booking lifecycle stepper:
 * Booking → Confirmation → Project Code → Project Created → Scheduled.
 *
 * Shown on both the booking and the project pages, so the same five stages read
 * identically from either side of the handover.
 */
export const BOOKING_LIFECYCLE: StepperStep[] = [
  { key: 'BOOKING', label: 'Booking', description: 'Client, value and scope captured' },
  { key: 'CONFIRMATION', label: 'Confirmation', description: 'Email or verbal note attached' },
  { key: 'PROJECT_CODE', label: 'Project Code', description: 'Unique code generated' },
  {
    key: 'PROJECT_CREATED',
    label: 'Project Created',
    description: 'Carried over from the booking',
  },
  { key: 'SCHEDULED', label: 'Scheduled', description: 'Dates, team and tasks planned' },
];

export interface StepperProps {
  steps: StepperStep[];
  /** Index of the stage in progress. Everything before it reads as complete. */
  currentIndex: number;
  /** Renders the whole stepper in a muted, struck-through state. */
  cancelled?: boolean;
  className?: string;
}

export function Stepper({ steps, currentIndex, cancelled = false, className }: StepperProps) {
  return (
    <ol className={cn('grid gap-2 sm:grid-cols-2 lg:grid-cols-5', className)}>
      {steps.map((step, index) => {
        const complete = !cancelled && index < currentIndex;
        const current = !cancelled && index === currentIndex;

        return (
          <li
            key={step.key}
            aria-current={current ? 'step' : undefined}
            className={cn(
              'rounded-card border p-3 transition-colors',
              complete && 'border-pill-green-bg bg-pill-green-bg/50',
              current && 'border-blue-2/40 bg-pill-blue-bg/60',
              !complete && !current && 'border-line bg-surface-2',
              cancelled && 'opacity-60',
            )}
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  'grid size-5 shrink-0 place-items-center rounded-md text-[10px] font-black',
                  complete && 'bg-green text-white',
                  current && 'bg-blue text-white',
                  !complete && !current && 'bg-line text-muted',
                )}
              >
                {complete ? (
                  <Check className="size-3" strokeWidth={3} />
                ) : (
                  String(index + 1).padStart(2, '0')
                )}
              </span>
              <span
                className={cn(
                  'text-sub font-heavy',
                  cancelled && 'line-through',
                  complete || current ? 'text-ink' : 'text-muted',
                )}
              >
                {step.label}
              </span>
            </div>
            {step.description && (
              <p className="mt-1.5 pl-7 text-micro leading-relaxed tracking-normal text-muted">
                {step.description}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
