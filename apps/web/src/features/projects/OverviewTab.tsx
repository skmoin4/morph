import { CalendarClock, Flag } from 'lucide-react';
import { MetricCard, MetricRow } from '../../components/ui/MetricCard';
import { Panel } from '../../components/ui/Panel';
import { Progress } from '../../components/ui/Progress';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatCurrency, formatCurrencyShort, formatDisplayDate } from '../../lib/format';
import { BILLING_LABEL } from '../bookings/BookingBadges';
import { personName, type ProjectDetail } from './useProjects';

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const end = new Date(`${date.slice(0, 10)}T00:00:00.000Z`).getTime();
  const now = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z').getTime();
  return Math.round((end - now) / 86_400_000);
}

export function OverviewTab({ project }: { project: ProjectDetail }) {
  const { tasks } = project;
  const taskPercent = tasks.total === 0 ? 0 : Math.round((tasks.DONE / tasks.total) * 100);
  const burn = project.hoursBurnPercent;
  const left = daysUntil(project.endDate);
  // A margin before any cost has posted is just "100%" — noise, not information.
  const hasCost = Number(project.actualTotalCost ?? 0) > 0;

  const nextMilestone = project.milestones.find((m) => m.status !== 'COMPLETED');

  return (
    <div className="space-y-5">
      <MetricRow>
        <MetricCard
          label="Team"
          value={project.members.filter((m) => m.isActive).length}
          foot={
            project.projectManager ? `PM ${personName(project.projectManager)}` : 'No manager yet'
          }
        />
        <MetricCard
          label="Contract value"
          value={
            project.projectValue !== undefined ? formatCurrencyShort(project.projectValue) : '—'
          }
          foot={
            project.projectValue !== undefined
              ? BILLING_LABEL[project.billingType]
              : 'Hidden for your role'
          }
        />
        <MetricCard
          label="Task progress"
          value={`${taskPercent}%`}
          state={tasks.total > 0 && taskPercent === 100 ? 'good' : 'neutral'}
          foot={tasks.total === 0 ? 'No tasks yet' : `${tasks.DONE} of ${tasks.total} done`}
        />
        <MetricCard
          label="Hours burn"
          value={burn === null ? '—' : `${burn}%`}
          state={
            burn !== null && burn >= 100 ? 'bad' : burn !== null && burn >= 80 ? 'warn' : 'neutral'
          }
          foot={`${Number(project.actualHours).toLocaleString('en-IN')} of ${Number(project.budgetHours).toLocaleString('en-IN')} h`}
        />
        {project.actualTotalCost !== undefined && (
          <MetricCard
            label="Actual cost"
            value={hasCost ? formatCurrencyShort(project.actualTotalCost) : '—'}
            foot={hasCost ? 'Posted to date' : 'Nothing posted yet'}
          />
        )}
        {hasCost && project.marginPercent !== undefined && project.marginPercent !== null && (
          <MetricCard
            label="Projected margin"
            value={`${project.marginPercent}%`}
            state={project.marginPercent < 0 ? 'bad' : 'good'}
            foot={
              project.marginAmount !== undefined
                ? formatCurrencyShort(project.marginAmount)
                : undefined
            }
          />
        )}
      </MetricRow>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Delivery snapshot" className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            {[
              ['Client', project.client.name],
              ['Office', project.office.name],
              ['Project manager', personName(project.projectManager)],
              ['Starts', project.startDate ? formatDisplayDate(project.startDate) : '—'],
              ['Ends', project.endDate ? formatDisplayDate(project.endDate) : '—'],
              [
                'Time left',
                left === null
                  ? '—'
                  : left < 0
                    ? `${Math.abs(left)} days past the end date`
                    : `${left} days`,
              ],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-micro font-heavy uppercase text-muted">{label}</dt>
                <dd className="mt-0.5 break-words text-body text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {project.description && (
            <p className="mt-4 whitespace-pre-line rounded-card bg-surface-2 p-3 text-sub text-ink-2">
              {project.description}
            </p>
          )}
        </Panel>

        <div className="space-y-5">
          <Panel title="Hours against budget">
            <Progress value={burn ?? 0} risk={(burn ?? 0) >= 80} label="Hours consumed" />
            <p className="mt-2 text-sub text-muted">
              {burn === null
                ? 'No hours budget was set on the booking.'
                : `${Number(project.actualHours).toLocaleString('en-IN')} h used of ${Number(project.budgetHours).toLocaleString('en-IN')} h`}
            </p>
            {project.projectValue !== undefined && (
              <p className="mt-1 text-sub text-muted">
                Booked at {formatCurrency(project.projectValue)}
              </p>
            )}
          </Panel>

          <Panel title="Next up">
            {nextMilestone ? (
              <div className="flex items-start gap-2.5">
                <Flag aria-hidden className="mt-0.5 size-4 shrink-0 text-blue" />
                <div className="min-w-0">
                  <p className="text-body font-heavy text-ink">{nextMilestone.name}</p>
                  <p className="text-sub text-muted">
                    Due {formatDisplayDate(nextMilestone.dueDate)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sub text-muted">
                <CalendarClock aria-hidden className="size-4" /> No open milestones.
              </p>
            )}
          </Panel>
        </div>
      </div>

      <Panel title="Cost burn over time" subtitle="Approved time and expenses against the budget.">
        <EmptyState
          title="Arrives with the cost ledger"
          description="Time and expenses post to the project once they are approved (steps 10–12); the burn chart is drawn from those postings."
        />
      </Panel>
    </div>
  );
}
