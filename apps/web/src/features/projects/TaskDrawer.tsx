import { useRef, useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Download, Paperclip, Send, Trash2 } from 'lucide-react';
import {
  createTaskSchema,
  TASK_ATTACHMENT_EXTENSIONS,
  validateTaskAttachment,
  type CreateTaskInput,
} from '@opsvera/shared';
import { Drawer } from '../../components/ui/Drawer';
import { Button, IconButton } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { SelectField, TextAreaField, TextField } from '../../components/ui/Field';
import { Skeleton } from '../../components/ui/Skeleton';
import { api, ApiRequestError } from '../../lib/api';
import { blankAsNull, blankToNull, mapApiErrorToFields } from '../../lib/forms';
import { formatDisplayDate } from '../../lib/format';
import { useAuth } from '../../providers/AuthProvider';
import { taskAccess } from './taskAccess';
import { useProject } from './useProjects';
import {
  PRIORITY_LABEL,
  TASK_COLUMNS,
  TASK_STATUS_LABEL,
  useAddAttachment,
  useAddComment,
  useCreateTask,
  useDeleteTask,
  useRemoveAttachment,
  useTask,
  useUpdateTask,
} from './useTasks';

type FormValues = CreateTaskInput;

const OPTIONAL = [
  'description',
  'milestoneId',
  'assigneeId',
  'startDate',
  'dueDate',
  'estimatedHours',
];

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * One drawer for creating and working a task: the fields, the discussion and
 * the files. Opened from the board, the list and the Tasks page.
 */
export function TaskDrawer({
  projectId,
  taskId,
  defaultStatus = 'TODO',
  onClose,
}: {
  projectId: string;
  /** null = a new task on `projectId`. */
  taskId: string | null;
  defaultStatus?: FormValues['status'];
  onClose: () => void;
}) {
  const { user, can } = useAuth();
  const { data: project } = useProject(projectId);
  const { data: task, isLoading } = useTask(taskId);
  const isNew = taskId === null;

  if (!isNew && (isLoading || !task || !project)) {
    return (
      <Drawer open onClose={onClose} width="lg" title="Task">
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </Drawer>
    );
  }

  const access = taskAccess(user, can, task ?? null);
  const canEdit = isNew ? access.canCreate : access.canEdit;

  return (
    <TaskDrawerBody
      key={taskId ?? 'new'}
      projectId={projectId}
      taskId={taskId}
      defaultStatus={defaultStatus}
      canEdit={canEdit}
      canReassign={isNew ? access.canCreate : access.canReassign}
      canDelete={access.canDelete}
      onClose={onClose}
    />
  );
}

function TaskDrawerBody({
  projectId,
  taskId,
  defaultStatus,
  canEdit,
  canReassign,
  canDelete,
  onClose,
}: {
  projectId: string;
  taskId: string | null;
  defaultStatus: FormValues['status'];
  canEdit: boolean;
  canReassign: boolean;
  canDelete: boolean;
  onClose: () => void;
}) {
  const { data: project } = useProject(projectId);
  const { data: task } = useTask(taskId);
  const create = useCreateTask();
  const update = useUpdateTask();
  const remove = useDeleteTask();
  const isNew = taskId === null;
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const members = (project?.members ?? []).filter((m) => m.isActive);
  const assignees = new Map(members.map((m) => [m.employeeId, m.fullName]));
  if (project?.projectManager) {
    assignees.set(
      project.projectManager.id,
      `${project.projectManager.firstName} ${project.projectManager.lastName}`,
    );
  }

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: blankAsNull<FormValues>(
      zodResolver(createTaskSchema) as unknown as Resolver<FormValues>,
      OPTIONAL,
    ),
    defaultValues: task
      ? {
          title: task.title,
          description: task.description ?? '',
          status: task.status,
          priority: task.priority,
          assigneeId: task.assigneeId ?? '',
          milestoneId: task.milestoneId ?? '',
          startDate: task.startDate?.slice(0, 10) ?? '',
          dueDate: task.dueDate?.slice(0, 10) ?? '',
          estimatedHours: (task.estimatedHours ?? '') as unknown as number,
        }
      : {
          title: '',
          description: '',
          status: defaultStatus,
          priority: 'MEDIUM',
          assigneeId: '',
          milestoneId: '',
          startDate: '',
          dueDate: '',
          estimatedHours: '' as unknown as number,
        },
  });

  async function onSubmit(values: FormValues) {
    const input = blankToNull(values) as FormValues;
    try {
      if (isNew) {
        await create.mutateAsync({ projectId, input });
        toast.success('Task added');
      } else {
        await update.mutateAsync({ id: taskId, input });
        toast.success('Task updated');
      }
      onClose();
    } catch (error) {
      const { fields, message } = mapApiErrorToFields(error);
      for (const [path, text] of Object.entries(fields)) {
        setError(path as keyof FormValues, { message: text });
      }
      if (message) toast.error(message);
    }
  }

  async function confirmDelete() {
    if (!taskId) return;
    try {
      await remove.mutateAsync(taskId);
      toast.success('Task deleted');
      onClose();
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not delete the task.');
      setConfirmingDelete(false);
    }
  }

  const closedProject = project?.status === 'CANCELLED' || project?.status === 'COMPLETED';
  const editable = canEdit && !closedProject;

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        width="lg"
        title={isNew ? 'New task' : (task?.title ?? 'Task')}
        subtitle={project ? `${project.projectCode} · ${project.name}` : undefined}
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            <div>
              {!isNew && canDelete && (
                <Button
                  variant="danger"
                  leadingIcon={<Trash2 />}
                  onClick={() => setConfirmingDelete(true)}
                >
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                {editable ? 'Cancel' : 'Close'}
              </Button>
              {editable && (
                <Button
                  variant="primary"
                  loading={isSubmitting}
                  disabled={!isNew && !isDirty}
                  onClick={handleSubmit(onSubmit)}
                >
                  {isNew ? 'Add task' : 'Save changes'}
                </Button>
              )}
            </div>
          </div>
        }
      >
        <div className="space-y-6">
          {closedProject && (
            <p className="rounded-card bg-surface-2 p-3 text-sub text-ink-2">
              This project is {project?.status.toLowerCase()}, so its tasks are read-only. Reopen
              the project to change them.
            </p>
          )}
          {!closedProject && !canEdit && !isNew && (
            <p className="rounded-card bg-surface-2 p-3 text-sub text-ink-2">
              You can read this task and comment on it. Only its assignee or a planner can change
              it.
            </p>
          )}

          <form noValidate onSubmit={handleSubmit(onSubmit)}>
            <fieldset disabled={!editable} className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Title"
                required
                containerClassName="sm:col-span-2"
                error={errors.title?.message}
                {...register('title')}
              />
              <SelectField
                label="Status"
                error={errors.status?.message}
                options={TASK_COLUMNS.map((s) => ({ value: s, label: TASK_STATUS_LABEL[s] }))}
                {...register('status')}
              />
              <SelectField
                label="Priority"
                error={errors.priority?.message}
                options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))}
                {...register('priority')}
              />
              <SelectField
                label="Assignee"
                placeholder="Unassigned"
                hint={
                  canReassign ? 'Only people on the project team.' : 'Only a planner can reassign.'
                }
                disabled={!canReassign || !editable}
                error={errors.assigneeId?.message}
                options={[...assignees].map(([value, label]) => ({ value, label }))}
                {...register('assigneeId')}
              />
              <SelectField
                label="Milestone"
                placeholder="None"
                error={errors.milestoneId?.message}
                options={(project?.milestones ?? []).map((m) => ({ value: m.id, label: m.name }))}
                {...register('milestoneId')}
              />
              <TextField
                label="Start date"
                type="date"
                error={errors.startDate?.message}
                {...register('startDate')}
              />
              <TextField
                label="Due date"
                type="date"
                error={errors.dueDate?.message}
                {...register('dueDate')}
              />
              <TextField
                label="Estimated hours"
                type="number"
                min={0}
                step="any"
                error={errors.estimatedHours?.message}
                {...register('estimatedHours')}
              />
              {task && (
                <TextField
                  label="Logged hours"
                  value={`${Number(task.loggedHours)} h`}
                  readOnly
                  disabled
                />
              )}
              <TextAreaField
                label="Description"
                rows={4}
                containerClassName="sm:col-span-2"
                error={errors.description?.message}
                {...register('description')}
              />
            </fieldset>
          </form>

          {task && taskId && (
            <>
              <Attachments taskId={taskId} task={task} canEdit={editable} />
              <Comments taskId={taskId} task={task} />
            </>
          )}
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={confirmDelete}
        loading={remove.isPending}
        destructive
        title="Delete this task?"
        description="Its comments and files go with it. A task with time logged against it cannot be deleted — mark it done instead."
        confirmLabel="Delete task"
      />
    </>
  );
}

type TaskData = NonNullable<ReturnType<typeof useTask>['data']>;

function Attachments({
  taskId,
  task,
  canEdit,
}: {
  taskId: string;
  task: TaskData;
  canEdit: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const add = useAddAttachment();
  const remove = useRemoveAttachment();

  async function pick(file: File | undefined) {
    if (!file) return;
    const verdict = validateTaskAttachment({ name: file.name, size: file.size });
    if (!verdict.ok) {
      toast.error(verdict.message);
      return;
    }
    try {
      await add.mutateAsync({ id: taskId, file });
      toast.success(`${file.name} attached`);
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Upload failed.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-title font-heavy text-ink">Files</h3>
        {canEdit && (
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<Paperclip />}
            loading={add.isPending}
            onClick={() => inputRef.current?.click()}
          >
            Attach file
          </Button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label="Attach a file"
        accept={TASK_ATTACHMENT_EXTENSIONS.join(',')}
        onChange={(event) => void pick(event.target.files?.[0])}
      />
      {task.attachments.length === 0 ? (
        <p className="text-sub text-muted">
          No files yet. Drawings, models, sheets and photos up to 25 MB.
        </p>
      ) : (
        <ul className="space-y-2">
          {task.attachments.map((file) => (
            <li
              key={file.id}
              className="flex items-center justify-between gap-2 rounded-card border border-line bg-surface-2 p-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-body font-heavy text-ink">{file.fileName}</p>
                <p className="text-micro tracking-normal text-muted">
                  {formatSize(file.sizeBytes)} · {formatDisplayDate(file.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <IconButton
                  label={`Download ${file.fileName}`}
                  size="sm"
                  onClick={() =>
                    api
                      .download(`/tasks/${taskId}/attachments/${file.id}/download`, file.fileName)
                      .catch(() => toast.error('Could not download that file.'))
                  }
                >
                  <Download />
                </IconButton>
                {canEdit && (
                  <IconButton
                    label={`Remove ${file.fileName}`}
                    size="sm"
                    onClick={() =>
                      remove
                        .mutateAsync({ id: taskId, attachmentId: file.id })
                        .catch(() => toast.error('Could not remove that file.'))
                    }
                  >
                    <Trash2 />
                  </IconButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Comments({ taskId, task }: { taskId: string; task: TaskData }) {
  const add = useAddComment();
  const [body, setBody] = useState('');

  async function post() {
    if (!body.trim()) return;
    try {
      await add.mutateAsync({ id: taskId, input: { body } });
      setBody('');
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : 'Could not post the comment.');
    }
  }

  return (
    <section>
      <h3 className="mb-2.5 text-title font-heavy text-ink">
        Discussion <span className="text-sub font-normal text-muted">({task.comments.length})</span>
      </h3>
      {task.comments.length > 0 && (
        <ul className="mb-3 space-y-2.5">
          {task.comments.map((comment) => (
            <li key={comment.id} className="rounded-card bg-surface-2 p-3">
              <p className="text-sub">
                <span className="font-heavy text-ink">{comment.author}</span>
                <span className="text-muted"> · {formatDisplayDate(comment.createdAt)}</span>
              </p>
              <p className="mt-1 whitespace-pre-line text-body text-ink-2">{comment.body}</p>
            </li>
          ))}
        </ul>
      )}
      <TextAreaField
        label="Add a comment"
        srOnlyLabel
        rows={2}
        placeholder="Write a comment…"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void post();
        }}
      />
      <div className="mt-2 flex justify-end">
        <Button
          size="sm"
          variant="primary"
          leadingIcon={<Send />}
          loading={add.isPending}
          disabled={!body.trim()}
          onClick={post}
        >
          Comment
        </Button>
      </div>
    </section>
  );
}
