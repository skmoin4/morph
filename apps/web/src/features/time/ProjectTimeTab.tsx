import { Clock3 } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { MetricCard, MetricRow } from '../../components/ui/MetricCard';
import { Panel } from '../../components/ui/Panel';
import { Progress } from '../../components/ui/Progress';
import { Skeleton } from '../../components/ui/Skeleton';
import { formatHoursMinutes, useProjectTimeSummary } from './useTime';

/** Project 360 → Time: who has put hours on this project, and on which tasks. */
export function ProjectTimeTab({
  projectId,
  budgetHours,
}: {
  projectId: string;
  budgetHours: number;
}) {
  const { data, isLoading } = useProjectTimeSummary(projectId);

  if (isLoading || !data) {
    return <Skeleton className="h-48 w-full" />;
  }
  const max = Math.max(1, ...data.byEmployee.map((p) => p.hours));
  const maxTask = Math.max(1, ...data.byTask.map((t) => t.hours));

  return (
    <div className="space-y-5">
      <MetricRow>
        <MetricCard
          label="Hours logged"
          value={formatHoursMinutes(data.totalHours)}
          foot={data.partial ? 'Within your view' : 'Everyone on the project'}
        />
        <MetricCard
          label="Approved & costed"
          value={formatHoursMinutes(data.approvedHours)}
          foot="Locked and on the ledger"
        />
        <MetricCard
          label="Budget"
          value={budgetHours ? `${Math.round((data.approvedHours / budgetHours) * 100)}%` : '—'}
          foot={
            budgetHours ? `of ${budgetHours} budgeted hours (approved only)` : 'No hours budget set'
          }
        />
      </MetricRow>

      {data.byEmployee.length === 0 ? (
        <Panel title="Time">
          <EmptyState
            icon={<Clock3 />}
            title="No time logged yet"
            description="Hours appear here as the team logs them."
          />
        </Panel>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="By person" subtitle="Total, with the approved share.">
            <ul className="space-y-3">
              {data.byEmployee.map((p) => (
                <li key={p.employee.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-body font-heavy text-ink">
                      {p.employee.fullName}
                    </span>
                    <span className="shrink-0 text-sub tabular-nums text-muted">
                      {formatHoursMinutes(p.hours)} · {formatHoursMinutes(p.approved)} approved
                    </span>
                  </div>
                  <Progress
                    value={(p.hours / max) * 100}
                    label={`${p.employee.fullName} hours`}
                    className="mt-1.5"
                  />
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="By task">
            <ul className="space-y-3">
              {data.byTask.map((t) => (
                <li key={t.taskId ?? 'none'}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-body text-ink">{t.title}</span>
                    <span className="shrink-0 text-sub tabular-nums text-muted">
                      {formatHoursMinutes(t.hours)}
                    </span>
                  </div>
                  <Progress
                    value={(t.hours / maxTask) * 100}
                    label={`${t.title} hours`}
                    className="mt-1.5"
                  />
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </div>
  );
}
