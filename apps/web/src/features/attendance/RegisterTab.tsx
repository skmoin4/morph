import { useState } from 'react';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { dayOfWeek } from '@opsvera/shared';
import { Button, IconButton } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField, TextField } from '../../components/ui/Field';
import { Panel } from '../../components/ui/Panel';
import { Skeleton } from '../../components/ui/Skeleton';
import { api, ApiRequestError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useAuth } from '../../providers/AuthProvider';
import { CELL_STYLE, StatusLegend } from './badges';
import { DayDrawer } from './DayDrawer';
import {
  STATUS_LABEL,
  timeIn,
  useAttendanceLookups,
  useRegister,
  type RegisterCell,
  type RegisterRow,
} from './useAttendance';

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function cellTitle(row: RegisterRow, cell: RegisterCell): string {
  if (!cell.status) return '';
  const parts = [STATUS_LABEL[cell.status]];
  if (cell.firstInAt) parts.push(`in ${timeIn(cell.firstInAt, row.office.timezone)}`);
  if (cell.lastOutAt) parts.push(`out ${timeIn(cell.lastOutAt, row.office.timezone)}`);
  if (cell.isLate) parts.push('late');
  if (cell.flagged) parts.push('flagged');
  if (cell.regularised) parts.push('corrected');
  return parts.join(' · ');
}

/** The month at a glance: one row per person, one square per day. */
export function RegisterTab() {
  const { can } = useAuth();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [officeId, setOfficeId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<{ employeeId: string; date: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  const filters = {
    month,
    officeId: officeId || undefined,
    departmentId: departmentId || undefined,
    q: q || undefined,
    page,
  };
  const { data, isLoading } = useRegister(filters);
  const { data: lookups } = useAttendanceLookups();

  const [y, m] = month.split('-').map(Number);

  async function exportSheet() {
    setExporting(true);
    try {
      const query = new URLSearchParams(
        Object.entries({ month, officeId, departmentId, q }).filter(([, v]) => v) as [
          string,
          string,
        ][],
      );
      await api.download(`/attendance/export?${query}`, `attendance-${month}.xlsx`);
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not build the export.');
    } finally {
      setExporting(false);
    }
  }

  const reset =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
    };

  return (
    <div className="space-y-4">
      <Panel flush>
        <div className="flex flex-wrap items-end gap-2.5 border-b border-line px-4 py-3">
          <div className="flex items-end gap-1">
            <IconButton
              label="Previous month"
              variant="ghost"
              onClick={() => reset(setMonth)(shiftMonth(month, -1))}
            >
              <ChevronLeft />
            </IconButton>
            <div className="grid h-[38px] w-40 place-items-center rounded-control border border-line bg-surface text-body font-heavy text-ink">
              {MONTH_NAMES[m - 1]} {y}
            </div>
            <IconButton
              label="Next month"
              variant="ghost"
              onClick={() => reset(setMonth)(shiftMonth(month, 1))}
            >
              <ChevronRight />
            </IconButton>
          </div>
          <TextField
            label="Search"
            srOnlyLabel
            containerClassName="min-w-[180px] flex-1"
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
          {can('attendance.export') && (
            <Button
              variant="ghost"
              leadingIcon={<Download />}
              loading={exporting}
              onClick={exportSheet}
            >
              Export
            </Button>
          )}
        </div>

        {isLoading || !data ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : data.data.length === 0 ? (
          <div className="px-4 py-10">
            <EmptyState
              title="No one to show"
              description="Nobody in your view matches these filters for that month."
            />
          </div>
        ) : (
          <div className="scroll-slim overflow-x-auto">
            <table className="border-collapse text-sub">
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky left-0 z-10 min-w-[190px] bg-surface px-3 py-2 text-left text-micro font-heavy uppercase text-[#7d8a9f]"
                  >
                    Employee
                  </th>
                  {data.days.map((date) => {
                    const dow = dayOfWeek(date);
                    return (
                      <th
                        key={date}
                        scope="col"
                        className={cn(
                          'w-8 min-w-8 px-0.5 py-1 text-center text-[10px] font-heavy text-[#7d8a9f]',
                          (dow === 0 || dow === 6) && 'bg-surface-2',
                        )}
                      >
                        <span className="block">{WEEKDAY[dow]}</span>
                        <span className="block text-ink-2">{Number(date.slice(8))}</span>
                      </th>
                    );
                  })}
                  {['P', 'L', 'H', 'A', 'LV', 'OT h', 'Credit'].map((label) => (
                    <th
                      key={label}
                      scope="col"
                      className="whitespace-nowrap px-2 py-2 text-center text-micro font-heavy uppercase text-[#7d8a9f]"
                    >
                      {label}
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
                      <span className="block max-w-[170px] truncate text-body font-heavy text-ink">
                        {row.fullName}
                      </span>
                      <span className="block text-micro tracking-normal text-muted">
                        {row.employeeCode} · {row.office.shortCode}
                      </span>
                    </th>
                    {row.days.map((cell) => {
                      const style = cell.status ? CELL_STYLE[cell.status] : null;
                      return (
                        <td key={cell.date} className="p-0.5 text-center">
                          {style ? (
                            <button
                              type="button"
                              title={cellTitle(row, cell)}
                              aria-label={`${row.fullName}, ${cell.date}: ${cellTitle(row, cell)}`}
                              onClick={() =>
                                setOpen({ employeeId: row.employeeId, date: cell.date })
                              }
                              className={cn(
                                'relative grid h-7 w-7 place-items-center rounded text-[10px] font-black transition-transform hover:scale-110',
                                style.className,
                                cell.final === false &&
                                  'opacity-70 ring-1 ring-inset ring-current/30',
                              )}
                            >
                              {style.code}
                              {cell.flagged && (
                                <span
                                  aria-hidden
                                  className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-amber"
                                />
                              )}
                              {cell.regularised && (
                                <span
                                  aria-hidden
                                  className="absolute -bottom-0.5 -right-0.5 size-1.5 rounded-full bg-blue"
                                />
                              )}
                            </button>
                          ) : (
                            <span className="block h-7 w-7" />
                          )}
                        </td>
                      );
                    })}
                    <td className="px-2 text-center font-heavy tabular-nums">
                      {row.totals.present + row.totals.late}
                    </td>
                    <td className="px-2 text-center tabular-nums">{row.totals.late}</td>
                    <td className="px-2 text-center tabular-nums">{row.totals.halfDay}</td>
                    <td className="px-2 text-center tabular-nums">{row.totals.absent}</td>
                    <td className="px-2 text-center tabular-nums">{row.totals.onLeave}</td>
                    <td className="px-2 text-center tabular-nums">
                      {Math.round((row.totals.overtimeMinutes / 60) * 10) / 10}
                    </td>
                    <td
                      className="px-2 text-center font-heavy tabular-nums"
                      title={
                        row.totals.lateMarkPenaltyDays > 0
                          ? `Includes −${row.totals.lateMarkPenaltyDays} for late marks`
                          : undefined
                      }
                    >
                      {row.totals.creditedDays}
                    </td>
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

      <div className="space-y-1.5 px-1">
        <StatusLegend />
        <p className="text-micro tracking-normal text-muted">
          A faded square is a day still open. <span className="text-amber">●</span> flagged ·{' '}
          <span className="text-blue">●</span> corrected by a manager. Click any square for the day
          in full.
        </p>
      </div>

      {open && (
        <DayDrawer employeeId={open.employeeId} date={open.date} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
