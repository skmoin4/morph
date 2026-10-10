import { Link } from 'react-router-dom';
import { CalendarDays, CheckCircle2, ListTodo, PartyPopper } from 'lucide-react';
import { Panel, PanelLink } from '../../components/ui/Panel';
import { MetricCard, MetricRow } from '../../components/ui/MetricCard';
import { humanizeStatus, Pill, StatusPill } from '../../components/ui/Pill';
import { Skeleton } from '../../components/ui/Skeleton';
import { cn } from '../../lib/cn';
import { formatDisplayDate } from '../../lib/format';
import type { MyDay } from './useDashboard';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekday = (iso: string) => WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()];
const dayOfMonth = (iso: string) => Number(iso.slice(8, 10));
const h = (v: number) => `${Math.round(v * 10) / 10} h`;

const DOT: Record<string, string> = {
  PRESENT: 'bg-green',
  LATE: 'bg-amber',
  HALF_DAY: 'bg-amber',
  ABSENT: 'bg-red',
  ON_LEAVE: 'bg-violet',
  HOLIDAY: 'bg-blue',
  WEEKLY_OFF: 'bg-line',
};

const TONE_BAR: Record<string, string> = {
  red: 'border-red/30 bg-pill-red-bg/60',
  amber: 'border-amber/40 bg-pill-amber-bg/60',
  blue: 'border-blue/30 bg-pill-blue-bg/60',
};

export function MyDaySkeleton() {
  return (
    <div className="space-y-5" aria-busy>
      <MetricRow className="xl:grid-cols-[repeat(4,minmax(0,1fr))]">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-card" />
        ))}
      </MetricRow>
      <Skeleton className="h-56 rounded-card" />
    </div>
  );
}

export function MyDayBody({ data }: { data: MyDay }) {
  const hours = data.hours;
  const behind = hours ? Math.max(0, hours.expectedSoFar - hours.week) : 0;
  const maxDay = Math.max(8, ...data.week.map((d) => d.hours));
  const waitingTotal =
    data.waiting.leave +
    data.waiting.expenses +
    data.waiting.corrections +
    (data.waiting.timesheet ? 1 : 0);

  return (
    <div className="space-y-5">
      <MetricRow className="xl:grid-cols-[repeat(4,minmax(0,1fr))]">
        {hours && (
          <MetricCard
            label="Hours this week"
            value={h(hours.week)}
            state={behind > 8 ? 'warn' : 'neutral'}
            foot={
              behind > 0
                ? `${h(behind)} behind`
                : `On track · ${h(hours.expectedSoFar)} expected so far`
            }
          />
        )}
        {hours && (
          <MetricCard
            label="Billable"
            value={h(hours.billable)}
            state="good"
            foot={
              hours.week > 0
                ? `${Math.round((hours.billable / hours.week) * 100)}% of logged`
                : 'Nothing logged yet'
            }
          />
        )}
        <MetricCard
          label="Open tasks"
          value={data.tasks.length}
          state={data.tasks.some((t) => t.overdue) ? 'warn' : 'neutral'}
          foot={
            data.tasks.some((t) => t.overdue)
              ? `${data.tasks.filter((t) => t.overdue).length} overdue`
              : `Across ${data.projects} project${data.projects === 1 ? '' : 's'}`
          }
        />
        <MetricCard
          label="Waiting on others"
          value={waitingTotal}
          foot="Leave, claims, timesheet"
        />
      </MetricRow>

      {data.todo.length > 0 && (
        <Panel title="To do" subtitle="Small things that keep your week and your pay clean.">
          <ul className="space-y-2">
            {data.todo.map((t) => (
              <li key={t.id}>
                <Link
                  to={t.linkUrl}
                  className={cn(
                    'block rounded-xl border p-3 transition-colors hover:brightness-95',
                    TONE_BAR[t.tone] ?? TONE_BAR.blue,
                  )}
                >
                  <span className="block text-body font-heavy text-ink">{t.title}</span>
                  <span className="mt-0.5 block text-sub text-ink-2">{t.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel
          title="This week"
          subtitle={`${formatDisplayDate(data.weekStart)} – ${formatDisplayDate(data.weekEnd)}`}
          action={<PanelLink href="/timesheets">Open timesheet →</PanelLink>}
        >
          <ol className="grid grid-cols-7 gap-1.5">
            {data.week.map((d) => (
              <li
                key={d.date}
                className={cn(
                  'flex flex-col items-center rounded-xl border px-1 py-2 text-center',
                  d.isToday ? 'border-blue bg-pill-blue-bg/50' : 'border-line bg-surface',
                  d.isFuture && 'opacity-60',
                )}
                aria-label={`${formatDisplayDate(d.date)}: ${h(d.hours)}${d.attendance ? `, ${d.attendance.toLowerCase().replace(/_/g, ' ')}` : ''}`}
              >
                <span className="text-micro font-heavy uppercase text-muted">
                  {weekday(d.date)}
                </span>
                <span className="text-body font-heavy text-ink">{dayOfMonth(d.date)}</span>
                <span className="mt-2 flex h-14 w-3 items-end rounded-full bg-track">
                  <span
                    className="w-full rounded-full bg-blue"
                    style={{ height: `${Math.min(100, (d.hours / maxDay) * 100)}%` }}
                  />
                </span>
                <span className="mt-1.5 text-sub font-heavy tabular-nums text-ink-2">
                  {d.hours > 0 ? h(d.hours) : '—'}
                </span>
                {d.attendance && (
                  <span
                    title={humanizeStatus(d.attendance)}
                    className={cn('mt-1.5 size-2 rounded-full', DOT[d.attendance] ?? 'bg-muted-2')}
                  />
                )}
              </li>
            ))}
          </ol>
        </Panel>

        <Panel
          title="Leave balance"
          subtitle="Available now, for this calendar year."
          action={<PanelLink href="/leave">Apply →</PanelLink>}
        >
          {data.leaveBalances.length === 0 ? (
            <p className="text-sub text-muted">No leave types are set up for you yet.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-2.5">
              {data.leaveBalances.map((b) => (
                <li key={b.code} className="rounded-card border border-line bg-surface-2 p-3">
                  <p className="text-micro font-heavy uppercase text-muted">{b.type}</p>
                  <p className="mt-1 text-[22px] font-black leading-tight text-ink">
                    {b.available}
                    <span className="ml-1 text-sub font-normal text-muted">of {b.total}</span>
                  </p>
                  {b.pending > 0 && (
                    <p className="text-sub text-amber">{b.pending} pending approval</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel
          title="My tasks"
          subtitle="Assigned to you, overdue first."
          action={<PanelLink href="/tasks">All tasks →</PanelLink>}
        >
          {data.tasks.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-card bg-surface-2 px-4 py-8 text-center">
              <ListTodo aria-hidden className="size-7 text-muted" />
              <p className="text-body font-heavy text-ink">No open tasks</p>
              <p className="text-sub text-muted">Tasks assigned to you will appear here.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {data.tasks.map((t) => (
                <li key={t.id}>
                  <Link
                    to={t.project ? `/projects/${t.project.id}` : '/tasks'}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line-soft bg-surface-2 p-3 transition-colors hover:bg-line-soft"
                  >
                    <span className="min-w-[60%] flex-1">
                      <span className="block truncate text-body font-heavy text-ink">
                        {t.title}
                      </span>
                      <span className="block truncate text-sub text-muted">
                        {t.project?.projectCode ?? 'No project'}
                        {t.estimatedHours !== null &&
                          ` · ${h(t.loggedHours)} of ${h(t.estimatedHours)}`}
                      </span>
                    </span>
                    {t.dueDate && (
                      <Pill tone={t.overdue ? 'red' : t.dueSoon ? 'amber' : 'gray'}>
                        {t.overdue ? 'Overdue · ' : ''}
                        {formatDisplayDate(t.dueDate)}
                      </Pill>
                    )}
                    <StatusPill status={t.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Coming up" subtitle="Holidays and your approved leave.">
          {data.upcoming.holidays.length === 0 && data.upcoming.leave.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-card bg-surface-2 px-4 py-8 text-center">
              <CheckCircle2 aria-hidden className="size-7 text-green" />
              <p className="text-sub text-muted">Nothing scheduled in the next few weeks.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {data.upcoming.holidays.map((hd) => (
                <li
                  key={hd.id}
                  className="flex items-center gap-3 rounded-xl border border-line-soft bg-surface-2 px-3 py-2"
                >
                  <PartyPopper aria-hidden className="size-4 shrink-0 text-blue" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-heavy text-ink">{hd.name}</span>
                    <span className="block text-sub text-muted">{formatDisplayDate(hd.date)}</span>
                  </span>
                  <Pill tone="blue">{hd.daysAway === 0 ? 'Today' : `in ${hd.daysAway}d`}</Pill>
                </li>
              ))}
              {data.upcoming.leave.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center gap-3 rounded-xl border border-line-soft bg-surface-2 px-3 py-2"
                >
                  <CalendarDays aria-hidden className="size-4 shrink-0 text-violet" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-heavy text-ink">{l.type}</span>
                    <span className="block text-sub text-muted">
                      {formatDisplayDate(l.from)}
                      {l.to !== l.from && ` – ${formatDisplayDate(l.to)}`}
                    </span>
                  </span>
                  <StatusPill status={l.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
