import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { Check, ClipboardCheck, Eye, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { CellStack, DataTable } from '../../components/ui/DataTable';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField, TextAreaField } from '../../components/ui/Field';
import { Panel } from '../../components/ui/Panel';
import { Pill, StatusPill } from '../../components/ui/Pill';
import { ApiRequestError } from '../../lib/api';
import { formatDisplayDate } from '../../lib/format';
import { ReviewDrawer } from './ReviewDrawer';
import {
  formatHoursMinutes,
  useBulkDecide,
  useDecideTimesheet,
  useTimesheets,
  weekLabel,
  type TimesheetRow,
} from './useTime';

/** Submitted weeks from the people you approve for, with bulk approve. */
export function ApprovalsTab() {
  const [view, setView] = useState('toDecide');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewing, setReviewing] = useState<TimesheetRow | null>(null);
  const [rejecting, setRejecting] = useState<TimesheetRow[] | null>(null);

  const { data, isLoading } = useTimesheets({
    toDecide: view === 'toDecide',
    status: view === 'toDecide' || view === 'ALL' ? undefined : view,
    page,
    pageSize: 25,
  });
  const decide = useDecideTimesheet();
  const bulk = useBulkDecide();

  const rows = data?.data ?? [];
  const decidable = rows.filter((r) => r.canDecide);
  const allSelected = decidable.length > 0 && decidable.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function approveOne(row: TimesheetRow) {
    try {
      await decide.mutateAsync({ id: row.id, input: { decision: 'APPROVED', comment: null } });
      toast.success(`Approved — ${row.employee.fullName}’s hours are costed`);
      setSelected((s) => {
        const next = new Set(s);
        next.delete(row.id);
        return next;
      });
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not approve.');
    }
  }

  async function approveSelected() {
    const ids = [...selected].filter((id) => rows.some((r) => r.id === id && r.canDecide));
    if (ids.length === 0) return;
    try {
      const result = await bulk.mutateAsync({ ids, decision: 'APPROVED' });
      if (result.failed === 0)
        toast.success(`Approved ${result.done} timesheet${result.done === 1 ? '' : 's'}`);
      else {
        const why = result.results.find((r) => !r.ok)?.message;
        toast.warning(
          `Approved ${result.done}; ${result.failed} could not be: ${why ?? 'see each sheet'}`,
        );
      }
      setSelected(new Set());
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not approve.');
    }
  }

  const columns = useMemo<ColumnDef<TimesheetRow, unknown>[]>(
    () => [
      {
        header: () => (
          <input
            type="checkbox"
            aria-label="Select all"
            className="size-4 accent-blue"
            disabled={decidable.length === 0}
            checked={allSelected}
            onChange={() =>
              setSelected(allSelected ? new Set() : new Set(decidable.map((r) => r.id)))
            }
          />
        ),
        id: 'select',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.canDecide ? (
            <input
              type="checkbox"
              aria-label={`Select ${row.original.employee.fullName}`}
              className="size-4 accent-blue"
              checked={selected.has(row.original.id)}
              onChange={() => toggle(row.original.id)}
            />
          ) : null,
      },
      {
        header: 'Employee',
        id: 'employee',
        enableSorting: false,
        meta: { className: 'w-[20%] max-w-0' },
        cell: ({ row }) => (
          <CellStack
            title={
              row.original.isMine
                ? `${row.original.employee.fullName} (you)`
                : row.original.employee.fullName
            }
            subtitle={`${row.original.employee.employeeCode} · ${row.original.employee.office}`}
          />
        ),
      },
      {
        header: 'Week',
        id: 'week',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {weekLabel(row.original.weekStart, row.original.weekEnd)}
          </span>
        ),
      },
      {
        header: 'Hours',
        id: 'hours',
        enableSorting: false,
        cell: ({ row }) => (
          <CellStack
            title={formatHoursMinutes(row.original.totalHours)}
            subtitle={`${formatHoursMinutes(row.original.billableHours)} billable`}
          />
        ),
      },
      {
        header: 'Projects',
        id: 'projects',
        enableSorting: false,
        meta: { className: 'w-[22%] max-w-0' },
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.projects.slice(0, 3).map((p) => (
              <Pill key={p.code} tone="gray">
                {p.code} · {formatHoursMinutes(p.hours)}
              </Pill>
            ))}
            {row.original.projects.length > 3 && (
              <Pill tone="gray">+{row.original.projects.length - 3}</Pill>
            )}
          </div>
        ),
      },
      {
        header: 'Status',
        id: 'status',
        enableSorting: false,
        cell: ({ row }) => (
          <div>
            <StatusPill status={row.original.status} />
            {row.original.submittedAt && row.original.status === 'SUBMITTED' && (
              <p className="mt-1 text-micro text-muted">
                Submitted {formatDisplayDate(row.original.submittedAt)}
              </p>
            )}
          </div>
        ),
      },
      {
        header: '',
        id: 'actions',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<Eye />}
              onClick={() => setReviewing(row.original)}
            >
              Review
            </Button>
            {row.original.canDecide && (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  leadingIcon={<Check />}
                  loading={decide.isPending && decide.variables?.id === row.original.id}
                  onClick={() => approveOne(row.original)}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  leadingIcon={<X />}
                  onClick={() => setRejecting([row.original])}
                >
                  Reject
                </Button>
              </>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, allSelected, decidable.length, decide.isPending, decide.variables?.id],
  );

  return (
    <Panel
      flush
      title="Timesheet approvals"
      subtitle="Approving locks the hours and posts their cost to the project at each day’s rate."
      bodyClassName="mt-1"
    >
      <div className="flex flex-wrap items-end justify-between gap-2.5 border-y border-line px-4 py-3">
        <SelectField
          label="Show"
          srOnlyLabel
          containerClassName="w-52"
          value={view}
          onChange={(event) => {
            setView(event.target.value);
            setPage(1);
            setSelected(new Set());
          }}
          options={[
            { value: 'toDecide', label: 'Waiting on me' },
            { value: 'SUBMITTED', label: 'All waiting' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'REJECTED', label: 'Sent back' },
            { value: 'REOPENED', label: 'Reopened' },
            { value: 'ALL', label: 'Everything' },
          ]}
        />
        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sub text-muted">{selected.size} selected</span>
            <Button
              size="sm"
              variant="primary"
              leadingIcon={<Check />}
              loading={bulk.isPending}
              onClick={approveSelected}
            >
              Approve selected
            </Button>
            <Button
              size="sm"
              variant="danger"
              leadingIcon={<X />}
              onClick={() => setRejecting(rows.filter((r) => selected.has(r.id)))}
            >
              Reject selected
            </Button>
          </div>
        )}
      </div>

      <DataTable
        data={rows}
        columns={columns}
        loading={isLoading}
        minWidth={980}
        getRowId={(row) => row.id}
        empty={
          <EmptyState
            icon={<ClipboardCheck />}
            title={view === 'toDecide' ? 'Nothing is waiting on you' : 'No timesheets here'}
            description="When someone on your team submits a week, it appears here."
          />
        }
      />

      {data && data.meta.totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
          <p className="text-sub text-muted">
            Page {data.meta.page} of {data.meta.totalPages}
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

      {reviewing && <ReviewDrawer row={reviewing} onClose={() => setReviewing(null)} />}
      {rejecting && (
        <RejectDialog
          rows={rejecting}
          onClose={() => setRejecting(null)}
          onDone={() => setSelected(new Set())}
        />
      )}
    </Panel>
  );
}

export function RejectDialog({
  rows,
  onClose,
  onDone,
}: {
  rows: TimesheetRow[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const decide = useDecideTimesheet();
  const bulk = useBulkDecide();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pending = decide.isPending || bulk.isPending;

  async function submit() {
    if (comment.trim().length < 5) {
      setError('Say why, in a few words.');
      return;
    }
    try {
      if (rows.length === 1) {
        await decide.mutateAsync({ id: rows[0].id, input: { decision: 'REJECTED', comment } });
      } else {
        await bulk.mutateAsync({ ids: rows.map((r) => r.id), decision: 'REJECTED', comment });
      }
      toast.success(
        rows.length === 1 ? 'Sent back to the employee' : `Sent back ${rows.length} timesheets`,
      );
      onDone?.();
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not reject.');
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={
        rows.length === 1 ? 'Send this timesheet back?' : `Send ${rows.length} timesheets back?`
      }
      description={
        rows.length === 1
          ? `${rows[0].employee.fullName} · ${weekLabel(rows[0].weekStart, rows[0].weekEnd)}. They can fix it and submit again.`
          : 'Each person can fix their week and submit again.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Back
          </Button>
          <Button variant="danger" loading={pending} onClick={submit}>
            Send back
          </Button>
        </>
      }
    >
      <TextAreaField
        label="What needs fixing?"
        required
        rows={3}
        value={comment}
        error={error ?? undefined}
        onChange={(event) => {
          setComment(event.target.value);
          setError(null);
        }}
      />
    </Dialog>
  );
}
