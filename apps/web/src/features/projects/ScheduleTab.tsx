import { useState } from 'react';
import { toast } from 'sonner';
import { Check, Flag, Pencil, Plus, Trash2 } from 'lucide-react';
import { milestoneSchema, type MilestoneInput } from '@opsvera/shared';
import { Button, IconButton } from '../../components/ui/Button';
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog';
import { TextAreaField, TextField } from '../../components/ui/Field';
import { EmptyState } from '../../components/ui/EmptyState';
import { Panel } from '../../components/ui/Panel';
import { StatusPill } from '../../components/ui/Pill';
import { ApiRequestError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatDisplayDate } from '../../lib/format';
import {
  useCreateMilestone,
  useDeleteMilestone,
  useUpdateMilestone,
  type Milestone,
  type ProjectDetail,
} from './useProjects';

const MILESTONE_LABEL = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Done',
} as const;

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The plan: project dates and the milestones between them.
 *
 * The strip at the top places each milestone by its due date so the shape of
 * the schedule — and any bunching or drift past the end date — is visible at a
 * glance without a Gantt chart (which the client has not asked for).
 */
export function ScheduleTab({ project, canEdit }: { project: ProjectDetail; canEdit: boolean }) {
  const [editing, setEditing] = useState<Milestone | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Milestone | null>(null);
  const update = useUpdateMilestone();
  const remove = useDeleteMilestone();

  const closed = project.status === 'CANCELLED';

  async function toggleDone(milestone: Milestone) {
    const done = milestone.status === 'COMPLETED';
    try {
      await update.mutateAsync({
        id: project.id,
        milestoneId: milestone.id,
        input: { status: done ? 'PENDING' : 'COMPLETED' },
      });
      toast.success(done ? 'Milestone reopened' : `${milestone.name} marked done`);
    } catch (error) {
      toast.error(
        error instanceof ApiRequestError ? error.message : 'Could not update the milestone.',
      );
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await remove.mutateAsync({ id: project.id, milestoneId: deleting.id });
      toast.success('Milestone deleted');
      setDeleting(null);
    } catch (error) {
      toast.error(
        error instanceof ApiRequestError ? error.message : 'Could not delete the milestone.',
      );
    }
  }

  return (
    <div className="space-y-5">
      <Panel
        title="Timeline"
        subtitle={
          project.startDate && project.endDate
            ? `${formatDisplayDate(project.startDate)} → ${formatDisplayDate(project.endDate)}`
            : 'Set the project dates to see the timeline.'
        }
      >
        <Timeline project={project} />
      </Panel>

      <Panel
        title="Milestones"
        subtitle="Dated deliverables the project is steered by."
        action={
          canEdit &&
          !closed && (
            <Button
              size="sm"
              variant="primary"
              leadingIcon={<Plus />}
              onClick={() => setEditing('new')}
            >
              Add milestone
            </Button>
          )
        }
      >
        {project.milestones.length === 0 ? (
          <EmptyState
            icon={<Flag />}
            title="No milestones yet"
            description="Add the dated points this project is delivered against — issue for review, LOD 300 model, as-built."
            action={
              canEdit && !closed ? (
                <Button
                  size="sm"
                  variant="primary"
                  leadingIcon={<Plus />}
                  onClick={() => setEditing('new')}
                >
                  Add milestone
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="space-y-2">
            {project.milestones.map((milestone) => {
              const overdue =
                milestone.status !== 'COMPLETED' && milestone.dueDate.slice(0, 10) < today();
              return (
                <li
                  key={milestone.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-soft bg-surface-2 p-3"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-body font-heavy text-ink">
                      {milestone.name}
                      <StatusPill
                        status={milestone.status === 'COMPLETED' ? 'DONE' : milestone.status}
                        label={MILESTONE_LABEL[milestone.status]}
                      />
                      {overdue && <StatusPill status="REJECTED" label="Overdue" dot={false} />}
                    </p>
                    <p className="text-sub text-muted">
                      Due {formatDisplayDate(milestone.dueDate)}
                      {milestone.completedOn &&
                        ` · done ${formatDisplayDate(milestone.completedOn)}`}
                      {` · ${milestone._count.tasks} task${milestone._count.tasks === 1 ? '' : 's'}`}
                    </p>
                    {milestone.description && (
                      <p className="mt-1 text-sub text-ink-2">{milestone.description}</p>
                    )}
                  </div>
                  {canEdit && !closed && (
                    <div className="flex shrink-0 gap-1">
                      <IconButton
                        label={
                          milestone.status === 'COMPLETED'
                            ? 'Reopen milestone'
                            : 'Mark milestone done'
                        }
                        size="sm"
                        onClick={() => toggleDone(milestone)}
                      >
                        <Check />
                      </IconButton>
                      <IconButton
                        label="Edit milestone"
                        size="sm"
                        onClick={() => setEditing(milestone)}
                      >
                        <Pencil />
                      </IconButton>
                      <IconButton
                        label="Delete milestone"
                        size="sm"
                        onClick={() => setDeleting(milestone)}
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {editing && (
        <MilestoneDialog
          project={project}
          milestone={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={remove.isPending}
        destructive
        title="Delete this milestone?"
        description={
          deleting
            ? `“${deleting.name}” is removed. ${deleting._count.tasks > 0 ? `Its ${deleting._count.tasks} task(s) stay on the project, unattached.` : ''}`
            : ''
        }
        confirmLabel="Delete"
      />
    </div>
  );
}

function Timeline({ project }: { project: ProjectDetail }) {
  if (!project.startDate || !project.endDate) {
    return (
      <p className="text-sub text-muted">
        No start or end date yet — edit the project to add them.
      </p>
    );
  }
  const start = Date.parse(project.startDate);
  const end = Date.parse(project.endDate);
  const span = Math.max(end - start, 1);
  const now = Date.now();
  const position = (value: number) => Math.min(100, Math.max(0, ((value - start) / span) * 100));

  return (
    <div className="px-2 pb-8 pt-6">
      <div className="relative h-1.5 rounded-full bg-track">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-progress-fill"
          style={{ width: `${position(now)}%` }}
        />
        {now >= start && now <= end && (
          <span
            title="Today"
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-ink"
            style={{ left: `${position(now)}%` }}
          />
        )}
        {project.milestones.map((milestone) => {
          const due = Date.parse(milestone.dueDate);
          const done = milestone.status === 'COMPLETED';
          return (
            <span
              key={milestone.id}
              title={`${milestone.name} — ${formatDisplayDate(milestone.dueDate)}`}
              className={cn(
                'absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px] border-2 border-surface',
                done ? 'bg-green' : due < now ? 'bg-red' : 'bg-blue',
              )}
              style={{ left: `${position(due)}%` }}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-micro tracking-normal text-muted">
        <span>{formatDisplayDate(project.startDate)}</span>
        <span>{formatDisplayDate(project.endDate)}</span>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-micro tracking-normal text-muted">
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rotate-45 rounded-[2px] bg-green" /> Done
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rotate-45 rounded-[2px] bg-blue" /> Upcoming
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rotate-45 rounded-[2px] bg-red" /> Overdue
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-ink" /> Today
        </li>
      </ul>
    </div>
  );
}

function MilestoneDialog({
  project,
  milestone,
  onClose,
}: {
  project: ProjectDetail;
  milestone: Milestone | null;
  onClose: () => void;
}) {
  const create = useCreateMilestone();
  const update = useUpdateMilestone();

  const [name, setName] = useState(milestone?.name ?? '');
  const [dueDate, setDueDate] = useState(milestone?.dueDate.slice(0, 10) ?? '');
  const [description, setDescription] = useState(milestone?.description ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pending = create.isPending || update.isPending;

  async function save() {
    const parsed = milestoneSchema.safeParse({
      name,
      dueDate,
      description: description || null,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
      setErrors(next);
      return;
    }
    try {
      const input: MilestoneInput = parsed.data;
      if (milestone) await update.mutateAsync({ id: project.id, milestoneId: milestone.id, input });
      else await create.mutateAsync({ id: project.id, input });
      toast.success(milestone ? 'Milestone updated' : 'Milestone added');
      onClose();
    } catch (error) {
      if (error instanceof ApiRequestError && error.fieldErrors.dueDate) {
        setErrors({ dueDate: error.fieldErrors.dueDate });
      } else {
        toast.error(
          error instanceof ApiRequestError ? error.message : 'Could not save the milestone.',
        );
      }
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={milestone ? 'Edit milestone' : 'Add milestone'}
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={save}>
            {milestone ? 'Save' : 'Add milestone'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <TextField
          label="Name"
          required
          value={name}
          error={errors.name}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label="Due date"
          type="date"
          required
          hint={
            project.startDate && project.endDate
              ? `Must fall within ${formatDisplayDate(project.startDate)} – ${formatDisplayDate(project.endDate)}`
              : undefined
          }
          value={dueDate}
          error={errors.dueDate}
          onChange={(event) => setDueDate(event.target.value)}
        />
        <TextAreaField
          label="Description"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
    </Dialog>
  );
}
