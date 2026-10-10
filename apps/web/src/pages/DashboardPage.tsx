import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LayoutDashboard, RefreshCw } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { SelectField } from '../components/ui/Field';
import { Tabs } from '../components/ui/Tabs';
import { ApiRequestError } from '../lib/api';
import { formatDisplayDate } from '../lib/format';
import { useAuth } from '../providers/AuthProvider';
import { ClockCard } from '../features/attendance/ClockCard';
import { ExecutiveBody, ExecutiveSkeleton } from '../features/dashboard/ExecutiveDashboard';
import { ManagerBody, ManagerSkeleton } from '../features/dashboard/ManagerDashboard';
import { MyDayBody, MyDaySkeleton } from '../features/dashboard/MyDayDashboard';
import {
  useDashboardHome,
  useExecutiveDashboard,
  useManagerDashboard,
  useMyDay,
  type DashboardKind,
} from '../features/dashboard/useDashboard';

const TAB_LABEL: Record<DashboardKind, string> = {
  EXECUTIVE: 'Executive',
  MANAGER: 'Manager',
  MY_DAY: 'My Day',
};
const EYEBROW: Record<DashboardKind, string> = {
  EXECUTIVE: 'Executive command center',
  MANAGER: 'Manager view',
  MY_DAY: 'My day',
};
const SUBTITLE: Record<DashboardKind, string> = {
  EXECUTIVE: 'One view of sales, people, project delivery, work and cost.',
  MANAGER: 'What is waiting on you, how your team is doing, and where your projects stand.',
  MY_DAY: 'Your hours, tasks and leave, and what to do next.',
};

function greeting(hour: number): string {
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function ErrorBox({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message =
    error instanceof ApiRequestError && error.status === 403
      ? 'You do not have access to this dashboard.'
      : 'The dashboard could not be loaded.';
  return (
    <EmptyState
      icon={<LayoutDashboard />}
      title={message}
      description="Check your connection and try again."
      action={
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      }
    />
  );
}

/**
 * The landing page. Which dashboards a person gets comes from the server
 * (`/dashboard/home`), so the tabs always match what their role may see; the
 * first tab is the one that suits their role best.
 */
export function DashboardPage() {
  const { user, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const home = useDashboardHome();
  const [officeId, setOfficeId] = useState<string>('');

  const available = home.data?.dashboards ?? [];
  const requested = params.get('view') as DashboardKind | null;
  const kind: DashboardKind | null =
    requested && available.includes(requested) ? requested : (home.data?.kind ?? null);

  const executive = useExecutiveDashboard(officeId || undefined, kind === 'EXECUTIVE');
  const manager = useManagerDashboard(kind === 'MANAGER');
  const myDay = useMyDay(kind === 'MY_DAY');

  // A person without a linked employee record has no "My Day" to show.
  const active = kind === 'EXECUTIVE' ? executive : kind === 'MANAGER' ? manager : myDay;

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const firstName = user?.fullName.split(/\s+/)[0] ?? '';
  const offices = executive.data?.offices ?? [];

  const actions = (
    <>
      {kind === 'EXECUTIVE' && offices.length > 1 && (
        <SelectField
          label="Office"
          srOnlyLabel
          containerClassName="w-44"
          value={officeId}
          onChange={(e) => setOfficeId(e.target.value)}
          options={[
            { value: '', label: 'All offices' },
            ...offices.map((o) => ({ value: o.id, label: o.name })),
          ]}
        />
      )}
      <Button
        variant="secondary"
        leadingIcon={<RefreshCw className={active.isFetching ? 'animate-spin' : undefined} />}
        onClick={() => void active.refetch()}
        disabled={!kind}
      >
        Refresh
      </Button>
    </>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${kind ? EYEBROW[kind] : 'Command center'} · ${formatDisplayDate(now)}`}
        title={`${greeting(now.getHours())}, ${firstName}`}
        subtitle={kind ? SUBTITLE[kind] : undefined}
        actions={actions}
      />

      {available.length > 1 && kind && (
        <Tabs
          tabs={available.map((k) => ({ key: k, label: TAB_LABEL[k] }))}
          value={kind}
          onChange={(k) => setParams(k === home.data?.kind ? {} : { view: k }, { replace: true })}
        />
      )}

      {user?.employeeId && can('attendance.create') && <ClockCard />}

      {home.isError ? (
        <ErrorBox error={home.error} onRetry={() => void home.refetch()} />
      ) : !kind ? (
        home.isLoading ? (
          <ExecutiveSkeleton />
        ) : (
          <EmptyState
            icon={<LayoutDashboard />}
            title="No dashboard for your role yet"
            description="Ask an administrator to grant dashboard access."
          />
        )
      ) : active.isError ? (
        <ErrorBox error={active.error} onRetry={() => void active.refetch()} />
      ) : kind === 'EXECUTIVE' ? (
        executive.data ? (
          <ExecutiveBody data={executive.data} />
        ) : (
          <ExecutiveSkeleton />
        )
      ) : kind === 'MANAGER' ? (
        manager.data ? (
          <ManagerBody data={manager.data} />
        ) : (
          <ManagerSkeleton />
        )
      ) : myDay.data ? (
        <MyDayBody data={myDay.data} />
      ) : (
        <MyDaySkeleton />
      )}
    </div>
  );
}
