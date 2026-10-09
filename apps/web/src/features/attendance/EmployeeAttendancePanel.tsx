import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MetricCard, MetricRow } from '../../components/ui/MetricCard';
import { Panel } from '../../components/ui/Panel';
import { Skeleton } from '../../components/ui/Skeleton';
import { formatDisplayDate } from '../../lib/format';
import { AttendancePill, CELL_STYLE, FlagPill, StatusLegend } from './badges';
import { DayDrawer } from './DayDrawer';
import { cn } from '../../lib/cn';
import { formatMinutes, timeIn, useEmployeeRange } from './useAttendance';

function monthBounds(): { from: string; to: string; label: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const from = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  return {
    from,
    to,
    label: now.toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

/** This month's attendance for one person: the totals, a strip of days, and the recent ones. */
export function EmployeeAttendancePanel({
  employeeId,
  timeZone,
}: {
  employeeId: string;
  timeZone: string;
}) {
  const { from, to, label } = monthBounds();
  const { data, isLoading } = useEmployeeRange(employeeId, from, to);
  const [openDate, setOpenDate] = useState<string | null>(null);

  if (isLoading || !data) {
    return (
      <Panel title="Attendance">
        <Skeleton className="h-32 w-full" />
      </Panel>
    );
  }

  const { totals, days } = data;
  const recent = [...days].reverse().slice(0, 10);

  return (
    <div className="space-y-5">
      <MetricRow>
        <MetricCard
          label="Present"
          value={totals.present + totals.late}
          foot={`${totals.late} of them late`}
          state="good"
        />
        <MetricCard label="Half days" value={totals.halfDay} />
        <MetricCard
          label="Absent"
          value={totals.absent}
          state={totals.absent ? 'bad' : 'neutral'}
        />
        <MetricCard label="On leave" value={totals.onLeave} />
        <MetricCard label="Overtime" value={formatMinutes(totals.overtimeMinutes)} />
      </MetricRow>

      <Panel
        title={`${label}`}
        subtitle="Each square is a day; click one for the punches behind it."
        action={
          <Link
            to="/attendance?tab=register"
            className="text-micro font-heavy tracking-normal text-blue hover:text-blue-2"
          >
            Open the register →
          </Link>
        }
      >
        <div className="flex flex-wrap gap-1">
          {days.map((day) => (
            <button
              key={day.date}
              type="button"
              title={`${formatDisplayDate(day.date)} · ${day.status.replace('_', ' ').toLowerCase()}`}
              aria-label={`${formatDisplayDate(day.date)}: ${day.status}`}
              onClick={() => setOpenDate(day.date)}
              className={cn(
                'grid h-8 w-8 place-items-center rounded text-[10px] font-black transition-transform hover:scale-110',
                CELL_STYLE[day.status].className,
                !day.final && 'opacity-70',
              )}
            >
              {Number(day.date.slice(8))}
            </button>
          ))}
        </div>
        <StatusLegend className="mt-4" />
      </Panel>

      <Panel title="Recent days">
        {recent.length === 0 ? (
          <p className="text-sub text-muted">No attendance recorded yet this month.</p>
        ) : (
          <ul className="space-y-2">
            {recent.map((day) => (
              <li key={day.date}>
                <button
                  type="button"
                  onClick={() => setOpenDate(day.date)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-line-soft bg-surface-2 p-3 text-left transition-colors hover:bg-line-soft"
                >
                  <span className="flex items-center gap-2.5">
                    <span className="w-24 text-body font-heavy text-ink">
                      {formatDisplayDate(day.date)}
                    </span>
                    <AttendancePill status={day.status} />
                    {day.flagged && <FlagPill reason={day.flagReason} />}
                  </span>
                  <span className="text-sub tabular-nums text-muted">
                    {timeIn(day.firstInAt, timeZone)} – {timeIn(day.lastOutAt, timeZone)}
                    {day.firstInAt && ` · ${formatMinutes(day.workedMinutes)}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {openDate && (
        <DayDrawer employeeId={employeeId} date={openDate} onClose={() => setOpenDate(null)} />
      )}
    </div>
  );
}
