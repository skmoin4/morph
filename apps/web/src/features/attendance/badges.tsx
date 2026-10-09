import { AlertTriangle, PenLine } from 'lucide-react';
import { Pill, StatusPill } from '../../components/ui/Pill';
import { cn } from '../../lib/cn';
import { STATUS_LABEL, type DayStatus } from './useAttendance';

export function AttendancePill({ status }: { status: DayStatus }) {
  return <StatusPill status={status} label={STATUS_LABEL[status]} />;
}

export function FlagPill({ reason }: { reason?: string | null }) {
  return (
    <span title={reason ?? 'Needs a look'}>
      <Pill tone="amber" icon={<AlertTriangle />}>
        Flagged
      </Pill>
    </span>
  );
}

export function RegularisedPill() {
  return (
    <Pill tone="blue" icon={<PenLine />}>
      Corrected
    </Pill>
  );
}

/** One-letter codes and colours for the register grid. */
export const CELL_STYLE: Record<DayStatus, { code: string; className: string }> = {
  PRESENT: { code: 'P', className: 'bg-pill-green-bg text-pill-green-fg' },
  LATE: { code: 'L', className: 'bg-pill-amber-bg text-pill-amber-fg' },
  HALF_DAY: { code: 'H', className: 'bg-pill-amber-bg text-pill-amber-fg' },
  ABSENT: { code: 'A', className: 'bg-pill-red-bg text-pill-red-fg' },
  ON_LEAVE: { code: 'LV', className: 'bg-pill-violet-bg text-pill-violet-fg' },
  HOLIDAY: { code: 'HO', className: 'bg-pill-blue-bg text-pill-blue-fg' },
  WEEKLY_OFF: { code: 'WO', className: 'bg-pill-gray-bg text-pill-gray-fg' },
  NOT_IN: { code: '·', className: 'bg-surface-2 text-muted' },
};

export function StatusLegend({ className }: { className?: string }) {
  return (
    <ul
      className={cn(
        'flex flex-wrap gap-x-4 gap-y-1.5 text-micro tracking-normal text-muted',
        className,
      )}
    >
      {(Object.keys(CELL_STYLE) as DayStatus[])
        .filter((s) => s !== 'NOT_IN')
        .map((status) => (
          <li key={status} className="flex items-center gap-1.5">
            <span
              className={cn(
                'grid h-5 min-w-5 place-items-center rounded px-1 text-[10px] font-black',
                CELL_STYLE[status].className,
              )}
            >
              {CELL_STYLE[status].code}
            </span>
            {STATUS_LABEL[status]}
          </li>
        ))}
    </ul>
  );
}
