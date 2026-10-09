import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { Check, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { CellStack, DataTable } from '../../components/ui/DataTable';
import { Dialog } from '../../components/ui/Dialog';
import { TextAreaField } from '../../components/ui/Field';
import { Pill, StatusPill } from '../../components/ui/Pill';
import { ApiRequestError } from '../../lib/api';
import { formatDisplayDate } from '../../lib/format';
import {
  awaitingLabel,
  DAY_PART_LABEL,
  formatDays,
  formatRange,
  toneForType,
  useCancelLeave,
  useDecideLeave,
  type LeaveRow,
} from './useLeave';

export function TypePill({
  type,
}: {
  type: Pick<LeaveRow['leaveType'], 'shortCode' | 'colorToken' | 'name'>;
}) {
  return (
    <span title={type.name}>
      <Pill tone={toneForType(type.colorToken)}>{type.shortCode}</Pill>
    </span>
  );
}

/** The trail under a decided request: who said what. */
function trail(row: LeaveRow): string | undefined {
  const parts: string[] = [];
  if (row.level1?.approver) {
    parts.push(`${row.level1.approver}${row.level1.note ? `: “${row.level1.note}”` : ''}`);
  }
  if (row.level2?.approver) {
    parts.push(`${row.level2.approver}${row.level2.note ? `: “${row.level2.note}”` : ''}`);
  }
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * Leave requests as a table, with the actions each row allows. The server says
 * what may be done (`canDecide`, `canCancel`); this only shows it.
 */
export function LeaveTable({
  rows,
  loading,
  showEmployee,
  empty,
}: {
  rows: LeaveRow[];
  loading: boolean;
  showEmployee: boolean;
  empty: React.ReactNode;
}) {
  const decide = useDecideLeave();
  const [rejecting, setRejecting] = useState<LeaveRow | null>(null);
  const [cancelling, setCancelling] = useState<LeaveRow | null>(null);

  async function approve(row: LeaveRow) {
    try {
      const res = await decide.mutateAsync({
        id: row.id,
        input: { decision: 'APPROVED', note: null },
      });
      toast.success(
        res.status === 'APPROVED'
          ? `Approved — ${row.employee.fullName}’s leave is on the calendar`
          : 'Approved at level 1. It now waits for the final approval.',
      );
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not approve.');
    }
  }

  const columns = useMemo<ColumnDef<LeaveRow, unknown>[]>(
    () => [
      ...(showEmployee
        ? [
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
            } satisfies ColumnDef<LeaveRow, unknown>,
          ]
        : []),
      {
        header: 'Leave',
        id: 'type',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <TypePill type={row.original.leaveType} />
            <span className="text-body text-ink">{row.original.leaveType.name}</span>
          </div>
        ),
      },
      {
        header: 'Dates',
        id: 'dates',
        enableSorting: false,
        cell: ({ row }) => (
          <CellStack
            title={formatRange(row.original.fromDate, row.original.toDate)}
            subtitle={
              row.original.dayPart !== 'FULL_DAY'
                ? DAY_PART_LABEL[row.original.dayPart]
                : row.original.fromDate.slice(0, 4)
            }
          />
        ),
      },
      {
        header: 'Days',
        id: 'days',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {formatDays(row.original.totalDays)}
          </span>
        ),
      },
      {
        header: 'Reason',
        id: 'reason',
        enableSorting: false,
        meta: { className: 'w-[28%] max-w-0' },
        cell: ({ row }) => <CellStack title={row.original.reason} subtitle={trail(row.original)} />,
      },
      {
        header: 'Status',
        id: 'status',
        enableSorting: false,
        cell: ({ row }) => (
          <div>
            <StatusPill status={row.original.status} />
            {awaitingLabel(row.original) && (
              <p className="mt-1 text-micro text-muted">{awaitingLabel(row.original)}</p>
            )}
            {row.original.decidedAt && row.original.status !== 'PENDING' && (
              <p className="mt-1 text-micro text-muted">
                {formatDisplayDate(row.original.decidedAt)}
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
            {row.original.canDecide && (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  leadingIcon={<Check />}
                  loading={decide.isPending && decide.variables?.id === row.original.id}
                  onClick={() => approve(row.original)}
                >
                  {row.original.flow === 'TEAM_LEAD_THEN_MANAGER' &&
                  row.original.awaitingLevel === 1
                    ? 'Approve (1 of 2)'
                    : 'Approve'}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  leadingIcon={<X />}
                  onClick={() => setRejecting(row.original)}
                >
                  Reject
                </Button>
              </>
            )}
            {row.original.canCancel && (
              <Button size="sm" variant="ghost" onClick={() => setCancelling(row.original)}>
                Cancel
              </Button>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showEmployee, decide.isPending, decide.variables?.id],
  );

  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        loading={loading}
        minWidth={showEmployee ? 980 : 820}
        getRowId={(row) => row.id}
        empty={empty}
      />
      {rejecting && <RejectDialog row={rejecting} onClose={() => setRejecting(null)} />}
      {cancelling && <CancelDialog row={cancelling} onClose={() => setCancelling(null)} />}
    </>
  );
}

function RejectDialog({ row, onClose }: { row: LeaveRow; onClose: () => void }) {
  const decide = useDecideLeave();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (note.trim().length < 5) {
      setError('Say why, in a few words.');
      return;
    }
    try {
      await decide.mutateAsync({ id: row.id, input: { decision: 'REJECTED', note } });
      toast.success('Leave rejected — the days went back to the balance');
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not reject.');
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Reject this leave?"
      description={`${row.employee.fullName} · ${row.leaveType.name} · ${formatRange(row.fromDate, row.toDate)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={decide.isPending}>
            Back
          </Button>
          <Button variant="danger" loading={decide.isPending} onClick={submit}>
            Reject
          </Button>
        </>
      }
    >
      <TextAreaField
        label="Reason for the employee"
        required
        rows={3}
        value={note}
        error={error ?? undefined}
        onChange={(event) => {
          setNote(event.target.value);
          setError(null);
        }}
      />
    </Dialog>
  );
}

function CancelDialog({ row, onClose }: { row: LeaveRow; onClose: () => void }) {
  const cancel = useCancelLeave();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Taking back someone else's approved leave needs a reason; withdrawing your own does not.
  const needsReason = !row.isMine && row.status === 'APPROVED';

  async function submit() {
    if (needsReason && note.trim().length < 5) {
      setError('Say why, in a few words.');
      return;
    }
    try {
      await cancel.mutateAsync({ id: row.id, input: { note: note || null } });
      toast.success('Leave cancelled — the days went back to the balance');
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not cancel.');
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={row.status === 'APPROVED' ? 'Cancel this approved leave?' : 'Withdraw this request?'}
      description={`${row.leaveType.name} · ${formatRange(row.fromDate, row.toDate)} · ${formatDays(row.totalDays)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={cancel.isPending}>
            Keep it
          </Button>
          <Button variant="danger" loading={cancel.isPending} onClick={submit}>
            {row.status === 'APPROVED' ? 'Cancel leave' : 'Withdraw'}
          </Button>
        </>
      }
    >
      {(needsReason || !row.isMine) && (
        <TextAreaField
          label={needsReason ? 'Reason' : 'Note (optional)'}
          required={needsReason}
          rows={3}
          value={note}
          error={error ?? undefined}
          onChange={(event) => {
            setNote(event.target.value);
            setError(null);
          }}
        />
      )}
      {!needsReason && row.isMine && (
        <p className="text-body text-muted">
          The days go back to your balance
          {row.status === 'APPROVED' ? ' and the calendar is cleared' : ''}.
          {error && <span className="mt-2 block text-red">{error}</span>}
        </p>
      )}
    </Dialog>
  );
}
