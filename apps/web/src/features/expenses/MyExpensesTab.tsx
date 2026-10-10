import { useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Plus, Receipt, Send, Trash2, Undo2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField } from '../../components/ui/Field';
import { MetricCard, MetricRow } from '../../components/ui/MetricCard';
import { Panel } from '../../components/ui/Panel';
import { ApiRequestError } from '../../lib/api';
import { ExpenseDialog } from './ExpenseDialog';
import { ExpenseDrawer } from './ExpenseDrawer';
import { ExpenseTable } from './ExpenseTable';
import {
  formatRupees,
  useDeleteExpense,
  useExpenseSummary,
  useExpenses,
  useSubmitExpense,
  useWithdrawExpense,
  type ExpenseRow,
} from './useExpenses';

export function Pager({
  meta,
  onPage,
}: {
  meta?: { page: number; totalPages: number };
  onPage: (updater: (page: number) => number) => void;
}) {
  if (!meta || meta.totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
      <p className="text-sub text-muted">
        Page {meta.page} of {meta.totalPages}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={meta.page <= 1}
          onClick={() => onPage((p) => p - 1)}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={meta.page >= meta.totalPages}
          onClick={() => onPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

/** Your claims: where each stands, with the actions you have left. */
export function MyExpensesTab({ today, startNew }: { today: string; startNew: boolean }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<ExpenseRow | 'new' | null>(startNew ? 'new' : null);
  const [opened, setOpened] = useState<ExpenseRow | null>(null);
  const [deleting, setDeleting] = useState<ExpenseRow | null>(null);

  const { data, isLoading } = useExpenses({ mine: true, status: status || undefined, page });
  const { data: summary } = useExpenseSummary();
  const submit = useSubmitExpense();
  const withdraw = useWithdrawExpense();
  const remove = useDeleteExpense();

  async function act(run: () => Promise<unknown>, ok: string) {
    try {
      await run();
      toast.success(ok);
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'That did not work.');
    }
  }

  const m = summary?.mine;
  return (
    <div className="space-y-5">
      <MetricRow>
        <MetricCard
          label="With approvers"
          value={m?.waiting.count ?? 0}
          foot={m ? formatRupees(m.waiting.amount) : ' '}
          loading={!m}
        />
        <MetricCard
          label="To be paid to you"
          value={m ? formatRupees(m.approvedUnpaid.amount) : ''}
          state={m && Number(m.approvedUnpaid.amount) > 0 ? 'good' : 'neutral'}
          foot={
            m
              ? `${m.approvedUnpaid.count} approved claim${m.approvedUnpaid.count === 1 ? '' : 's'}`
              : ' '
          }
          loading={!m}
        />
        <MetricCard
          label="Reimbursed"
          value={m ? formatRupees(m.reimbursed.amount) : ''}
          foot={m ? `${m.reimbursed.count} claims` : ' '}
          loading={!m}
        />
        <MetricCard
          label="Needs your attention"
          value={m ? m.rejected.count + m.drafts.count : 0}
          state={m && m.rejected.count > 0 ? 'warn' : 'neutral'}
          foot={m ? `${m.drafts.count} draft · ${m.rejected.count} sent back` : ' '}
          loading={!m}
        />
      </MetricRow>

      <Panel
        flush
        title="My expenses"
        subtitle="Claim, track and get paid back."
        action={
          <Button
            size="sm"
            variant="primary"
            leadingIcon={<Plus />}
            onClick={() => setEditing('new')}
          >
            New expense
          </Button>
        }
        bodyClassName="mt-1"
      >
        <div className="flex flex-wrap items-end gap-2.5 border-y border-line px-4 py-3">
          <SelectField
            label="Status"
            srOnlyLabel
            containerClassName="w-48"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All' },
              { value: 'DRAFT', label: 'Drafts' },
              { value: 'PENDING_MANAGER', label: 'With manager' },
              { value: 'PENDING_FINANCE', label: 'With Finance' },
              { value: 'APPROVED', label: 'Approved' },
              { value: 'REJECTED', label: 'Rejected' },
            ]}
          />
        </div>
        <ExpenseTable
          rows={data?.data ?? []}
          loading={isLoading}
          showEmployee={false}
          onOpen={setOpened}
          empty={
            <EmptyState
              icon={<Receipt />}
              title="No expenses yet"
              description="Add a claim with its receipt and it appears here, with where it stands."
              action={
                <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
                  New expense
                </Button>
              }
            />
          }
          actions={(row) => (
            <>
              {row.canSubmit && (
                <Button
                  size="sm"
                  variant="primary"
                  leadingIcon={<Send />}
                  loading={submit.isPending && submit.variables === row.id}
                  onClick={() => act(() => submit.mutateAsync(row.id), 'Sent to your manager')}
                >
                  Submit
                </Button>
              )}
              {row.canWithdraw && (
                <Button
                  size="sm"
                  variant="ghost"
                  leadingIcon={<Undo2 />}
                  onClick={() =>
                    act(() => withdraw.mutateAsync(row.id), 'Withdrawn — edit it and send again')
                  }
                >
                  Withdraw
                </Button>
              )}
              {row.canEdit && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={<Pencil />}
                    onClick={() => setEditing(row)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    leadingIcon={<Trash2 />}
                    onClick={() => setDeleting(row)}
                  >
                    Delete
                  </Button>
                </>
              )}
            </>
          )}
        />
        <Pager meta={data?.meta} onPage={setPage} />
      </Panel>

      {editing && (
        <ExpenseDialog
          expense={editing === 'new' ? undefined : editing}
          today={today}
          onClose={() => setEditing(null)}
        />
      )}
      {opened && (
        <ExpenseDrawer
          expenseId={opened.id}
          fallback={opened}
          onClose={() => setOpened(null)}
          onReject={() => undefined}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete this claim?"
        description={deleting ? `${deleting.category.name} · ${formatRupees(deleting.amount)}` : ''}
        confirmLabel="Delete"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          void act(() => remove.mutateAsync(deleting!.id), 'Claim deleted').finally(() =>
            setDeleting(null),
          )
        }
      />
    </div>
  );
}
