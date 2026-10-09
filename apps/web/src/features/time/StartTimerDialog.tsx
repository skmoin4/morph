import { useState } from 'react';
import { toast } from 'sonner';
import { Play } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { SelectField, TextField } from '../../components/ui/Field';
import { ApiRequestError } from '../../lib/api';
import { useStartTimer, useTimeProjects, useTimeTasks } from './useTime';

/** Pick a project and a task, then the clock starts. Both are required. */
export function StartTimerDialog({ onClose }: { onClose: () => void }) {
  const start = useStartTimer();
  const { data: projects, isLoading } = useTimeProjects();
  const [projectId, setProjectId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [description, setDescription] = useState('');
  const [isBillable, setIsBillable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { data: tasks, isLoading: loadingTasks } = useTimeTasks(projectId || undefined);

  async function submit() {
    if (!projectId || !taskId) {
      setError('Choose a project and a task to start the timer.');
      return;
    }
    try {
      await start.mutateAsync({
        projectId,
        taskId,
        description: description || null,
        isBillable,
      });
      toast.success('Timer started');
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not start the timer.');
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Start the timer"
      description="Pick what you are working on. Only one timer runs at a time."
      className="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={start.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            leadingIcon={<Play />}
            loading={start.isPending}
            onClick={submit}
            disabled={!projectId || !taskId}
          >
            Start
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <SelectField
          label="Project"
          required
          value={projectId}
          disabled={isLoading}
          onChange={(event) => {
            setProjectId(event.target.value);
            setTaskId('');
            setError(null);
          }}
          options={[
            { value: '', label: isLoading ? 'Loading…' : 'Choose a project…' },
            ...(projects ?? []).map((p) => ({
              value: p.id,
              label: `${p.projectCode} · ${p.name}`,
            })),
          ]}
          hint={
            projects && projects.length === 0 ? 'You are not on any live project yet.' : undefined
          }
        />
        <SelectField
          label="Task"
          required
          value={taskId}
          disabled={!projectId || loadingTasks}
          onChange={(event) => {
            setTaskId(event.target.value);
            setError(null);
          }}
          options={[
            {
              value: '',
              label: !projectId
                ? 'Choose a project first'
                : loadingTasks
                  ? 'Loading…'
                  : 'Choose a task…',
            },
            ...(tasks ?? []).map((t) => ({
              value: t.id,
              label: `${t.assignedToMe ? '★ ' : ''}${t.title}`,
            })),
          ]}
          hint={
            projectId && tasks && tasks.length === 0 ? 'This project has no open tasks.' : undefined
          }
        />
        <TextField
          label="Note (optional)"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <label className="flex items-center gap-2 text-body text-ink-2">
          <input
            type="checkbox"
            className="size-4 accent-blue"
            checked={isBillable}
            onChange={(event) => setIsBillable(event.target.checked)}
          />
          Billable
        </label>
        {error && <p className="text-sub text-red">{error}</p>}
      </div>
    </Dialog>
  );
}
