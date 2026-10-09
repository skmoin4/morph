import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, AlertTriangle, FileCheck2, Clock, ShieldCheck } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { visibleGroups } from '../components/layout/navigation';
import { MetricCard, MetricRow } from '../components/ui/MetricCard';
import { Panel } from '../components/ui/Panel';
import { Pill } from '../components/ui/Pill';
import { formatDisplayDate } from '../lib/format';
import { useAuth } from '../providers/AuthProvider';
import { useBookingSummary } from '../features/bookings/useBookings';
import { useEmployees } from '../features/people/usePeople';

function greeting(hour: number): string {
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * A temporary landing page until the dashboards arrive (step 13).
 *
 * It shows only what exists today: who you are, the modules your role opens,
 * and the counts the current modules can already answer. Nothing here is
 * invented — a count appears only if the user may see the thing it counts.
 */
export function HomePage() {
  const { user, permissions, can } = useAuth();
  const navigate = useNavigate();

  const canSeeEmployees = can('employee.view');
  const canSeeBookings = can('booking.view');

  const employees = useEmployees({ status: 'ACTIVE', pageSize: 1 }, { enabled: canSeeEmployees });
  const summary = useBookingSummary(canSeeBookings);

  const firstName = user?.fullName.split(/\s+/)[0] ?? '';
  const now = new Date();

  const links = visibleGroups(permissions)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.to !== '/'),
    }))
    .filter((group) => group.items.length > 0);

  const attention: Array<{
    key: string;
    tone: 'red' | 'amber';
    icon: React.ReactNode;
    text: string;
    to: string;
  }> = [];
  if (summary.data && summary.data.emailOverdue > 0) {
    attention.push({
      key: 'overdue',
      tone: 'red',
      icon: <AlertTriangle />,
      text: `${summary.data.emailOverdue} verbal booking${summary.data.emailOverdue === 1 ? ' is' : 's are'} past the email reminder window`,
      to: '/bookings?filter=email-pending',
    });
  }
  if (summary.data && summary.data.awaitingApproval > 0 && can('booking.approve')) {
    attention.push({
      key: 'approval',
      tone: 'amber',
      icon: <ShieldCheck />,
      text: `${summary.data.awaitingApproval} booking${summary.data.awaitingApproval === 1 ? ' is' : 's are'} waiting for your approval`,
      to: '/bookings',
    });
  }
  if (summary.data && summary.data.draft > 0 && can('booking.confirm')) {
    attention.push({
      key: 'drafts',
      tone: 'amber',
      icon: <FileCheck2 />,
      text: `${summary.data.draft} draft booking${summary.data.draft === 1 ? '' : 's'} not yet confirmed`,
      to: '/bookings',
    });
  }

  const hasCounts = canSeeEmployees || canSeeBookings;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`Command Center · ${formatDisplayDate(now)}`}
        title={`${greeting(now.getHours())}, ${firstName}`}
        subtitle={
          <>
            You are signed in as <strong className="font-heavy text-ink-2">{user?.roleName}</strong>
            . The live dashboards arrive in a later step — until then, here is what you can do
            today.
          </>
        }
      />

      {hasCounts && (
        <MetricRow>
          {canSeeEmployees && (
            <MetricCard
              label="Employees"
              loading={employees.isLoading}
              value={employees.data?.meta.total ?? 0}
              foot="Active, in your scope"
              onClick={() => navigate('/people')}
            />
          )}
          {canSeeBookings && (
            <>
              <MetricCard
                label="Active bookings"
                loading={summary.isLoading}
                value={(summary.data?.draft ?? 0) + (summary.data?.awaitingApproval ?? 0)}
                foot="Draft or awaiting approval"
                onClick={() => navigate('/bookings')}
              />
              <MetricCard
                label="Projects"
                loading={summary.isLoading}
                value={summary.data?.activeProjects ?? 0}
                state="good"
                foot={`${summary.data?.projectCreated ?? 0} created from bookings`}
                onClick={() => navigate('/bookings?status=PROJECT_CREATED')}
              />
              <MetricCard
                label="Email pending"
                loading={summary.isLoading}
                value={summary.data?.emailPending ?? 0}
                state={summary.data?.emailPending ? 'warn' : 'neutral'}
                foot={
                  summary.data?.emailOverdue
                    ? `Verbal · ${summary.data.emailOverdue} overdue`
                    : 'Verbal · none overdue'
                }
                onClick={() => navigate('/bookings?filter=email-pending')}
              />
            </>
          )}
        </MetricRow>
      )}

      {attention.length > 0 && (
        <Panel title="Needs attention" subtitle="Reminders only — nothing here blocks your work.">
          <ul className="space-y-2">
            {attention.map((item) => (
              <li key={item.key}>
                <Link
                  to={item.to}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line-soft bg-surface-2 p-3 transition-colors hover:bg-line-soft"
                >
                  <span className="flex min-w-0 items-center gap-2.5 text-body text-ink">
                    <Pill tone={item.tone} icon={item.icon}>
                      {item.tone === 'red' ? 'Overdue' : 'To do'}
                    </Pill>
                    <span className="truncate">{item.text}</span>
                  </span>
                  <ArrowRight aria-hidden className="size-4 shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        title="Your modules"
        subtitle="Everything your role can open. Greyed items are not built yet."
      >
        {links.length === 0 ? (
          <p className="text-sub text-muted">
            Your role has no modules assigned yet. Ask an administrator to grant access.
          </p>
        ) : (
          <div className="space-y-5">
            {links.map((group) => (
              <section key={group.label}>
                <h3 className="mb-2 text-micro font-heavy uppercase text-muted">{group.label}</h3>
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {group.items.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      className="flex items-center gap-3 rounded-card border border-line bg-surface p-3 shadow-card-soft transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-card"
                    >
                      <span
                        aria-hidden
                        className="grid size-9 shrink-0 place-items-center rounded-xl bg-pill-blue-bg text-blue [&>svg]:size-[18px]"
                      >
                        <item.icon />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-body font-heavy text-ink">
                        {item.label}
                      </span>
                      {!item.ready && (
                        <Pill tone="gray">
                          <Clock aria-hidden className="size-3" />
                          Soon
                        </Pill>
                      )}
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
