import { useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { addDays, dayOfWeek, startOfWeek } from '@opsvera/shared';
import { Button, IconButton } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField, TextField } from '../../components/ui/Field';
import { Panel } from '../../components/ui/Panel';
import { Skeleton } from '../../components/ui/Skeleton';
import { cn } from '../../lib/cn';
import { formatDisplayDate } from '../../lib/format';
import { useAttendanceLookups } from '../attendance/useAttendance';
import { useRoster, WEEKDAY_NAMES, type RosterCell } from './useShifts';

function Cell({ cell }: { cell: RosterCell }) {
  const base =
    'grid min-h-[44px] place-items-center rounded-lg px-1.5 py-1 text-center text-[11px] leading-tight';
  switch (cell.kind) {
    case 'NONE':
      return <div className={cn(base, 'text-muted-2')}>—</div>;
    case 'OFF':
      return <div className={cn(base, 'bg-pill-gray-bg font-heavy text-pill-gray-fg')}>Off</div>;
    case 'HOLIDAY':
      return (
        <div
          className={cn(base, 'bg-pill-blue-bg font-heavy text-pill-blue-fg')}
          title={cell.label}
        >
          <span>Holiday</span>
          <span className="max-w-[90px] truncate font-normal">{cell.label}</span>
        </div>
      );
    case 'LEAVE':
      return (
        <div className={cn(base, 'bg-pill-violet-bg font-heavy text-pill-violet-fg')}>Leave</div>
      );
    case 'SHIFT':
      return (
        <div
          className={cn(
            base,
            cell.shift
              ? 'bg-pill-green-bg text-pill-green-fg'
              : 'bg-pill-amber-bg text-pill-amber-fg',
          )}
          title={cell.shift ?? 'No shift assigned'}
        >
          {cell.shift ? (
            <>
              <span className="font-heavy tabular-nums">
                {cell.start}–{cell.end}
              </span>
              <span className="max-w-[90px] truncate">
                {cell.halfLeave ? `½ day leave` : cell.shift}
              </span>
            </>
          ) : (
            <span className="font-heavy">No shift</span>
          )}
        </div>
      );
  }
}

/** The week at a glance: who works what, and who is off, holiday or on leave. */
export function RosterTab() {
  const [weekOf, setWeekOf] = useState(() => startOfWeek(new Date().toISOString().slice(0, 10)));
  const [officeId, setOfficeId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useRoster({
    weekOf,
    officeId: officeId || undefined,
    departmentId: departmentId || undefined,
    q: q || undefined,
    page,
  });
  const { data: lookups } = useAttendanceLookups();

  const reset =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
    };
  const thisWeek = startOfWeek(new Date().toISOString().slice(0, 10));

  return (
    <Panel flush>
      <div className="flex flex-wrap items-end gap-2.5 border-b border-line px-4 py-3">
        <div className="flex items-end gap-1">
          <IconButton
            label="Previous week"
            variant="ghost"
            onClick={() => reset(setWeekOf)(addDays(weekOf, -7))}
          >
            <ChevronLeft />
          </IconButton>
          <div className="grid h-[38px] min-w-52 place-items-center rounded-control border border-line bg-surface px-3 text-body font-heavy text-ink">
            {formatDisplayDate(weekOf)} – {formatDisplayDate(addDays(weekOf, 6))}
          </div>
          <IconButton
            label="Next week"
            variant="ghost"
            onClick={() => reset(setWeekOf)(addDays(weekOf, 7))}
          >
            <ChevronRight />
          </IconButton>
          {weekOf !== thisWeek && (
            <Button variant="subtle" onClick={() => reset(setWeekOf)(thisWeek)}>
              This week
            </Button>
          )}
        </div>
        <TextField
          label="Search"
          srOnlyLabel
          containerClassName="min-w-[160px] flex-1"
          placeholder="Name or code…"
          leadingIcon={<Search />}
          value={q}
          onChange={(event) => reset(setQ)(event.target.value)}
        />
        {lookups && (
          <>
            <SelectField
              label="Office"
              srOnlyLabel
              placeholder="All offices"
              containerClassName="w-40"
              value={officeId}
              onChange={(event) => reset(setOfficeId)(event.target.value)}
              options={lookups.offices.map((o) => ({ value: o.id, label: o.name }))}
            />
            <SelectField
              label="Department"
              srOnlyLabel
              placeholder="All departments"
              containerClassName="w-44"
              value={departmentId}
              onChange={(event) => reset(setDepartmentId)(event.target.value)}
              options={lookups.departments.map((d) => ({ value: d.id, label: d.name }))}
            />
          </>
        )}
      </div>

      {isLoading || !data ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : data.data.length === 0 ? (
        <div className="px-4 py-10">
          <EmptyState
            title="No one on the roster"
            description="Nobody in your view matches these filters for that week."
          />
        </div>
      ) : (
        <div className="scroll-slim overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 w-[210px] bg-surface px-3 py-2 text-left text-micro font-heavy uppercase text-[#7d8a9f]"
                >
                  Employee
                </th>
                {data.days.map((date) => (
                  <th
                    key={date}
                    scope="col"
                    className="px-1 py-2 text-center text-micro font-heavy uppercase text-[#7d8a9f]"
                  >
                    {WEEKDAY_NAMES[dayOfWeek(date)]}
                    <span className="block text-ink-2">{Number(date.slice(8))}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.data.map((row) => (
                <tr key={row.employeeId} className="border-t border-line-soft">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-surface px-3 py-1.5 text-left font-normal"
                  >
                    <span className="block max-w-[190px] truncate text-body font-heavy text-ink">
                      {row.fullName}
                    </span>
                    <span className="block text-micro tracking-normal text-muted">
                      {row.employeeCode} · {row.office}
                      {row.department ? ` · ${row.department}` : ''}
                    </span>
                  </th>
                  {row.days.map((cell) => (
                    <td key={cell.date} className="p-1 align-middle">
                      <Cell cell={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.meta.totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
          <p className="text-sub text-muted">
            Page {data.meta.page} of {data.meta.totalPages} · {data.meta.total} people
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={page >= data.meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
