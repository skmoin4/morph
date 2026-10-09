import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Status pill.
 *
 * The tone vocabulary is fixed by the brief, so a colour always means the same
 * thing across every screen:
 *   green  healthy / approved / paid
 *   blue   info / sent
 *   amber  pending / review
 *   red    risk / overdue / rejected
 *   gray   draft / inactive
 *   violet informational accent (project types)
 */
export type PillTone = 'green' | 'blue' | 'amber' | 'red' | 'gray' | 'violet';

const TONES: Record<PillTone, string> = {
  green: 'bg-pill-green-bg text-pill-green-fg',
  blue: 'bg-pill-blue-bg text-pill-blue-fg',
  amber: 'bg-pill-amber-bg text-pill-amber-fg',
  red: 'bg-pill-red-bg text-pill-red-fg',
  gray: 'bg-pill-gray-bg text-pill-gray-fg',
  violet: 'bg-pill-violet-bg text-pill-violet-fg',
};

export interface PillProps {
  tone?: PillTone;
  /** Shows the leading status dot. */
  dot?: boolean;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Pill({ tone = 'gray', dot = false, icon, className, children }: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1 text-pill font-heavy',
        TONES[tone],
        className,
      )}
    >
      {dot && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />}
      {icon && (
        <span aria-hidden className="[&>svg]:size-3">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}

/**
 * The single place that maps a domain status to a tone. Screens call this
 * rather than choosing colours themselves, so "approved" is never green in one
 * table and blue in another.
 */
const STATUS_TONES: Record<string, PillTone> = {
  // Lifecycle
  DRAFT: 'gray',
  CONFIRMED: 'blue',
  PROJECT_CREATED: 'green',
  CANCELLED: 'gray',

  // Projects
  ACTIVE: 'green',
  ON_HOLD: 'amber',
  COMPLETED: 'blue',
  HEALTHY: 'green',
  AT_RISK: 'amber',
  CRITICAL: 'red',

  // Tasks
  TODO: 'gray',
  IN_PROGRESS: 'blue',
  REVIEW: 'amber',
  DONE: 'green',

  // Approvals
  PENDING: 'amber',
  PENDING_MANAGER: 'amber',
  PENDING_FINANCE: 'amber',
  SUBMITTED: 'blue',
  APPROVED: 'green',
  REJECTED: 'red',
  REOPENED: 'amber',
  REIMBURSED: 'green',

  // Attendance
  PRESENT: 'green',
  LATE: 'amber',
  HALF_DAY: 'amber',
  ABSENT: 'red',
  ON_LEAVE: 'violet',
  HOLIDAY: 'blue',
  WEEKLY_OFF: 'gray',
  NOT_IN: 'gray',

  // People
  INVITED: 'blue',
  INACTIVE: 'gray',
  SUSPENDED: 'red',
  NOTICE_PERIOD: 'amber',
  EXITED: 'gray',
};

export function toneForStatus(status: string): PillTone {
  return STATUS_TONES[status] ?? 'gray';
}

/** Turns SCREAMING_SNAKE into "Screaming snake". */
export function humanizeStatus(status: string): string {
  const words = status.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface StatusPillProps {
  status: string;
  /** Override the generated label, e.g. "Email pending". */
  label?: string;
  dot?: boolean;
  className?: string;
}

export function StatusPill({ status, label, dot = true, className }: StatusPillProps) {
  return (
    <Pill tone={toneForStatus(status)} dot={dot} className={className}>
      {label ?? humanizeStatus(status)}
    </Pill>
  );
}
