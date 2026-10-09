import { CalendarPlus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { TabPanel, Tabs } from '../components/ui/Tabs';
import { useAuth } from '../providers/AuthProvider';
import { ApplyLeaveDialog } from '../features/leave/ApplyLeaveDialog';
import { ApprovalsTab } from '../features/leave/ApprovalsTab';
import { BalancesTab } from '../features/leave/BalancesTab';
import { CalendarTab } from '../features/leave/CalendarTab';
import { MyLeaveTab } from '../features/leave/MyLeaveTab';
import { useLeaveRequests } from '../features/leave/useLeave';

export function LeavePage() {
  const { user, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [applying, setApplying] = useState(params.get('apply') === '1');

  const hasProfile = !!user?.employeeId;
  const canApply = hasProfile && can('leave.create');
  const canApprove = can('leave.approve');

  // The count on Approvals is what is waiting on this person to decide.
  const { data: waiting } = useLeaveRequests({ toDecide: true, pageSize: 1 }, canApprove);

  const tabs = [
    ...(hasProfile ? [{ key: 'mine', label: 'My leave' }] : []),
    ...(canApprove
      ? [
          {
            key: 'approvals',
            label: 'Approvals',
            count: waiting?.meta.total ? waiting.meta.total : undefined,
          },
        ]
      : []),
    { key: 'calendar', label: 'Team calendar' },
    ...(canApprove ? [{ key: 'balances', label: 'Balances' }] : []),
  ];
  const requested = params.get('tab');
  const tab = tabs.some((t) => t.key === requested) ? requested! : tabs[0].key;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="People & Work"
        title="Leave"
        subtitle="Balances, requests and the team calendar."
        actions={
          canApply && (
            <Button
              variant="primary"
              leadingIcon={<CalendarPlus />}
              onClick={() => setApplying(true)}
            >
              Apply for leave
            </Button>
          )
        }
      />

      <Tabs
        tabs={tabs}
        value={tab}
        onChange={(key) => setParams(key === tabs[0].key ? {} : { tab: key }, { replace: true })}
      />

      <TabPanel>
        {tab === 'mine' && <MyLeaveTab />}
        {tab === 'approvals' && <ApprovalsTab />}
        {tab === 'calendar' && <CalendarTab />}
        {tab === 'balances' && <BalancesTab />}
      </TabPanel>

      {applying && (
        <ApplyLeaveDialog
          onClose={() => {
            setApplying(false);
            if (params.get('apply')) {
              const next = new URLSearchParams(params);
              next.delete('apply');
              setParams(next, { replace: true });
            }
          }}
        />
      )}
    </div>
  );
}
