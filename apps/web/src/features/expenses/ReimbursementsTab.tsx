import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { Banknote, Check, Download } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField } from '../../components/ui/Field';
import { MetricCard, MetricRow } from '../../components/ui/MetricCard';
import { Panel } from '../../components/ui/Panel';
import { api, ApiRequestError } from '../../lib/api';
import { useAuth } from '../../providers/AuthProvider';
import { ExpenseDrawer } from './ExpenseDrawer';
import { ExpenseTable } from './ExpenseTable';
import { Pager } from './MyExpensesTab';
import {
  formatRupees,
  useExpenseSummary,
  useExpenses,
  useReimburse,
  type ExpenseRow,
} from './useExpenses';

/** Finance: approved claims, and paying them out. */
export function ReimbursementsTab() {
  const { can } = useAuth();
  const [view, setView] = useState('toReimburse');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<ExpenseRow | null>(null);

  const filters =
    view === 'toReimburse'
      ? { toReimburse: true, page }
      : { status: 'APPROVED', reimbursement: 'REIMBURSED', page };
  const { data, isLoading } = useExpenses(filters);
  const { data: summary } = useExpenseSummary();
  const reimburse = useReimburse();

  const rows = data?.data ?? [];
  const payable = rows.filter((r) => r.canReimburse);
  const allSelected = payable.length > 0 && payable.every((r) => selected.has(r.id));
  const chosenTotal = rows
    .filter((r) => selected.has(r.id))
    .reduce((a, r) => a + Number(r.amount), 0);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function pay(ids: string[]) {
    try {
      const res = await reimburse.mutateAsync(ids);
      if (res.failed === 0)
        toast.success(`Marked ${res.done} claim${res.done === 1 ? '' : 's'} as reimbursed`);
      else
        toast.warning(
          `${res.done} paid; ${res.failed} could not be: ${res.results.find((r) => !r.ok)?.message ?? ''}`,
        );
      setSelected(new Set());
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not mark as paid.');
    }
  }

  async function exportSheet() {
    try {
      const qs =
        view === 'toReimburse' ? 'toReimburse=true' : 'status=APPROVED&reimbursement=REIMBURSED';
      await api.download(`/expenses/export?${qs}`, 'reimbursements.xlsx');
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not export.');
    }
  }

  const select = useMemo<ColumnDef<ExpenseRow, unknown>>(
    () => ({
      header: () => (
        <input
          type="checkbox"
          aria-label="Select all"
          className="size-4 accent-blue"
          disabled={payable.length === 0}
          checked={allSelected}
          onChange={() => setSelected(allSelected ? new Set() : new Set(payable.map((r) => r.id)))}
        />
      ),
      id: 'select',
      enableSorting: false,
      cell: ({ row }) =>
        row.original.canReimburse ? (
          <input
            type="checkbox"
            aria-label={`Select ${row.original.employee.fullName}'s claim`}
            className="size-4 accent-blue"
            checked={selected.has(row.original.id)}
            onChange={() => toggle(row.original.id)}
          />
        ) : null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, allSelected, payable.length],
  );

  return (
    <div className="space-y-5">
      <MetricRow>
        <MetricCard
          label="To pay out"
          value={summary ? formatRupees(summary.toReimburse.amount) : ''}
          state={summary && summary.toReimburse.count > 0 ? 'warn' : 'neutral'}
          foot={
            summary
              ? `${summary.toReimburse.count} approved claim${summary.toReimburse.count === 1 ? '' : 's'}`
              : ' '
          }
          loading={!summary}
        />
        <MetricCard
          label="Waiting for Finance"
          value={summary?.toDecide.count ?? 0}
          foot="Claims waiting on your approval"
          loading={!summary}
        />
      </MetricRow>

      <Panel
        flush
        title="Reimbursements"
        subtitle="Approved claims. Mark them reimbursed after the payout; the employee is told."
        action={
          can('expense.export') && (
            <Button size="sm" variant="ghost" leadingIcon={<Download />} onClick={exportSheet}>
              Export
            </Button>
          )
        }
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
              { value: 'toReimburse', label: 'Waiting to be paid' },
              { value: 'paid', label: 'Paid out' },
            ]}
          />
          {selected.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sub text-muted">
                {selected.size} selected · {formatRupees(chosenTotal)}
              </span>
              <Button
                size="sm"
                variant="primary"
                leadingIcon={<Check />}
                loading={reimburse.isPending}
                onClick={() => pay([...selected])}
              >
                Mark reimbursed
              </Button>
            </div>
          )}
        </div>
        <ExpenseTable
          rows={rows}
          loading={isLoading}
          showEmployee
          select={select}
          onOpen={setOpened}
          empty={
            <EmptyState
              icon={<Banknote />}
              title={view === 'toReimburse' ? 'Nothing to pay out' : 'Nothing paid yet'}
              description="Approved claims appear here until they are reimbursed."
            />
          }
        />
        <Pager meta={data?.meta} onPage={setPage} />
      </Panel>

      {opened && (
        <ExpenseDrawer
          expenseId={opened.id}
          fallback={opened}
          onClose={() => setOpened(null)}
          onReject={() => undefined}
        />
      )}
    </div>
  );
}
