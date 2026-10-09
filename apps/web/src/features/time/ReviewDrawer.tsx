import { useState } from 'react';
import { toast } from 'sonner';
import { Check, RotateCcw, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { TextAreaField } from '../../components/ui/Field';
import { Drawer } from '../../components/ui/Drawer';
import { Skeleton } from '../../components/ui/Skeleton';
import { StatusPill } from '../../components/ui/Pill';
import { ApiRequestError } from '../../lib/api';
import { formatDisplayDate } from '../../lib/format';
import { RejectDialog } from './ApprovalsTab';
import { WeekGrid } from './WeekGrid';
import {
  formatHoursMinutes,
  useDecideTimesheet,
  useReopenTimesheet,
  useWeek,
  weekLabel,
  type TimesheetRow,
} from './useTime';

/** A read-only look at someone's week, with the decision at the bottom. */
export function ReviewDrawer({ row, onClose }: { row: TimesheetRow; onClose: () => void }) {
  const { data: week, isLoading } = useWeek(row.weekStart, row.employee.id);
  const decide = useDecideTimesheet();
  const [rejecting, setRejecting] = useState(false);
  const [reopening, setReopening] = useState(false);

  async function approve() {
    try {
      await decide.mutateAsync({ id: row.id, input: { decision: 'APPROVED', comment: null } });
      toast.success(`Approved — ${row.employee.fullName}’s hours are costed`);
      onClose();
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not approve.');
    }
  }

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        width="lg"
        title={row.employee.fullName}
        subtitle={`${row.employee.employeeCode} · ${weekLabel(row.weekStart, row.weekEnd)}`}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <p className="text-sub text-muted">
              {formatHoursMinutes(row.totalHours)} · {formatHoursMinutes(row.billableHours)}{' '}
              billable
            </p>
            <div className="flex gap-2">
              {row.canReopen && (
                <Button
                  variant="secondary"
                  leadingIcon={<RotateCcw />}
                  onClick={() => setReopening(true)}
                >
                  Reopen
                </Button>
              )}
              {row.canDecide && (
                <>
                  <Button variant="danger" leadingIcon={<X />} onClick={() => setRejecting(true)}>
                    Send back
                  </Button>
                  <Button
                    variant="primary"
                    leadingIcon={<Check />}
                    loading={decide.isPending}
                    onClick={approve}
                  >
                    Approve
                  </Button>
                </>
              )}
            </div>
          </div>
        }
      >
        {isLoading || !week ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <StatusPill status={week.status} />
              {week.timesheet?.submittedAt && (
                <span className="text-sub text-muted">
                  Submitted {formatDisplayDate(week.timesheet.submittedAt)}
                </span>
              )}
            </div>

            <div className="-mx-1 overflow-hidden rounded-card border border-line">
              <WeekGrid week={week} readOnly />
            </div>

            {week.entries.some((e) => e.description) && (
              <div>
                <h3 className="mb-2 text-sub font-heavy text-ink-2">Notes</h3>
                <ul className="space-y-1.5 text-body text-ink-2">
                  {week.entries
                    .filter((e) => e.description)
                    .map((e) => (
                      <li key={e.id}>
                        <span className="text-muted">
                          {formatDisplayDate(e.workDate)} · {e.project.projectCode}:
                        </span>{' '}
                        {e.description}
                      </li>
                    ))}
                </ul>
              </div>
            )}

            {(week.timesheet?.approvals.length ?? 0) > 0 && (
              <div>
                <h3 className="mb-2 text-sub font-heavy text-ink-2">History</h3>
                <ul className="space-y-1.5 text-body text-ink-2">
                  {week.timesheet!.approvals.map((a, i) => (
                    <li key={i}>
                      <StatusPill status={a.status} dot={false} />{' '}
                      <span className="text-muted">
                        {a.approver ?? 'Someone'} · {formatDisplayDate(a.decidedAt)}
                      </span>
                      {a.comment && <span> — “{a.comment}”</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {week.timesheet?.reopenReason && (
              <p className="rounded-card border border-line bg-surface-2 p-3 text-sub text-ink-2">
                Reopened: {week.timesheet.reopenReason}
              </p>
            )}
          </div>
        )}
      </Drawer>

      {rejecting && (
        <RejectDialog rows={[row]} onClose={() => setRejecting(false)} onDone={onClose} />
      )}
      {reopening && <ReopenDialog row={row} onClose={() => setReopening(false)} onDone={onClose} />}
    </>
  );
}

function ReopenDialog({
  row,
  onClose,
  onDone,
}: {
  row: TimesheetRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const reopen = useReopenTimesheet();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (reason.trim().length < 5) {
      setError('Say why, in a few words.');
      return;
    }
    try {
      await reopen.mutateAsync({ id: row.id, input: { reason } });
      toast.success('Reopened — the cost posting was reversed');
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not reopen.');
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Reopen this approved timesheet?"
      description={`${row.employee.fullName} · ${weekLabel(row.weekStart, row.weekEnd)}. Its cost posting is reversed on the ledger, the hours unlock, and they resubmit for a fresh approval.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={reopen.isPending}>
            Back
          </Button>
          <Button variant="primary" loading={reopen.isPending} onClick={submit}>
            Reopen
          </Button>
        </>
      }
    >
      <TextAreaField
        label="Reason (kept in the audit log)"
        required
        rows={3}
        value={reason}
        error={error ?? undefined}
        onChange={(event) => {
          setReason(event.target.value);
          setError(null);
        }}
      />
    </Dialog>
  );
}
