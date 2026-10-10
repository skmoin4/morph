import { Link, useNavigate } from 'react-router-dom';
import {
  CalendarOff,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Receipt,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import { Panel, PanelLink } from '../../components/ui/Panel';
import { MetricCard, MetricRow } from '../../components/ui/MetricCard';
import { Pill, StatusPill } from '../../components/ui/Pill';
import { Progress } from '../../components/ui/Progress';
import { Skeleton } from '../../components/ui/Skeleton';
import { cn } from '../../lib/cn';
import { formatCurrencyShort, formatDisplayDate } from '../../lib/format';
import { formatMinutes } from '../attendance/useAttendance';
import type { ManagerDashboard, WaitingItem } from './useDashboard';

const WAITING_ICON: Record<WaitingItem['type'], LucideIcon> = {
  TIMESHEET: Clock,
  LEAVE: CalendarOff,
  EXPENSE: Receipt,
  CORRECTION: UserCheck,
};
const WAITING_LABEL: Record<WaitingItem['type'], string> = {
  TIMESHEET: 'Timesheet',
  LEAVE: 'Leave',
  EXPENSE: 'Expense',
  CORRECTION: 'Correction',
};
const HEALTH_LABEL: Record<string, string> = {
  HEALTHY: 'Healthy',
  AT_RISK: 'At risk',
  CRITICAL: 'Critical',
};

export function ManagerSkeleton() {
  return (
    <div className="space-y-5" aria-busy>
      <MetricRow>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-card" />
        ))}
      </MetricRow>
      <div className="grid gap-5 xl:grid-cols-2">
        <Skeleton className="h-72 rounded-card" />
        <Skeleton className="h-72 rounded-card" />
      </div>
    </div>
  );
}

export function ManagerBody({ data }: { data: ManagerDashboard }) {
  const navigate = useNavigate();
  const { counts, team } = data;
  const today = team.today;
  const load = team.workload;
  const loggedTotal = load?.reduce((n, r) => n + r.logged, 0) ?? 0;
  const expectedTotal = load?.reduce((n, r) => n + r.expected, 0) ?? 0;
  const behindCount = load?.filter((r) => r.behind > 4).length ?? 0;

  return (
    <div className="space-y-5">
      <MetricRow className="xl:grid-cols-[repeat(4,minmax(0,1fr))]">
        <MetricCard
          label="Waiting for you"
          value={counts.total}
          state={counts.total ? 'warn' : 'good'}
          foot={`${counts.timesheets} time · ${counts.leave} leave · ${counts.expenses} exp. · ${counts.corrections} corr.`}
        />
        {today && (
          <MetricCard
            label="Team present today"
            value={`${today.present} / ${today.expected}`}
            state={today.expected > 0 && today.present === 0 ? 'neutral' : 'good'}
            foot={`${today.late} late · ${today.onLeave} on leave · ${today.notIn} not in`}
            onClick={() => navigate('/attendance')}
          />
        )}
        {load && (
          <MetricCard
            label="Team hours this week"
            value={`${Math.round(loggedTotal)} h`}
            state={behindCount ? 'warn' : 'good'}
            foot={`${Math.round(expectedTotal)} h expected so far`}
          />
        )}
        <MetricCard
          label="Timesheets not sent"
          value={team.unsubmittedLastWeek}
          state={team.unsubmittedLastWeek ? 'warn' : 'good'}
          foot="From last week, in your team"
        />
      </MetricRow>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Panel
          title="Waiting for your decision"
          subtitle="Oldest first. Each one opens where you can decide it."
        >
          {data.waiting.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-card bg-surface-2 px-4 py-8 text-center">
              <CheckCircle2 aria-hidden className="size-7 text-green" />
              <p className="text-body font-heavy text-ink">You are all caught up</p>
              <p className="text-sub text-muted">Nothing is waiting on you.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {data.waiting.map((w) => {
                const Icon = WAITING_ICON[w.type] ?? ClipboardCheck;
                return (
                  <li key={w.id}>
                    <Link
                      to={w.linkUrl}
                      className="flex gap-3 rounded-xl border border-line-soft bg-surface-2 p-3 transition-colors hover:bg-line-soft"
                    >
                      <span
                        aria-hidden
                        className="grid size-8 shrink-0 place-items-center rounded-lg bg-pill-blue-bg text-pill-blue-fg [&>svg]:size-4"
                      >
                        <Icon />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className="text-body font-heavy text-ink">
                            {w.person} · {w.title}
                          </span>
                          <Pill tone={w.ageDays >= 7 ? 'red' : w.ageDays >= 3 ? 'amber' : 'gray'}>
                            {w.ageDays === 0 ? 'Today' : `${w.ageDays}d`}
                          </Pill>
                        </span>
                        <span className="mt-0.5 block text-sub text-muted">
                          {WAITING_LABEL[w.type]}
                          {w.amount !== undefined && ` · ${formatCurrencyShort(w.amount)}`}
                          {w.detail && ` · ${w.detail}`}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {today && (
          <Panel
            title="Your team today"
            subtitle={`${team.size} direct report${team.size === 1 ? '' : 's'} and their scope`}
            action={<PanelLink href="/attendance">Open attendance →</PanelLink>}
            flush
          >
            {today.rows.length === 0 ? (
              <p className="px-4 pb-6 text-center text-sub text-muted">
                No one is in your team yet.
              </p>
            ) : (
              <ul className="max-h-[360px] divide-y divide-line overflow-y-auto">
                {today.rows.map((r) => (
                  <li key={r.employeeId} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-heavy text-ink">
                        {r.fullName}
                      </span>
                      <span className="block truncate text-sub text-muted">
                        {r.designation ?? r.employeeCode}
                        {r.firstInAt &&
                          ` · in ${new Date(r.firstInAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`}
                        {r.workedMinutes > 0 && ` · ${formatMinutes(r.workedMinutes)}`}
                      </span>
                    </span>
                    {r.flagged && <Pill tone="amber">Flagged</Pill>}
                    <StatusPill status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>

      {load && load.length > 0 && (
        <Panel
          title="Hours this week"
          subtitle="Logged against what each person should have by today. Most behind first."
          action={<PanelLink href="/timesheets">Open timesheets →</PanelLink>}
        >
          <ul className="grid gap-x-8 gap-y-3 md:grid-cols-2">
            {load.map((r) => {
              const pct = r.expected > 0 ? Math.min(100, (r.logged / r.expected) * 100) : 100;
              return (
                <li key={r.id}>
                  <div className="flex items-baseline justify-between gap-3 text-sub">
                    <span className="truncate font-heavy text-ink">{r.fullName}</span>
                    <span
                      className={cn(
                        'shrink-0 tabular-nums',
                        r.behind > 4 ? 'font-heavy text-amber' : 'text-muted',
                      )}
                    >
                      {r.logged} of {r.expected} h{r.behind > 4 && ` · ${r.behind} h behind`}
                    </span>
                  </div>
                  <Progress
                    className="mt-1"
                    risk={r.behind > 4}
                    value={pct}
                    label={`${r.fullName} hours this week`}
                  />
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <Panel
        flush
        title="Your projects"
        subtitle="The ones you manage, worst budget burn first."
        action={<PanelLink href="/projects">All projects →</PanelLink>}
        bodyClassName="pb-2"
      >
        {data.projects.length === 0 ? (
          <p className="px-4 pb-6 text-center text-sub text-muted">
            You do not manage any active project.
          </p>
        ) : (
          <div className="scroll-slim overflow-x-auto">
            <table className="w-full min-w-[620px] text-body">
              <thead className="text-left text-micro uppercase text-muted">
                <tr>
                  <th className="px-4 py-2 font-heavy">Project</th>
                  <th className="px-3 py-2 font-heavy">Tasks</th>
                  <th className="px-3 py-2 font-heavy">Hours burn</th>
                  <th className="px-3 py-2 font-heavy">Due</th>
                  <th className="px-3 py-2 font-heavy">Health</th>
                </tr>
              </thead>
              <tbody>
                {data.projects.map((p) => {
                  const risk = p.alertLevel > 0;
                  return (
                    <tr
                      key={p.id}
                      tabIndex={0}
                      onClick={() => navigate(`/projects/${p.id}`)}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(`/projects/${p.id}`)}
                      className="cursor-pointer border-t border-line hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
                    >
                      <td className="max-w-[260px] px-4 py-2.5">
                        <p className="truncate font-heavy text-ink" title={p.name}>
                          {p.name}
                        </p>
                        <p className="truncate text-sub text-muted">
                          {p.projectCode} · {p.client}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        {p.taskProgress === null ? (
                          <span className="text-sub text-muted">No tasks</span>
                        ) : (
                          <>
                            <Progress value={p.taskProgress} label={`${p.name} tasks`} />
                            <p className="mt-1 text-sub text-muted">
                              {p.taskProgress}% of {p.taskCount}
                              {p.overdueTasks > 0 && (
                                <span className="text-red"> · {p.overdueTasks} overdue</span>
                              )}
                            </p>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {p.burnPercent === null ? (
                          <span className="text-sub text-muted">No budget</span>
                        ) : (
                          <>
                            <Progress risk={risk} value={p.burnPercent} label={`${p.name} burn`} />
                            <p className={cn('mt-1 text-sub', risk ? 'text-amber' : 'text-muted')}>
                              {p.burnPercent}% · {p.actualHours} of {p.budgetHours} h
                            </p>
                          </>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-sub text-ink-2">
                        {p.endDate ? formatDisplayDate(p.endDate) : '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusPill status={p.health} label={HEALTH_LABEL[p.health]} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {(data.upcoming.milestones.length > 0 || data.upcoming.leave.length > 0) && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Milestones coming up" subtitle="Next 14 days, on your projects.">
            {data.upcoming.milestones.length === 0 ? (
              <p className="text-sub text-muted">None in the next two weeks.</p>
            ) : (
              <ul className="space-y-2">
                {data.upcoming.milestones.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line-soft bg-surface-2 px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-body font-heavy text-ink">{m.name}</span>
                      <span className="block truncate text-sub text-muted">
                        {m.project?.projectCode} · {formatDisplayDate(m.dueDate)}
                      </span>
                    </span>
                    <Pill tone={m.daysAway <= 2 ? 'amber' : 'gray'}>
                      {m.daysAway <= 0 ? 'Today' : `in ${m.daysAway}d`}
                    </Pill>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Team leave coming up" subtitle="Approved leave in the next 14 days.">
            {data.upcoming.leave.length === 0 ? (
              <p className="text-sub text-muted">No one in your team is away soon.</p>
            ) : (
              <ul className="space-y-2">
                {data.upcoming.leave.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line-soft bg-surface-2 px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-body font-heavy text-ink">
                        {l.person}
                      </span>
                      <span className="block truncate text-sub text-muted">
                        {formatDisplayDate(l.from)}
                        {l.to !== l.from && ` – ${formatDisplayDate(l.to)}`} · {l.days}{' '}
                        {l.days === 1 ? 'day' : 'days'}
                      </span>
                    </span>
                    <Pill tone="violet">{l.code}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
