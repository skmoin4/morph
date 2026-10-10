import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Check, FileText, RotateCcw, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Drawer';
import { Dialog } from '../../components/ui/Dialog';
import { TextAreaField } from '../../components/ui/Field';
import { Pill, StatusPill } from '../../components/ui/Pill';
import { Skeleton } from '../../components/ui/Skeleton';
import { ApiRequestError, api } from '../../lib/api';
import { formatDisplayDate } from '../../lib/format';
import { ExpenseStatusPills } from './ExpenseTable';
import {
  EXPENSE_STATUS_LABEL,
  formatFileSize,
  formatRupees,
  useDecideExpense,
  useReimburse,
  useReverseExpense,
  type ExpenseRow,
} from './useExpenses';
import { useQuery } from '@tanstack/react-query';

/** The receipt, fetched with the session (a plain <img> cannot send the token). */
function Receipt({ expense }: { expense: ExpenseRow }) {
  const {
    data: url,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['expenses', 'receipt', expense.id, expense.receipt?.id],
    queryFn: async () => URL.createObjectURL(await api.blob(`/expenses/${expense.id}/receipt`)),
    enabled: !!expense.receipt,
    staleTime: Infinity,
  });
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  if (!expense.receipt) {
    return <p className="text-body text-muted">No receipt attached.</p>;
  }
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (error || !url) return <p className="text-body text-red">The receipt could not be loaded.</p>;

  const isImage = expense.receipt.mimeType.startsWith('image/');
  return (
    <div>
      {isImage ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img
            src={url}
            alt={`Receipt: ${expense.receipt.fileName}`}
            className="max-h-80 w-full rounded-card border border-line bg-surface-2 object-contain"
          />
        </a>
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2.5 rounded-card border border-line bg-surface-2 px-3.5 py-3 text-body text-ink hover:border-blue-2/50"
        >
          <FileText aria-hidden className="size-5 text-muted" />
          <span className="truncate">{expense.receipt.fileName}</span>
          <span className="ml-auto shrink-0 text-micro text-muted">Open PDF</span>
        </a>
      )}
      <p className="mt-1.5 text-micro text-muted">
        {expense.receipt.fileName} · {formatFileSize(expense.receipt.sizeBytes)}
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 last:border-0">
      <dt className="text-sub text-muted">{label}</dt>
      <dd className="text-right text-body text-ink">{children}</dd>
    </div>
  );
}

/** One claim in full: details, receipt, the approval trail, and the decision. */
export function ExpenseDrawer({
  expenseId,
  fallback,
  onClose,
  onReject,
}: {
  expenseId: string;
  fallback: ExpenseRow;
  onClose: () => void;
  onReject: (row: ExpenseRow) => void;
}) {
  // The list row is what we had; fetch the detail for limit messages and the trail.
  const { data: detail } = useQuery({
    queryKey: ['expenses', 'detail', expenseId, fallback.status, fallback.approvals.length],
    queryFn: () => api.get<ExpenseRow>(`/expenses/${expenseId}`),
  });
  const expense = detail ?? fallback;
  const decide = useDecideExpense();
  const reimburse = useReimburse();
  const [reversing, setReversing] = useState(false);

  async function approve() {
    try {
      const res = await decide.mutateAsync({
        id: expense.id,
        input: { decision: 'APPROVED', comment: null },
      });
      toast.success(
        res.status === 'PENDING_FINANCE'
          ? 'Approved — it now goes to Finance'
          : 'Approved — the cost is on the project',
      );
      onClose();
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not approve.');
    }
  }

  async function pay() {
    try {
      const res = await reimburse.mutateAsync([expense.id]);
      if (res.failed)
        toast.error(res.results.find((r) => !r.ok)?.message ?? 'Could not mark as paid.');
      else {
        toast.success('Marked as reimbursed');
        onClose();
      }
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not mark as paid.');
    }
  }

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        width="md"
        title={`${expense.category.name} · ${formatRupees(expense.amount)}`}
        subtitle={`${expense.employee.fullName} · ${formatDisplayDate(expense.expenseDate)}`}
        footer={
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            {expense.canReverse && (
              <Button
                variant="secondary"
                leadingIcon={<RotateCcw />}
                onClick={() => setReversing(true)}
              >
                Reverse
              </Button>
            )}
            {expense.canReimburse && (
              <Button
                variant="primary"
                leadingIcon={<Check />}
                loading={reimburse.isPending}
                onClick={pay}
              >
                Mark reimbursed
              </Button>
            )}
            {expense.canDecide && (
              <>
                <Button variant="danger" leadingIcon={<X />} onClick={() => onReject(expense)}>
                  Reject
                </Button>
                <Button
                  variant="primary"
                  leadingIcon={<Check />}
                  loading={decide.isPending}
                  onClick={approve}
                >
                  {expense.awaiting === 'MANAGER' ? 'Approve (to Finance)' : 'Approve'}
                </Button>
              </>
            )}
          </div>
        }
      >
        <div className="space-y-5">
          <ExpenseStatusPills row={expense} />

          {((expense.limitMessages?.length ?? 0) > 0 || expense.exceededLimit) && (
            <div className="flex items-start gap-2.5 rounded-card border border-amber/40 bg-pill-amber-bg p-3 text-sub text-pill-amber-fg">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-heavy">Over a category limit</p>
                {(expense.limitMessages ?? []).map((m) => (
                  <p key={m}>{m}</p>
                ))}
              </div>
            </div>
          )}

          <dl>
            <Row label="Amount">{formatRupees(expense.amount)}</Row>
            <Row label="Category">{expense.category.name}</Row>
            <Row label="Project">
              {expense.project
                ? `${expense.project.projectCode} · ${expense.project.name}`
                : 'None (general)'}
            </Row>
            <Row label="Billable">{expense.isBillable ? 'Yes' : 'No'}</Row>
            <Row label="Date">{formatDisplayDate(expense.expenseDate)}</Row>
            {expense.description && <Row label="For">{expense.description}</Row>}
            {expense.status === 'APPROVED' && (
              <Row label="Project cost">
                {expense.costPosted ? 'Posted to the ledger' : 'No project, nothing posted'}
              </Row>
            )}
            {expense.reimbursedAt && (
              <Row label="Paid on">{formatDisplayDate(expense.reimbursedAt)}</Row>
            )}
          </dl>

          <div>
            <h3 className="mb-2 text-sub font-heavy text-ink-2">Receipt</h3>
            <Receipt expense={expense} />
          </div>

          <div>
            <h3 className="mb-2 text-sub font-heavy text-ink-2">Approval</h3>
            {expense.approvals.length === 0 ? (
              <p className="text-body text-muted">
                {expense.status === 'DRAFT' ? 'Not submitted yet.' : 'No decisions yet.'}
              </p>
            ) : (
              <ol className="space-y-2.5">
                {expense.approvals.map((a) => (
                  <li key={a.stage} className="flex items-start gap-2.5 text-body text-ink-2">
                    <Pill tone="gray">{a.stage === 'MANAGER' ? 'Manager' : 'Finance'}</Pill>
                    <div className="min-w-0">
                      <StatusPill status={a.status} dot={false} />
                      <span className="ml-1.5 text-muted">
                        {a.approver ?? (a.status === 'PENDING' ? 'Waiting' : '—')}
                        {a.decidedAt && ` · ${formatDisplayDate(a.decidedAt)}`}
                      </span>
                      {a.comment && <p className="mt-1">“{a.comment}”</p>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {expense.status === 'REJECTED' && (
              <p className="mt-2 text-sub text-muted">
                {EXPENSE_STATUS_LABEL.REJECTED}.{' '}
                {expense.isMine ? 'Change it and submit again.' : ''}
              </p>
            )}
          </div>
        </div>
      </Drawer>
      {reversing && (
        <ReverseDialog row={expense} onClose={() => setReversing(false)} onDone={onClose} />
      )}
    </>
  );
}

function ReverseDialog({
  row,
  onClose,
  onDone,
}: {
  row: ExpenseRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const reverse = useReverseExpense();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (reason.trim().length < 5) {
      setError('Say why, in a few words.');
      return;
    }
    try {
      await reverse.mutateAsync({ id: row.id, input: { reason } });
      toast.success('Reversed — the cost posting was taken back');
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not reverse.');
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Reverse this approved claim?"
      description={`${row.employee.fullName} · ${formatRupees(row.amount)}. Its cost posting is taken off the project, and the claim goes back to the employee to correct or drop. Only possible before it is paid.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={reverse.isPending}>
            Back
          </Button>
          <Button variant="danger" loading={reverse.isPending} onClick={submit}>
            Reverse
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
