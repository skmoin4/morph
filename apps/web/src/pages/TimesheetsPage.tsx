import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { TabPanel, Tabs } from '../components/ui/Tabs';
import { useAuth } from '../providers/AuthProvider';
import { ApprovalsTab } from '../features/time/ApprovalsTab';
import { MyWeekTab } from '../features/time/MyWeekTab';
import { useTimesheets } from '../features/time/useTime';

export function TimesheetsPage() {
  const { user, can } = useAuth();
  const [params, setParams] = useSearchParams();

  const hasProfile = !!user?.employeeId;
  const canApprove = can('timesheet.approve');

  const { data: waiting } = useTimesheets({ toDecide: true, pageSize: 1 }, canApprove);

  const tabs = [
    ...(hasProfile ? [{ key: 'mine', label: 'My week' }] : []),
    ...(canApprove
      ? [
          {
            key: 'approvals',
            label: 'Approvals',
            count: waiting?.meta.total ? waiting.meta.total : undefined,
          },
        ]
      : []),
  ];
  const requested = params.get('tab');
  const tab = tabs.some((t) => t.key === requested) ? requested! : tabs[0]?.key;
  const week = params.get('week') ?? undefined;

  const setTab = (key: string) => {
    const next = new URLSearchParams(params);
    if (key === tabs[0].key) next.delete('tab');
    else next.set('tab', key);
    setParams(next, { replace: true });
  };
  const setWeek = (value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set('week', value);
    else next.delete('week');
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="People & Work"
        title="Timesheets"
        subtitle="Run the timer or log time, then submit the week for approval."
      />

      {tabs.length > 0 && <Tabs tabs={tabs} value={tab} onChange={setTab} />}

      <TabPanel>
        {tab === 'mine' && <MyWeekTab weekStart={week} onWeekChange={setWeek} />}
        {tab === 'approvals' && <ApprovalsTab />}
      </TabPanel>
    </div>
  );
}
