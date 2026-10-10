import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { TabPanel, Tabs } from '../components/ui/Tabs';
import { useAuth } from '../providers/AuthProvider';
import { ApprovalsTab } from '../features/expenses/ApprovalsTab';
import { MyExpensesTab } from '../features/expenses/MyExpensesTab';
import { ReimbursementsTab } from '../features/expenses/ReimbursementsTab';
import { useExpenseSummary } from '../features/expenses/useExpenses';

export function ExpensesPage() {
  const { user, can } = useAuth();
  const [params, setParams] = useSearchParams();

  const hasProfile = !!user?.employeeId;
  const canClaim = hasProfile && can('expense.create');
  const canApprove = can('expense.approve');
  const canPay = can('expense.reimburse');
  const { data: summary } = useExpenseSummary();

  const tabs = [
    ...(canClaim || hasProfile ? [{ key: 'mine', label: 'My expenses' }] : []),
    ...(canApprove
      ? [
          {
            key: 'approvals',
            label: 'Approvals',
            count: summary?.toDecide.count ? summary.toDecide.count : undefined,
          },
        ]
      : []),
    ...(canPay
      ? [
          {
            key: 'reimburse',
            label: 'Reimbursements',
            count: summary?.toReimburse.count ? summary.toReimburse.count : undefined,
          },
        ]
      : []),
  ];
  const requested = params.get('tab');
  const tab = tabs.some((t) => t.key === requested) ? requested! : tabs[0]?.key;
  const today = new Date().toISOString().slice(0, 10);

  const setTab = (key: string) => {
    const next = new URLSearchParams(params);
    if (key === tabs[0].key) next.delete('tab');
    else next.set('tab', key);
    next.delete('new');
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Money"
        title="Expenses"
        subtitle="Claim an expense with its receipt; your manager and then Finance approve it."
      />
      {tabs.length > 0 && <Tabs tabs={tabs} value={tab} onChange={setTab} />}
      <TabPanel>
        {tab === 'mine' && <MyExpensesTab today={today} startNew={params.get('new') === '1'} />}
        {tab === 'approvals' && <ApprovalsTab />}
        {tab === 'reimburse' && <ReimbursementsTab />}
      </TabPanel>
    </div>
  );
}
