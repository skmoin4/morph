import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Banknote, CheckCircle2, ClipboardCheck, Info, Mail } from 'lucide-react';
import { Panel, PanelLink } from '../../components/ui/Panel';
import { MetricCard, MetricRow } from '../../components/ui/MetricCard';
import { Pill, StatusPill } from '../../components/ui/Pill';
import { Progress } from '../../components/ui/Progress';
import { Skeleton } from '../../components/ui/Skeleton';
import { cn } from '../../lib/cn';
import { formatCurrencyShort, formatDisplayDate, formatIndianNumber } from '../../lib/format';
import { ColumnChart, type ColumnSeries } from './ColumnChart';
import type { ActionItem, ExecutiveDashboard } from './useDashboard';

const money = (v: string | number) => formatCurrencyShort(v);
const hoursLabel = (v: number) => `${formatIndianNumber(Math.round(v), 0)} h`;

const HEALTH_LABEL: Record<string, string> = {
  HEALTHY: 'Healthy',
  AT_RISK: 'At risk',
  CRITICAL: 'Critical',
};

const COST_SERIES: ColumnSeries[] = [
  { key: 'labour', label: 'Labour', swatch: 'bg-blue', fill: 'fill-blue' },
  { key: 'expense', label: 'Expenses', swatch: 'bg-violet', fill: 'fill-violet' },
];
const BOOKING_SERIES: ColumnSeries[] = [
  { key: 'value', label: 'Booked value', swatch: 'bg-blue', fill: 'fill-blue' },
];

const SEVERITY: Record<ActionItem['severity'], { tone: 'red' | 'amber' | 'blue'; label: string }> =
  {
    high: { tone: 'red', label: 'Now' },
    medium: { tone: 'amber', label: 'Soon' },
    low: { tone: 'blue', label: 'FYI' },
  };

/** A small bold figure with a caption, used in the Work and Money panels. */
function Figure({
  label,
  value,
  foot,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  foot?: React.ReactNode;
  tone?: 'good' | 'warn' | 'bad';
}) {
  return (
    <div className="min-w-0 rounded-card border border-line bg-surface-2 p-3">
      <p className="truncate text-micro font-heavy uppercase text-muted">{label}</p>
      <p
        className={cn(
          'mt-1 truncate text-[22px] font-black leading-tight',
          tone === 'good' && 'text-green',
          tone === 'warn' && 'text-amber',
          tone === 'bad' && 'text-red',
          !tone && 'text-ink',
        )}
      >
        {value}
      </p>
      {foot && <p className="mt-0.5 truncate text-sub text-muted">{foot}</p>}
    </div>
  );
}

function Lifecycle({ data }: { data: NonNullable<ExecutiveDashboard['lifecycle']> }) {
  const steps: Array<{
    n: string;
    title: string;
    value: number;
    note: string;
    to: string;
    tone: 'plain' | 'good' | 'warn' | 'now';
  }> = [
    {
      n: '01',
      title: 'Draft bookings',
      value: data.draft,
      note: 'Entered, not yet confirmed',
      to: '/bookings?status=DRAFT',
      tone: 'plain',
    },
    {
      n: '02',
      title: 'Awaiting approval',
      value: data.awaitingApproval,
      note: 'Waiting for a manager',
      to: '/bookings?status=AWAITING_APPROVAL',
      tone: data.awaitingApproval > 0 ? 'warn' : 'plain',
    },
    {
      n: '03',
      title: 'Confirmed this month',
      value: data.confirmedThisMonth,
      note: 'Commercially locked',
      to: '/bookings?status=CONFIRMED',
      tone: 'good',
    },
    {
      n: '04',
      title: 'Verbal, email pending',
      value: data.verbalEmailPending,
      note: data.verbalEmailOverdue
        ? `${data.verbalEmailOverdue} past the reminder window`
        : 'None overdue',
      to: '/bookings?filter=email-pending',
      tone: data.verbalEmailOverdue ? 'warn' : 'plain',
    },
    {
      n: '05',
      title: 'Project codes issued',
      value: data.codesThisYear,
      note: 'This financial year',
      to: '/projects',
      tone: 'good',
    },
    {
      n: '06',
      title: 'Scheduled',
      value: data.scheduled.scheduled,
      note: `${data.scheduled.unscheduled} still without a schedule`,
      to: '/projects',
      tone: data.scheduled.unscheduled ? 'warn' : 'plain',
    },
    {
      n: '07',
      title: 'Active delivery',
      value: data.scheduled.active,
      note: 'Projects running now',
      to: '/projects',
      tone: 'now',
    },
  ];
  return (
    <div className="scroll-slim -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1">
      {steps.map((s) => (
        <Link
          key={s.n}
          to={s.to}
          className={cn(
            'min-w-[150px] flex-1 rounded-card border p-3 transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-card',
            s.tone === 'good' && 'border-green/30 bg-pill-green-bg/50',
            s.tone === 'now' && 'border-blue/30 bg-pill-blue-bg/60',
            s.tone === 'warn' && 'border-amber/40 bg-pill-amber-bg/60',
            s.tone === 'plain' && 'border-line bg-surface',
          )}
        >
          <div className="flex items-center justify-between">
            <span className="grid size-6 place-items-center rounded-md bg-pill-blue-bg text-[10px] font-black text-pill-blue-fg">
              {s.n}
            </span>
            <span className="text-[20px] font-black leading-none text-ink">{s.value}</span>
          </div>
          <p className="mt-2 text-body font-heavy text-ink">{s.title}</p>
          <p className="mt-0.5 text-sub text-muted">{s.note}</p>
        </Link>
      ))}
    </div>
  );
}

function PortfolioTable({ rows }: { rows: NonNullable<ExecutiveDashboard['portfolio']> }) {
  const navigate = useNavigate();
  const showCost = rows.some((r) => r.actualTotalCost !== undefined);
  const showMargin = rows.some((r) => r.marginAmount !== undefined);

  if (rows.length === 0) {
    return (
      <p className="px-4 pb-6 text-center text-sub text-muted">
        No active projects in this view yet.
      </p>
    );
  }
  return (
    <div className="scroll-slim overflow-x-auto">
      <table className="w-full min-w-[600px] text-body">
        <thead className="text-left text-micro uppercase text-muted">
          <tr>
            <th className="px-4 py-2 font-heavy">Project</th>
            <th className="px-3 py-2 font-heavy">Progress</th>
            <th className="px-3 py-2 font-heavy">Hours burn</th>
            {showCost && <th className="px-3 py-2 text-right font-heavy">Actual cost</th>}
            {showMargin && <th className="px-3 py-2 text-right font-heavy">Margin</th>}
            <th className="px-3 py-2 font-heavy">Health</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const risk = p.alertLevel > 0 || (p.burnPercent ?? 0) >= 80;
            return (
              <tr
                key={p.id}
                tabIndex={0}
                onClick={() => navigate(`/projects/${p.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/projects/${p.id}`)}
                className="cursor-pointer border-t border-line transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
              >
                <td className="max-w-[190px] px-4 py-2.5">
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
                      <Progress value={p.taskProgress} label={`${p.name} task progress`} />
                      <p className="mt-1 text-sub text-muted">
                        {p.taskProgress}% of {p.taskCount}
                      </p>
                    </>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {p.burnPercent === null ? (
                    <span className="text-sub text-muted">No budget</span>
                  ) : (
                    <>
                      <Progress risk={risk} value={p.burnPercent} label={`${p.name} hours burn`} />
                      <p className={cn('mt-1 text-sub', risk ? 'text-amber' : 'text-muted')}>
                        {p.burnPercent}% used
                      </p>
                    </>
                  )}
                </td>
                {showCost && (
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-heavy tabular-nums">
                    {p.actualTotalCost !== undefined ? money(p.actualTotalCost) : '—'}
                  </td>
                )}
                {showMargin && (
                  <td
                    className={cn(
                      'whitespace-nowrap px-3 py-2.5 text-right font-heavy tabular-nums',
                      p.marginAmount !== undefined && Number(p.marginAmount) < 0
                        ? 'text-red'
                        : 'text-green',
                    )}
                  >
                    {p.marginAmount !== undefined ? money(p.marginAmount) : '—'}
                    {p.marginPercent != null && (
                      <span className="block text-sub font-normal text-muted">
                        {p.marginPercent}%
                      </span>
                    )}
                  </td>
                )}
                <td className="px-3 py-2.5">
                  <StatusPill status={p.health} label={HEALTH_LABEL[p.health]} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ActionCenter({ actions }: { actions: ActionItem[] }) {
  if (actions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-card bg-surface-2 px-4 py-8 text-center">
        <CheckCircle2 aria-hidden className="size-7 text-green" />
        <p className="text-body font-heavy text-ink">Nothing needs a decision right now</p>
        <p className="text-sub text-muted">Approvals, budgets and bookings are all on track.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {actions.map((a) => {
        const sev = SEVERITY[a.severity];
        return (
          <li key={a.id}>
            <Link
              to={a.linkUrl}
              className="flex gap-3 rounded-xl border border-line-soft bg-surface-2 p-3 transition-colors hover:bg-line-soft"
            >
              <span
                aria-hidden
                className={cn(
                  'grid size-8 shrink-0 place-items-center rounded-lg [&>svg]:size-4',
                  sev.tone === 'red' && 'bg-pill-red-bg text-pill-red-fg',
                  sev.tone === 'amber' && 'bg-pill-amber-bg text-pill-amber-fg',
                  sev.tone === 'blue' && 'bg-pill-blue-bg text-pill-blue-fg',
                )}
              >
                {a.kind === 'APPROVAL' ? (
                  <ClipboardCheck />
                ) : a.kind === 'BOOKING' ? (
                  <Mail />
                ) : a.kind === 'BUDGET' ? (
                  <Banknote />
                ) : (
                  <AlertTriangle />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-2">
                  <span className="text-body font-heavy text-ink">{a.title}</span>
                  <Pill tone={sev.tone}>{sev.label}</Pill>
                </span>
                <span className="mt-0.5 block text-sub text-muted">{a.detail}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function CostByProject({
  rows,
}: {
  rows: NonNullable<NonNullable<ExecutiveDashboard['charts']['costByProject']>>;
}) {
  const max = Math.max(1, ...rows.map((r) => Number(r.actualTotalCost)));
  if (rows.length === 0 || max <= 1) {
    return (
      <p className="rounded-card bg-surface-2 px-4 py-8 text-center text-sub text-muted">
        No project cost has posted yet.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const total = Number(r.actualTotalCost);
        const labour = (Number(r.actualLabourCost) / max) * 100;
        const expense = (Number(r.actualExpenseCost) / max) * 100;
        return (
          <li key={r.id}>
            <div className="flex items-baseline justify-between gap-3 text-sub">
              <span className="truncate font-heavy text-ink" title={r.name}>
                {r.name}
              </span>
              <span className="shrink-0 font-heavy tabular-nums text-ink-2">{money(total)}</span>
            </div>
            <div
              className="mt-1 flex h-2 gap-0.5"
              role="img"
              aria-label={`${r.name}: labour ${money(r.actualLabourCost)}, expenses ${money(r.actualExpenseCost)}`}
            >
              <span className="rounded-l-full bg-blue" style={{ width: `${labour}%` }} />
              {expense > 0 && (
                <span
                  className="rounded-r-full bg-violet"
                  style={{ width: `${Math.max(expense, 0.8)}%` }}
                />
              )}
            </div>
          </li>
        );
      })}
      <li className="flex items-center gap-4 pt-1 text-sub text-ink-2">
        {COST_SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden className={cn('inline-block size-2.5 rounded-sm', s.swatch)} />
            {s.label}
          </span>
        ))}
      </li>
    </ul>
  );
}

export function ExecutiveSkeleton() {
  return (
    <div className="space-y-5" aria-busy>
      <MetricRow>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-card" />
        ))}
      </MetricRow>
      <Skeleton className="h-36 rounded-card" />
      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Skeleton className="h-72 rounded-card" />
        <Skeleton className="h-72 rounded-card" />
      </div>
    </div>
  );
}

export function ExecutiveBody({ data }: { data: ExecutiveDashboard }) {
  const navigate = useNavigate();
  const { kpis, work, money: finance, charts } = data;
  const util = kpis.utilization;

  const costData =
    charts.costByMonth?.map((m) => ({
      label: m.label,
      values: { labour: Number(m.actualLabourCost), expense: Number(m.actualExpenseCost) },
    })) ?? [];
  const bookingData =
    charts.bookingsByMonth?.map((m) => ({
      label: m.label,
      values: { value: Number(m.projectValue ?? 0) },
    })) ?? [];
  const att = work?.attendance ?? null;

  return (
    <div className="space-y-5">
      <MetricRow>
        {kpis.booked && (
          <MetricCard
            label="Booked this month"
            value={
              kpis.booked.projectValue !== undefined
                ? money(kpis.booked.projectValue)
                : kpis.booked.count
            }
            state="good"
            foot={`${kpis.booked.count} booking${kpis.booked.count === 1 ? '' : 's'} · ${data.monthLabel}`}
            onClick={() => navigate('/bookings')}
          />
        )}
        {kpis.activeProjects && (
          <MetricCard
            label="Active projects"
            value={kpis.activeProjects.count}
            foot={
              kpis.activeProjects.attention
                ? `${kpis.activeProjects.attention} need attention`
                : 'All on track'
            }
            state={kpis.activeProjects.attention ? 'warn' : 'neutral'}
            onClick={() => navigate('/projects')}
          />
        )}
        {util && (
          <MetricCard
            label="Billable utilization"
            value={`${util.percent}%`}
            state={util.percent >= 70 ? 'good' : util.percent >= 40 ? 'neutral' : 'warn'}
            delta={
              util.deltaPoints === 0
                ? undefined
                : {
                    value: `${Math.abs(util.deltaPoints)} pts vs last month`,
                    direction: util.deltaPoints > 0 ? 'up' : 'down',
                  }
            }
            foot={`${hoursLabel(util.billableHours)} of ${hoursLabel(util.capacityHours)}`}
          />
        )}
        {kpis.approvals && (
          <MetricCard
            label="Pending approvals"
            value={kpis.approvals.total}
            state={kpis.approvals.total > 0 ? 'warn' : 'good'}
            foot={`${kpis.approvals.timesheets} time · ${kpis.approvals.leave} leave · ${kpis.approvals.expenses} exp.`}
          />
        )}
        {kpis.budget && (
          <MetricCard
            label="Budget watch"
            value={kpis.budget.over + kpis.budget.near}
            state={kpis.budget.over ? 'bad' : kpis.budget.near ? 'warn' : 'good'}
            foot={`${kpis.budget.over} over · ${kpis.budget.near} past 80%`}
          />
        )}
        {kpis.margin && (
          <MetricCard
            label="Margin to date"
            value={money(kpis.margin.amount)}
            state={kpis.margin.value < 0 ? 'bad' : 'good'}
            foot={
              kpis.margin.percent === null ? 'Active projects' : `${kpis.margin.percent}% of value`
            }
          />
        )}
      </MetricRow>

      {data.lifecycle && (
        <Panel
          title="Commercial lifecycle"
          subtitle="Every project starts as a booking and only gets a code once it is confirmed."
        >
          <Lifecycle data={data.lifecycle} />
        </Panel>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        {data.portfolio && (
          <Panel
            flush
            title="Project portfolio health"
            subtitle="Progress, hours burned and margin in a single row. Worst first."
            action={<PanelLink href="/projects">Open portfolio →</PanelLink>}
            bodyClassName="pb-2"
          >
            <PortfolioTable rows={data.portfolio} />
          </Panel>
        )}
        <Panel
          title="Action Center"
          subtitle="Only items that need a management decision."
          className={!data.portfolio ? 'xl:col-span-2' : undefined}
        >
          <ActionCenter actions={data.actions} />
        </Panel>
      </div>

      {(work || finance) && (
        <div className="grid gap-5 lg:grid-cols-2">
          {work && (
            <Panel
              title="Work intelligence"
              subtitle="Attendance and logged time, from the real punches and timesheets."
              action={<PanelLink href="/attendance">Open →</PanelLink>}
            >
              <div className="grid grid-cols-2 gap-2.5">
                {att && (
                  <>
                    <Figure
                      label="Present today"
                      value={`${att.present} / ${att.expected}`}
                      foot={`${att.presentPercent}% · ${att.late} late`}
                      tone={att.expected > 0 && att.present === 0 ? undefined : 'good'}
                    />
                    <Figure
                      label="Not in yet"
                      value={att.notIn}
                      foot={`${att.onLeave} on leave · ${att.absent} absent`}
                      tone={att.flagged ? 'warn' : undefined}
                    />
                  </>
                )}
                {work.hours && (
                  <>
                    <Figure
                      label="Logged this week"
                      value={hoursLabel(work.hours.weekLogged)}
                      foot={`${hoursLabel(work.hours.todayLogged)} today`}
                    />
                    <Figure
                      label="Billable"
                      value={hoursLabel(work.hours.weekBillable)}
                      foot={
                        work.hours.weekBillablePercent === null
                          ? 'Nothing logged yet'
                          : `${work.hours.weekBillablePercent}% of logged`
                      }
                      tone="good"
                    />
                  </>
                )}
              </div>
              {att && att.flagged > 0 && (
                <p className="mt-3 flex items-center gap-1.5 text-sub text-amber">
                  <AlertTriangle aria-hidden className="size-3.5" />
                  {att.flagged} punch{att.flagged === 1 ? '' : 'es'} flagged for review today
                </p>
              )}
            </Panel>
          )}

          {finance && (
            <Panel
              title="Expenses and cost"
              subtitle="What is waiting for money to move, and what has been spent."
              action={<PanelLink href="/expenses">Open →</PanelLink>}
            >
              <div className="grid grid-cols-2 gap-2.5">
                {finance.expenses && (
                  <>
                    <Figure
                      label="With managers"
                      value={money(finance.expenses.awaitingManager.amount)}
                      foot={`${finance.expenses.awaitingManager.count} claim${finance.expenses.awaitingManager.count === 1 ? '' : 's'}`}
                    />
                    <Figure
                      label="With Finance"
                      value={money(finance.expenses.awaitingFinance.amount)}
                      foot={`${finance.expenses.awaitingFinance.count} claim${finance.expenses.awaitingFinance.count === 1 ? '' : 's'}`}
                      tone={finance.expenses.awaitingFinance.count ? 'warn' : undefined}
                    />
                    <Figure
                      label="To reimburse"
                      value={money(finance.expenses.toReimburse.amount)}
                      foot="Approved, not yet paid"
                    />
                  </>
                )}
                {finance.cost && (
                  <Figure
                    label={`Cost in ${data.monthLabel}`}
                    value={money(finance.cost.thisMonth.total)}
                    foot={`Last month ${money(finance.cost.lastMonth.total)}`}
                  />
                )}
              </div>
            </Panel>
          )}
        </div>
      )}

      {(charts.costByMonth || charts.bookingsByMonth || charts.costByProject) && (
        <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
          {charts.costByMonth && (
            <Panel
              title="Project cost by month"
              subtitle="Posted labour and expense cost, last six months."
            >
              <ColumnChart
                data={costData}
                series={COST_SERIES}
                formatValue={money}
                ariaLabel="Project cost per month, labour and expenses stacked"
                emptyText="No cost has posted in the last six months."
              />
            </Panel>
          )}
          {charts.bookingsByMonth && (
            <Panel title="Bookings by month" subtitle="Confirmed booking value, last six months.">
              <ColumnChart
                data={bookingData}
                series={BOOKING_SERIES}
                formatValue={money}
                ariaLabel="Confirmed booking value per month"
                emptyText="No bookings were confirmed in the last six months."
              />
            </Panel>
          )}
          {charts.costByProject && (
            <Panel title="Cost by project" subtitle="Life to date, largest first.">
              <CostByProject rows={charts.costByProject} />
            </Panel>
          )}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-sub text-muted">
        <Info aria-hidden className="size-3.5" />
        Figures are as of{' '}
        {new Date(data.asOf).toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
        })}
        , {formatDisplayDate(data.today)}, and refresh every minute. Utilization is billable hours
        over available hours, month to date.
      </p>
    </div>
  );
}
