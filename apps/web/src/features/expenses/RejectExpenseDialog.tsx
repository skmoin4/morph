import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { TextAreaField } from '../../components/ui/Field';
import { ApiRequestError } from '../../lib/api';
import {
  formatRupees,
  useBulkDecideExpenses,
  useDecideExpense,
  type ExpenseRow,
} from './useExpenses';

/** Reject one claim, or several, with the reason the employee will read. */
export function RejectExpenseDialog({
  rows,
  onClose,
  onDone,
}: {
  rows: ExpenseRow[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const decide = useDecideExpense();
  const bulk = useBulkDecideExpenses();
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
        rows.length === 1 ? 'Sent back to the employee' : `Sent back ${rows.length} claims`,
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
      title={rows.length === 1 ? 'Reject this claim?' : `Reject ${rows.length} claims?`}
      description={
        rows.length === 1
          ? `${rows[0].employee.fullName} · ${rows[0].category.name} · ${formatRupees(rows[0].amount)}. They can correct it and send it again.`
          : 'Each person can correct their claim and send it again.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Back
          </Button>
          <Button variant="danger" loading={pending} onClick={submit}>
            Reject
          </Button>
        </>
      }
    >
      <TextAreaField
        label="Reason for the employee"
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
