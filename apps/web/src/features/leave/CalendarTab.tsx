import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, dayOfWeek } from '@opsvera/shared';
import { IconButton } from '../../components/ui/Button';
import { SelectField } from '../../components/ui/Field';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { useAttendanceLookups } from '../attendance/useAttendance';
import { DAY_PART_LABEL, formatDays, toneForType, useLeaveCalendar } from './useLeave';

const TONE_CLASS: Record<string, string> = {
  green: 'bg-pill-green-bg text-pill-green-fg',
  blue: 'bg-pill-blue-bg text-pill-blue-fg',
  amber: 'bg-pill-amber-bg text-pill-amber-fg',
  red: 'bg-pill-red-bg text-pill-red-fg',
  gray: 'bg-pill-gray-bg text-pill-gray-fg',
  violet: 'bg-pill-violet-bg text-pill-violet-fg',
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_CHIPS = 3;

function monthGrid(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  // Weeks start Monday, like timesheets.
  const lead = (dayOfWeek(first) + 6) % 7;
  const start = addDays(first, -lead);
  const trail = 6 - ((dayOfWeek(last) + 6) % 7);
  const end = addDays(last, trail);
  const days: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return { first, last, start, end, days };
}

/** Who is off when, for the people you can see. */
export function CalendarTab() {
  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getUTCFullYear(), month: now.getUTCMonth() });
  const [officeId, setOfficeId] = useState('');
  const { data: lookups } = useAttendanceLookups();

  const grid = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const { data } = useLeaveCalendar({
    from: grid.start,
    to: grid.end,
    officeId: officeId || undefined,
  });
  const today = now.toISOString().slice(0, 10);

  const step = (delta: number) =>
    setCursor((c) => {
      const d = new Date(Date.UTC(c.year, c.month + delta, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    });

  const label = new Date(Date.UTC(cursor.year, cursor.month, 1)).toLocaleString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  // A holiday set up once per office comes back once per office; show it once.
  const holidayList = useMemo(() => {
    const seen = new Set<string>();
    return (data?.holidays ?? []).filter((h) => {
      const key = `${h.date}|${h.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [data?.holidays]);

  const onDay = (day: string) => ({
    leaves: (data?.leaves ?? []).filter((l) => l.fromDate <= day && l.toDate >= day),
    holidays: holidayList.filter((h) => h.date === day),
  });

  return (
    <Panel
      flush
      title={label}
      subtitle="Approved leave is solid; waiting requests are dashed."
      action={
        <div className="flex items-center gap-2">
          {lookups && lookups.offices.length > 1 && (
            <SelectField
              label="Office"
              srOnlyLabel
              containerClassName="w-40"
              value={officeId}
              onChange={(event) => setOfficeId(event.target.value)}
              options={[
                { value: '', label: 'All offices' },
                ...lookups.offices.map((o) => ({ value: o.id, label: o.name })),
              ]}
            />
          )}
          <IconButton label="Previous month" onClick={() => step(-1)}>
            <ChevronLeft />
          </IconButton>
          <IconButton label="Next month" onClick={() => step(1)}>
            <ChevronRight />
          </IconButton>
        </div>
      }
      bodyClassName="mt-1"
    >
      <div className="overflow-x-auto border-t border-line">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-7 border-b border-line bg-surface-2">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2.5 py-2 text-micro font-heavy uppercase text-muted">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {grid.days.map((day) => {
              const inMonth = day >= grid.first && day <= grid.last;
              const { leaves, holidays } = onDay(day);
              const shown = leaves.slice(0, MAX_CHIPS);
              const more = leaves.length - shown.length;
              return (
                <div
                  key={day}
                  className={cn(
                    'min-h-[104px] border-b border-r border-line p-1.5',
                    !inMonth && 'bg-surface-2/60',
                    day === today && 'bg-blue/5',
                  )}
                >
                  <p
                    className={cn(
                      'mb-1 text-sub tabular-nums',
                      inMonth ? 'text-ink-2' : 'text-muted-2',
                      day === today && 'font-black text-blue',
                    )}
                  >
                    {Number(day.slice(8))}
                  </p>
                  {holidays.map((h) => (
                    <p
                      key={h.id}
                      className="mb-1 truncate rounded bg-pill-blue-bg px-1.5 py-0.5 text-micro font-heavy text-pill-blue-fg"
                      title={h.name}
                    >
                      {h.name}
                    </p>
                  ))}
                  <ul className="space-y-1">
                    {shown.map((l) => (
                      <li
                        key={l.id}
                        title={`${l.employee.fullName} · ${l.leaveType.name} · ${formatDays(l.totalDays)}${l.dayPart !== 'FULL_DAY' ? ` · ${DAY_PART_LABEL[l.dayPart]}` : ''}${l.status === 'PENDING' ? ' · waiting' : ''}`}
                        className={cn(
                          'truncate rounded px-1.5 py-0.5 text-micro font-heavy',
                          TONE_CLASS[toneForType(l.leaveType.colorToken)],
                          l.status === 'PENDING' &&
                            'border border-dashed border-current bg-transparent',
                        )}
                      >
                        {l.employee.fullName.split(' ')[0]} · {l.leaveType.shortCode}
                        {l.dayPart !== 'FULL_DAY' ? ' ½' : ''}
                      </li>
                    ))}
                    {more > 0 && (
                      <li
                        className="px-1.5 text-micro text-muted"
                        title={leaves
                          .slice(MAX_CHIPS)
                          .map((l) => l.employee.fullName)
                          .join(', ')}
                      >
                        +{more} more
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Panel>
  );
}
