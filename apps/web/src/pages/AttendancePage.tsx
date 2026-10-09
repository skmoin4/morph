import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { TabPanel, Tabs } from '../components/ui/Tabs';
import { useAuth } from '../providers/AuthProvider';
import { BoardTab } from '../features/attendance/BoardTab';
import { ClockCard } from '../features/attendance/ClockCard';
import { RegisterTab } from '../features/attendance/RegisterTab';
import { RequestsTab } from '../features/attendance/RequestsTab';
import { useRegularisations } from '../features/attendance/useAttendance';

export function AttendancePage() {
  const { user, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'board';

  // The count on the tab is what waits on this person to decide.
  const canDecide = can('attendance.approve');
  const { data: waiting } = useRegularisations({ status: 'PENDING', pageSize: 1 });
  const pendingCount = waiting?.meta.total;

  const tabs = [
    { key: 'board', label: 'Today' },
    { key: 'register', label: 'Register' },
    {
      key: 'requests',
      label: 'Corrections',
      count: canDecide && pendingCount ? pendingCount : undefined,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="People & Work"
        title="Attendance"
        subtitle="Clock in, see who is in today, and keep the month’s register straight."
      />

      {user?.employeeId && can('attendance.create') && <ClockCard />}

      <Tabs
        tabs={tabs}
        value={tab}
        onChange={(key) => setParams(key === 'board' ? {} : { tab: key }, { replace: true })}
      />

      <TabPanel>
        {tab === 'board' && <BoardTab />}
        {tab === 'register' && <RegisterTab />}
        {tab === 'requests' && <RequestsTab />}
      </TabPanel>
    </div>
  );
}
