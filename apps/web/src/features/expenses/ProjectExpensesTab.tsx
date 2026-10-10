import { useState } from 'react';
import { Receipt } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { MetricCard, MetricRow } from '../../components/ui/MetricCard';
import { Panel } from '../../components/ui/Panel';
import { ExpenseDrawer } from './ExpenseDrawer';
import { ExpenseTable } from './ExpenseTable';
import { Pager } from './MyExpensesTab';
import { formatRupees, useExpenses, type ExpenseRow } from './useExpenses';

/** Project 360 → Expenses: the claims charged to this project, within what you may see. */
export function ProjectExpensesTab({ projectId }: { projectId: string }) {
  const [page, setPage] = useState(1);
  const [opened, setOpened] = useState<ExpenseRow | null>(null);
  const approved = useExpenses({ projectId, status: 'APPROVED', pageSize: 1 });
  const { data, isLoading } = useExpenses({ projectId, page });

  return (
    <div className="space-y-5">
      <MetricRow>
        <MetricCard
          label="Approved & on the ledger"
          value={approved.data ? formatRupees(approved.data.meta.totalAmount) : ''}
          foot={
            approved.data
              ? `${approved.data.meta.total} claim${approved.data.meta.total === 1 ? '' : 's'}`
              : ' '
          }
          loading={!approved.data}
        />
        <MetricCard
          label="All claims"
          value={data ? formatRupees(data.meta.totalAmount) : ''}
          foot={data ? `${data.meta.total} in all, any stage` : ' '}
          loading={!data}
        />
      </MetricRow>
      <Panel
        flush
        title="Expense claims"
        subtitle="Approved claims become project cost."
        bodyClassName="mt-1"
      >
        <ExpenseTable
          rows={data?.data ?? []}
          loading={isLoading}
          showEmployee
          onOpen={setOpened}
          empty={
            <EmptyState
              icon={<Receipt />}
              title="No claims on this project"
              description="Claims against the project appear here."
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
