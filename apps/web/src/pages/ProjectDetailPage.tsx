import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRightLeft, Pencil } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Panel } from '../components/ui/Panel';
import { Skeleton } from '../components/ui/Skeleton';
import { BOOKING_LIFECYCLE, Stepper } from '../components/ui/Stepper';
import { TabPanel, Tabs } from '../components/ui/Tabs';
import { ApiRequestError } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';
import { HealthPill, ProjectStatusPill } from '../features/projects/badges';
import { BookingTab } from '../features/projects/BookingTab';
import { EditProjectDrawer } from '../features/projects/EditProjectDrawer';
import { OverviewTab } from '../features/projects/OverviewTab';
import { ProjectStatusDialog } from '../features/projects/ProjectStatusDialog';
import { ScheduleTab } from '../features/projects/ScheduleTab';
import { TaskBoard } from '../features/projects/TaskBoard';
import { TeamTab } from '../features/projects/TeamTab';
import { ProjectTimeTab } from '../features/time/ProjectTimeTab';
import { useProject } from '../features/projects/useProjects';

const LATER_TABS = {
  expenses: { label: 'Expenses', step: 'step 11', what: 'Approved claims charged to this project' },
  cost: {
    label: 'Cost ledger',
    step: 'step 12',
    what: 'Every posting to the project cost, with the rate applied',
  },
} as const;

/** Project 360: one page for everything about a project. */
export function ProjectDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data: project, isLoading, error } = useProject(id);
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  const tab = params.get('tab') ?? 'overview';
  const canEdit = can('project.edit');

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !project) {
    const missing = error instanceof ApiRequestError && error.status === 404;
    return (
      <div className="space-y-5">
        <PageHeader
          eyebrow="Projects"
          title={missing ? 'Project not found' : 'Could not load the project'}
        />
        <Panel>
          <EmptyState
            title={
              missing
                ? 'That project does not exist, or is not one of yours'
                : 'Something went wrong'
            }
            description={
              missing
                ? 'Check the link, or open it from the project list.'
                : 'Try again in a moment.'
            }
            action={
              <Link
                to="/projects"
                className="inline-flex h-8 items-center rounded-control border border-line bg-surface px-2.5 text-micro font-heavy text-ink-2"
              >
                Back to projects
              </Link>
            }
          />
        </Panel>
      </div>
    );
  }

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'booking', label: 'Booking & confirmation' },
    { key: 'schedule', label: 'Schedule', count: project.milestones.length },
    { key: 'team', label: 'Team', count: project.members.filter((m) => m.isActive).length },
    { key: 'tasks', label: 'Tasks', count: project.tasks.total },
    ...(can('timesheet.view') ? [{ key: 'time', label: 'Time' }] : []),
    ...Object.entries(LATER_TABS).map(([key, value]) => ({ key, label: value.label })),
  ];

  const later = tab in LATER_TABS ? LATER_TABS[tab as keyof typeof LATER_TABS] : null;

  return (
    <div className="space-y-5">
      <Link
        to="/projects"
        className="inline-flex items-center gap-1.5 text-sub font-heavy text-muted hover:text-ink-2"
      >
        <ArrowLeft aria-hidden className="size-4" /> All projects
      </Link>

      <PageHeader
        eyebrow={`Project 360 · ${project.projectCode}`}
        title={project.name}
        subtitle={`${project.client.name} · ${project.projectType.name} · ${project.office.name}`}
        actions={
          <>
            <ProjectStatusPill status={project.status} />
            <HealthPill health={project.health} status={project.status} />
            {canEdit && (
              <>
                <Button leadingIcon={<ArrowRightLeft />} onClick={() => setChangingStatus(true)}>
                  Change status
                </Button>
                <Button variant="primary" leadingIcon={<Pencil />} onClick={() => setEditing(true)}>
                  Edit
                </Button>
              </>
            )}
          </>
        }
      />

      <Stepper steps={BOOKING_LIFECYCLE} currentIndex={project.scheduled ? 5 : 4} compact />

      <Tabs
        tabs={tabs}
        value={tab}
        onChange={(key) => setParams(key === 'overview' ? {} : { tab: key }, { replace: true })}
      />

      <TabPanel>
        {tab === 'overview' && <OverviewTab project={project} />}
        {tab === 'booking' && <BookingTab project={project} />}
        {tab === 'schedule' && <ScheduleTab project={project} canEdit={canEdit} />}
        {tab === 'team' && <TeamTab project={project} canEdit={canEdit} />}
        {tab === 'tasks' && <TaskBoard project={project} />}
        {tab === 'time' && can('timesheet.view') && (
          <ProjectTimeTab projectId={project.id} budgetHours={Number(project.budgetHours)} />
        )}
        {later && (
          <Panel title={later.label}>
            <EmptyState
              title="Coming in a later step"
              description={`${later.what} will appear here in ${later.step}.`}
            />
          </Panel>
        )}
      </TabPanel>

      {editing && <EditProjectDrawer project={project} onClose={() => setEditing(false)} />}
      {changingStatus && (
        <ProjectStatusDialog project={project} onClose={() => setChangingStatus(false)} />
      )}
    </div>
  );
}
