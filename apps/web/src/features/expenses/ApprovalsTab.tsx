import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { ColumnDef } from '@tanstack/react-table';
import { Check, ClipboardCheck, Download, Eye, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField, TextField } from '../../components/ui/Field';
import { Panel } from '../../components/ui/Panel';
import { api, ApiRequestError } from '../../lib/api';
import { useAuth } from '../../providers/AuthProvider';
import { ExpenseDrawer } from './ExpenseDrawer';
import { ExpenseTable } from './ExpenseTable';
import { Pager } from './MyExpensesTab';
import { RejectExpenseDialog } from './RejectExpenseDialog';
import {
  formatRupees,
  useBulkDecideExpenses,
  useDecideExpense,
  useExpenseSummary,
  useExpenses,
  type ExpenseRow,
} from './useExpenses';

/** Claims from the people you approve for. Managers take the first step, Finance the second. */
export function ApprovalsTab() {
  const { can } = useAuth();
  const [view, setView] = useState('toDecide');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<ExpenseRow | null>(null);
  const [rejecting, setRejecting] = useState<ExpenseRow[] | null>(null);

  const filters = {
    toDecide: view === 'toDecide',
    status: view === 'toDecide' || view === 'ALL' ? undefined : view,
    q: q || undefined,
    page,
  };
  const { data, isLoading } = useExpenses(filters);
  const { data: summary } = useExpenseSummary();
  const decide = useDecideExpense();
  const bulk = useBulkDecideExpenses();

  const rows = data?.data ?? [];
  const decidable = rows.filter((r) => r.canDecide);
  const allSelected = decidable.length > 0 && decidable.every((r) => selected.has(r.id));

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function approveOne(row: ExpenseRow) {
    try {
      const res = await decide.mutateAsync({
        id: row.id,
        input: { decision: 'APPROVED', comment: null },
      });
      toast.success(
        res.status === 'PENDING_FINANCE' ? 'Approved — now with Finance' : 'Approved — cost posted',
      );
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not approve.');
    }
  }

  async function approveSelected() {
    const ids = [...selected].filter((id) => rows.some((r) => r.id === id && r.canDecide));
    if (ids.length === 0) return;
    try {
      const res = await bulk.mutateAsync({ ids, decision: 'APPROVED' });
      if (res.failed === 0) toast.success(`Approved ${res.done} claim${res.done === 1 ? '' : 's'}`);
      else
        toast.warning(
          `Approved ${res.done}; ${res.failed} could not be: ${res.results.find((r) => !r.ok)?.message ?? ''}`,
        );
      setSelected(new Set());
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not approve.');
    }
  }

  async function exportSheet() {
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.toDecide) params.set('toDecide', 'true');
      if (q) params.set('q', q);
      await api.download(`/expenses/export?${params.toString()}`, 'expenses.xlsx');
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
            aria-label={`Select ${row.original.employee.fullName}'s claim`}
            className="size-4 accent-blue"
            checked={selected.has(row.original.id)}
            onChange={() => toggle(row.original.id)}
          />
        ) : null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, allSelected, decidable.length],
  );

  return (
    <Panel
      flush
      title="Expense approvals"
      subtitle="Managers approve first; Finance approves second and posts the cost to the project."
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
        <div className="flex flex-wrap items-end gap-2.5">
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
              {
                value: 'toDecide',
                label: `Waiting on me${summary ? ` (${summary.toDecide.count})` : ''}`,
              },
              { value: 'PENDING_MANAGER', label: 'With managers' },
              { value: 'PENDING_FINANCE', label: 'With Finance' },
              { value: 'APPROVED', label: 'Approved' },
              { value: 'REJECTED', label: 'Rejected' },
              { value: 'ALL', label: 'Everything' },
            ]}
          />
          <TextField
            label="Search"
            srOnlyLabel
            containerClassName="w-56"
            placeholder="Name, code or note…"
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
        </div>
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

      <ExpenseTable
        rows={rows}
        loading={isLoading}
        showEmployee
        select={select}
        onOpen={setOpened}
        empty={
          <EmptyState
            icon={<ClipboardCheck />}
            title={view === 'toDecide' ? 'Nothing is waiting on you' : 'No claims here'}
            description="When someone submits a claim, it appears here for the right approver."
          />
        }
        actions={(row) => (
          <>
            <Button size="sm" variant="ghost" leadingIcon={<Eye />} onClick={() => setOpened(row)}>
              Review
            </Button>
            {row.canDecide && (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  leadingIcon={<Check />}
                  loading={decide.isPending && decide.variables?.id === row.id}
                  onClick={() => approveOne(row)}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  leadingIcon={<X />}
                  onClick={() => setRejecting([row])}
                >
                  Reject
                </Button>
              </>
            )}
          </>
        )}
      />
      {data && (
        <div className="border-t border-line px-4 py-2 text-sub text-muted">
          {data.meta.total} claim{data.meta.total === 1 ? '' : 's'} ·{' '}
          {formatRupees(data.meta.totalAmount)}
        </div>
      )}
      <Pager meta={data?.meta} onPage={setPage} />

      {opened && (
        <ExpenseDrawer
          expenseId={opened.id}
          fallback={opened}
          onClose={() => setOpened(null)}
          onReject={(row) => {
            setOpened(null);
            setRejecting([row]);
          }}
        />
      )}
      {rejecting && (
        <RejectExpenseDialog
          rows={rejecting}
          onClose={() => setRejecting(null)}
          onDone={() => setSelected(new Set())}
        />
      )}
    </Panel>
  );
}
