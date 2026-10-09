import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { Check, ClipboardCheck, PenLine, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { CellStack, DataTable } from '../../components/ui/DataTable';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField, TextAreaField } from '../../components/ui/Field';
import { Panel } from '../../components/ui/Panel';
import { StatusPill } from '../../components/ui/Pill';
import { ApiRequestError } from '../../lib/api';
import { formatDisplayDate } from '../../lib/format';
import { useAuth } from '../../providers/AuthProvider';
import { CorrectionDialog } from './CorrectionDialog';
import {
  useCancelRegularisation,
  useDecideRegularisation,
  useRegularisations,
  type RegularisationRow,
} from './useAttendance';

/** Correction requests: yours, and the ones waiting on you. */
export function RequestsTab() {
  const { user, can } = useAuth();
  const [status, setStatus] = useState('PENDING');
  const [page, setPage] = useState(1);
  const [asking, setAsking] = useState(false);
  const [rejecting, setRejecting] = useState<RegularisationRow | null>(null);

  const { data, isLoading } = useRegularisations({ status: status || undefined, page });
  const decide = useDecideRegularisation();
  const cancel = useCancelRegularisation();

  async function approve(row: RegularisationRow) {
    try {
      await decide.mutateAsync({ id: row.id, input: { decision: 'APPROVED', note: null } });
      toast.success(`Approved — ${row.employee.fullName}’s day was corrected`);
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not approve.');
    }
  }

  async function withdraw(row: RegularisationRow) {
    try {
      await cancel.mutateAsync(row.id);
      toast.success('Request cancelled');
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not cancel.');
    }
  }

  const columns = useMemo<ColumnDef<RegularisationRow, unknown>[]>(
    () => [
      {
        header: 'Employee',
        id: 'employee',
        enableSorting: false,
        meta: { className: 'w-[22%] max-w-0' },
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
        header: 'Day',
        id: 'day',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {formatDisplayDate(row.original.attendanceDate)}
          </span>
        ),
      },
      {
        header: 'Asked for',
        id: 'asked',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {row.original.requestedInTime ? `In ${row.original.requestedInTime}` : ''}
            {row.original.requestedInTime && row.original.requestedOutTime ? ' · ' : ''}
            {row.original.requestedOutTime ? `Out ${row.original.requestedOutTime}` : ''}
          </span>
        ),
      },
      {
        header: 'Reason',
        id: 'reason',
        enableSorting: false,
        meta: { className: 'w-[30%] max-w-0' },
        cell: ({ row }) => (
          <CellStack
            title={row.original.reason}
            subtitle={
              row.original.decisionNote ? `Manager: ${row.original.decisionNote}` : undefined
            }
          />
        ),
      },
      {
        header: 'Status',
        id: 'status',
        enableSorting: false,
        cell: ({ row }) => <StatusPill status={row.original.status} />,
      },
      {
        header: '',
        id: 'actions',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1.5" onClick={(event) => event.stopPropagation()}>
            {row.original.canDecide && (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  leadingIcon={<Check />}
                  loading={decide.isPending}
                  onClick={() => approve(row.original)}
                >
                  Approve
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
            {row.original.isMine && row.original.status === 'PENDING' && (
              <Button size="sm" variant="ghost" onClick={() => withdraw(row.original)}>
                Cancel
              </Button>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [decide.isPending],
  );

  return (
    <div className="space-y-4">
      <Panel
        flush
        title="Correction requests"
        subtitle="A missed punch or a wrong time: ask, and your manager decides. The original punches stay on record."
        action={
          user?.employeeId &&
          can('attendance.regularise') && (
            <Button
              size="sm"
              variant="primary"
              leadingIcon={<PenLine />}
              onClick={() => setAsking(true)}
            >
              Request a correction
            </Button>
          )
        }
        bodyClassName="mt-1"
      >
        <div className="flex flex-wrap items-end gap-2.5 border-y border-line px-4 py-3">
          <SelectField
            label="Status"
            srOnlyLabel
            containerClassName="w-44"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            options={[
              { value: 'PENDING', label: 'Waiting' },
              { value: 'APPROVED', label: 'Approved' },
              { value: 'REJECTED', label: 'Rejected' },
              { value: 'CANCELLED', label: 'Cancelled' },
              { value: '', label: 'All' },
            ]}
          />
        </div>

        <DataTable
          data={data?.data ?? []}
          columns={columns}
          loading={isLoading}
          minWidth={900}
          getRowId={(row) => row.id}
          empty={
            <EmptyState
              icon={<ClipboardCheck />}
              title={status === 'PENDING' ? 'Nothing is waiting' : 'No requests here'}
              description="When someone asks for a day to be corrected, it appears here for their manager."
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
      </Panel>

      {asking && (
        <CorrectionDialog
          defaultDate={new Date().toISOString().slice(0, 10)}
          onClose={() => setAsking(false)}
        />
      )}
      {rejecting && <RejectDialog row={rejecting} onClose={() => setRejecting(null)} />}
    </div>
  );
}

function RejectDialog({ row, onClose }: { row: RegularisationRow; onClose: () => void }) {
  const decide = useDecideRegularisation();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (note.trim().length < 5) {
      setError('Say why, in a few words.');
      return;
    }
    try {
      await decide.mutateAsync({ id: row.id, input: { decision: 'REJECTED', note } });
      toast.success('Request rejected');
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not reject.');
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Reject this correction?"
      description={`${row.employee.fullName} · ${formatDisplayDate(row.attendanceDate)}. The day stays as it was recorded.`}
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
