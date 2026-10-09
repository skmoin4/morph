import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Building2, ChevronLeft, ChevronRight, Search, Smartphone, Users } from 'lucide-react';
import { addDays } from '@opsvera/shared';
import { Button, IconButton } from '../../components/ui/Button';
import { CellStack, DataTable } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField, TextField } from '../../components/ui/Field';
import { MetricCard, MetricRow } from '../../components/ui/MetricCard';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import { formatDisplayDate } from '../../lib/format';
import { AttendancePill, FlagPill, RegularisedPill } from './badges';
import { DayDrawer } from './DayDrawer';
import {
  formatMinutes,
  timeIn,
  useAttendanceLookups,
  useBoard,
  type BoardRow,
} from './useAttendance';

/** Who is in, late, away or not here yet — for a day, with the office filter. */
export function BoardTab() {
  const [date, setDate] = useState<string | undefined>(undefined);
  const [officeId, setOfficeId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState('');
  const [flagged, setFlagged] = useState(false);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<BoardRow | null>(null);

  const { data, isLoading, isFetching } = useBoard({
    date,
    officeId: officeId || undefined,
    departmentId: departmentId || undefined,
    status: status || undefined,
    flagged,
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

  const shownDate = data?.date ?? date;
  const summary = data?.summary;
  const pick = (value: string) => {
    setStatus(status === value ? '' : value);
    setPage(1);
  };

  const columns = useMemo<ColumnDef<BoardRow, unknown>[]>(
    () => [
      {
        header: 'Employee',
        id: 'employee',
        enableSorting: false,
        meta: { className: 'w-[26%] max-w-0' },
        cell: ({ row }) => (
          <CellStack
            title={row.original.fullName}
            subtitle={`${row.original.employeeCode}${row.original.designation ? ` · ${row.original.designation}` : ''}`}
          />
        ),
      },
      {
        header: 'Office',
        id: 'office',
        enableSorting: false,
        cell: ({ row }) => (
          <CellStack
            title={row.original.office.shortCode}
            subtitle={row.original.shift ?? 'No shift'}
          />
        ),
      },
      {
        header: 'Status',
        id: 'status',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <AttendancePill status={row.original.status} />
            {row.original.flagged && <FlagPill reason={row.original.flagReason} />}
            {row.original.isRegularised && <RegularisedPill />}
          </div>
        ),
      },
      {
        header: 'In',
        id: 'in',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {timeIn(row.original.firstInAt, row.original.office.timezone)}
            {row.original.isLate && (
              <span className="ml-1.5 text-micro font-heavy tracking-normal text-pill-amber-fg">
                +{row.original.lateMinutes}m
              </span>
            )}
          </span>
        ),
      },
      {
        header: 'Out',
        id: 'out',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.clockedIn ? (
            <span className="inline-flex items-center gap-1.5 text-micro font-heavy tracking-normal text-green">
              <span className="size-1.5 animate-pulse rounded-full bg-green" /> In now
            </span>
          ) : (
            <span className="whitespace-nowrap tabular-nums">
              {timeIn(row.original.lastOutAt, row.original.office.timezone)}
            </span>
          ),
      },
      {
        header: 'Hours',
        id: 'hours',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {row.original.firstInAt ? formatMinutes(row.original.workedMinutes) : '—'}
          </span>
        ),
      },
      {
        header: 'From',
        id: 'method',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.method === 'MOBILE_GPS' ? (
            <span
              className="inline-flex items-center gap-1 text-sub text-muted"
              title="Phone, with GPS and a selfie"
            >
              <Smartphone aria-hidden className="size-4" />
              {row.original.distanceM !== null ? `${row.original.distanceM} m` : 'Phone'}
            </span>
          ) : row.original.method === 'OFFICE_IP' ? (
            <span
              className="inline-flex items-center gap-1 text-sub text-muted"
              title="Office network"
            >
              <Building2 aria-hidden className="size-4" /> Office
            </span>
          ) : (
            <span className="text-muted">—</span>
          ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-5">
      <MetricRow>
        <MetricCard
          label="In today"
          loading={isLoading}
          value={(summary?.present ?? 0) + (summary?.late ?? 0) + (summary?.halfDay ?? 0)}
          state="good"
          foot={`${summary?.clockedIn ?? 0} clocked in now`}
          onClick={() => pick('PRESENT')}
        />
        <MetricCard
          label="Late"
          loading={isLoading}
          value={summary?.late ?? 0}
          state={summary?.late ? 'warn' : 'neutral'}
          foot="Past the grace period"
          onClick={() => pick('LATE')}
        />
        <MetricCard
          label="Not in yet"
          loading={isLoading}
          value={summary?.notIn ?? 0}
          foot="Expected today"
          onClick={() => pick('NOT_IN')}
        />
        <MetricCard
          label="Absent"
          loading={isLoading}
          value={summary?.absent ?? 0}
          state={summary?.absent ? 'bad' : 'neutral'}
          foot="Day closed, no punch"
          onClick={() => pick('ABSENT')}
        />
        <MetricCard
          label="On leave"
          loading={isLoading}
          value={summary?.onLeave ?? 0}
          foot={`${(summary?.weeklyOff ?? 0) + (summary?.holiday ?? 0)} on a day off`}
          onClick={() => pick('ON_LEAVE')}
        />
        <MetricCard
          label="Flagged"
          loading={isLoading}
          value={summary?.flagged ?? 0}
          state={summary?.flagged ? 'warn' : 'neutral'}
          foot="Outside radius or odd punches"
          onClick={() => {
            setFlagged(!flagged);
            setPage(1);
          }}
        />
      </MetricRow>

      <Panel flush>
        <div className="flex flex-wrap items-end gap-2.5 border-b border-line px-4 py-3">
          <div className="flex items-end gap-1">
            <IconButton
              label="Previous day"
              variant="ghost"
              onClick={() =>
                reset(setDate)(addDays(shownDate ?? new Date().toISOString().slice(0, 10), -1))
              }
            >
              <ChevronLeft />
            </IconButton>
            <TextField
              label="Date"
              srOnlyLabel
              type="date"
              containerClassName="w-44"
              value={shownDate ?? ''}
              onChange={(event) => reset(setDate)(event.target.value || undefined)}
            />
            <IconButton
              label="Next day"
              variant="ghost"
              onClick={() =>
                reset(setDate)(addDays(shownDate ?? new Date().toISOString().slice(0, 10), 1))
              }
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
          <SelectField
            label="Status"
            srOnlyLabel
            placeholder="Any status"
            containerClassName="w-40"
            value={status}
            onChange={(event) => reset(setStatus)(event.target.value)}
            options={[
              { value: 'PRESENT', label: 'Present' },
              { value: 'LATE', label: 'Late' },
              { value: 'HALF_DAY', label: 'Half day' },
              { value: 'NOT_IN', label: 'Not in yet' },
              { value: 'ABSENT', label: 'Absent' },
              { value: 'ON_LEAVE', label: 'On leave' },
              { value: 'WEEKLY_OFF', label: 'Weekly off' },
              { value: 'HOLIDAY', label: 'Holiday' },
            ]}
          />
          {(status || flagged || officeId || departmentId || q) && (
            <Button
              variant="subtle"
              onClick={() => {
                setStatus('');
                setFlagged(false);
                setOfficeId('');
                setDepartmentId('');
                setQ('');
                setPage(1);
              }}
            >
              Clear
            </Button>
          )}
        </div>

        <p className={cn('px-4 pt-3 text-sub text-muted')}>
          {shownDate ? formatDisplayDate(shownDate) : ''}
          {isFetching && ' · updating…'}
        </p>

        <DataTable
          data={data?.data ?? []}
          columns={columns}
          loading={isLoading}
          minWidth={900}
          getRowId={(row) => row.employeeId}
          onRowClick={setOpen}
          empty={
            <EmptyState
              icon={<Users />}
              title="No one matches these filters"
              description="Clear a filter, or pick another day."
            />
          }
        />

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

      {open && shownDate && (
        <DayDrawer employeeId={open.employeeId} date={shownDate} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
