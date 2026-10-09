import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { SelectField, TextAreaField, TextField } from '../../components/ui/Field';
import { ApiRequestError } from '../../lib/api';
import {
  parseHoursInput,
  useCreateEntry,
  useTimeProjects,
  useTimeTasks,
  useUpdateEntry,
  type TimeEntryRow,
} from './useTime';

/** Log time by hand, or change an entry you already logged. */
export function EntryDialog({
  entry,
  defaultDate,
  today,
  onClose,
}: {
  entry?: TimeEntryRow;
  defaultDate: string;
  today: string;
  onClose: () => void;
}) {
  const create = useCreateEntry();
  const update = useUpdateEntry();
  const { data: projects } = useTimeProjects();
  const [projectId, setProjectId] = useState(entry?.projectId ?? '');
  const [taskId, setTaskId] = useState(entry?.taskId ?? '');
  const [workDate, setWorkDate] = useState(entry?.workDate ?? defaultDate);
  const [hours, setHours] = useState(entry ? String(entry.hours) : '');
  const [isBillable, setIsBillable] = useState(entry?.isBillable ?? true);
  const [description, setDescription] = useState(entry?.description ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { data: tasks } = useTimeTasks(projectId || undefined);
  const pending = create.isPending || update.isPending;

  async function submit() {
    const parsed = parseHoursInput(hours);
    const next: Record<string, string> = {};
    if (!projectId) next.projectId = 'Choose a project';
    if (parsed === null || parsed <= 0) next.hours = 'Enter the hours, like 2, 1.5 or 1:30';
    else if (parsed > 24) next.hours = 'A day has only 24 hours';
    if (!workDate) next.workDate = 'Pick the day';
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    const hoursValue = Math.round((parsed as number) * 100) / 100;
    try {
      if (entry) {
        await update.mutateAsync({
          id: entry.id,
          input: {
            projectId,
            taskId: taskId || null,
            workDate,
            hours: hoursValue,
            isBillable,
            description: description || null,
          },
        });
        toast.success('Entry updated');
      } else {
        await create.mutateAsync({
          projectId,
          taskId: taskId || null,
          workDate,
          hours: hoursValue,
          isBillable,
          description: description || null,
        });
        toast.success('Time logged');
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiRequestError && Object.keys(error.fieldErrors).length > 0) {
        setErrors(error.fieldErrors);
      } else {
        setErrors({
          hours: error instanceof ApiRequestError ? error.message : 'Could not save the entry.',
        });
      }
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={entry ? 'Change time entry' : 'Log time'}
      description="Hours go to the week of the day you pick."
      className="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {entry ? 'Save' : 'Log time'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Project"
          required
          containerClassName="sm:col-span-2"
          error={errors.projectId}
          value={projectId}
          onChange={(event) => {
            setProjectId(event.target.value);
            setTaskId('');
            setErrors({});
          }}
          options={[
            { value: '', label: 'Choose a project…' },
            ...(projects ?? []).map((p) => ({
              value: p.id,
              label: `${p.projectCode} · ${p.name}`,
            })),
            // A project that has since closed still shows on an old entry.
            ...(entry && !(projects ?? []).some((p) => p.id === entry.projectId)
              ? [
                  {
                    value: entry.projectId,
                    label: `${entry.project.projectCode} · ${entry.project.name}`,
                  },
                ]
              : []),
          ]}
        />
        <SelectField
          label="Task"
          containerClassName="sm:col-span-2"
          error={errors.taskId}
          value={taskId}
          disabled={!projectId}
          onChange={(event) => setTaskId(event.target.value)}
          options={[
            { value: '', label: 'No task (project-level time)' },
            ...(tasks ?? []).map((t) => ({
              value: t.id,
              label: `${t.assignedToMe ? '★ ' : ''}${t.title}`,
            })),
            ...(entry?.task && !(tasks ?? []).some((t) => t.id === entry.task!.id)
              ? [{ value: entry.task.id, label: entry.task.title }]
              : []),
          ]}
        />
        <TextField
          label="Day"
          type="date"
          required
          max={today}
          error={errors.workDate}
          value={workDate}
          onChange={(event) => setWorkDate(event.target.value)}
        />
        <TextField
          label="Hours"
          required
          placeholder="2, 1.5 or 1:30"
          inputMode="decimal"
          error={errors.hours}
          value={hours}
          onChange={(event) => {
            setHours(event.target.value);
            setErrors({});
          }}
        />
        <TextAreaField
          label="What did you do? (optional)"
          rows={2}
          containerClassName="sm:col-span-2"
          error={errors.description}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <label className="flex items-center gap-2 text-body text-ink-2 sm:col-span-2">
          <input
            type="checkbox"
            className="size-4 accent-blue"
            checked={isBillable}
            onChange={(event) => setIsBillable(event.target.checked)}
          />
          Billable
        </label>
      </div>
    </Dialog>
  );
}
