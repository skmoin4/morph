import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  CalendarDays,
  Clock,
  KanbanSquare,
  List,
  MessageSquare,
  Paperclip,
  Plus,
} from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { Button } from '../../components/ui/Button';
import { CellStack, DataTable } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField } from '../../components/ui/Field';
import { Avatar } from '../../components/ui/Avatar';
import { Skeleton } from '../../components/ui/Skeleton';
import { ApiRequestError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatDisplayDate } from '../../lib/format';
import { useAuth } from '../../providers/AuthProvider';
import { PriorityPill } from './badges';
import { taskAccess } from './taskAccess';
import { TaskDrawer } from './TaskDrawer';
import type { ProjectDetail, TaskStatus } from './useProjects';
import {
  PRIORITY_LABEL,
  TASK_COLUMNS,
  TASK_STATUS_LABEL,
  useMoveTask,
  useTasks,
  type TaskListItem,
} from './useTasks';

type View = 'board' | 'list';

const COLUMN_TONE: Record<TaskStatus, string> = {
  TODO: 'bg-muted-2',
  IN_PROGRESS: 'bg-blue',
  REVIEW: 'bg-amber',
  DONE: 'bg-green',
};

/**
 * The project's tasks as a Kanban board or a list.
 *
 * The board is optimistic: a dropped card moves at once and snaps back, with
 * the reason, if the server refuses. Every card also has a status menu, so the
 * board is fully usable without a mouse.
 */
export function TaskBoard({ project }: { project: ProjectDetail }) {
  const { user, can } = useAuth();
  const [view, setView] = useState<View>('board');
  const [assigneeId, setAssigneeId] = useState('');
  const [priority, setPriority] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [open, setOpen] = useState<{ taskId: string | null; status?: TaskStatus } | null>(null);

  // One stable query for the whole board; filters below are applied in the
  // browser so the optimistic cache key never changes under a drag.
  const boardFilters = useMemo(
    () => ({ projectId: project.id, pageSize: 200, sort: 'sortOrder:asc' }),
    [project.id],
  );
  const { data, isLoading } = useTasks(boardFilters);
  const move = useMoveTask(boardFilters);

  const closed = project.status === 'CANCELLED' || project.status === 'COMPLETED';
  const canCreate = can('task.create') && !closed;

  const tasks = useMemo(() => {
    return (data?.data ?? []).filter(
      (t) =>
        (!assigneeId || t.assigneeId === assigneeId) &&
        (!priority || t.priority === priority) &&
        (!mineOnly || t.assigneeId === user?.employeeId),
    );
  }, [data, assigneeId, priority, mineOnly, user?.employeeId]);

  const byColumn = useMemo(() => {
    const columns: Record<TaskStatus, TaskListItem[]> = {
      TODO: [],
      IN_PROGRESS: [],
      REVIEW: [],
      DONE: [],
    };
    for (const task of tasks) columns[task.status].push(task);
    for (const column of TASK_COLUMNS) columns[column].sort((a, b) => a.sortOrder - b.sortOrder);
    return columns;
  }, [tasks]);

  const people = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of project.members.filter((m) => m.isActive)) map.set(m.employeeId, m.fullName);
    return [...map].map(([value, label]) => ({ value, label }));
  }, [project.members]);

  function moveTask(task: TaskListItem, status: TaskStatus, beforeTaskId?: string | null) {
    if (task.status === status && !beforeTaskId) return;
    move.mutate(
      { id: task.id, input: { status, beforeTaskId: beforeTaskId ?? null } },
      {
        onError: (error) =>
          toast.error(
            error instanceof ApiRequestError
              ? error.message
              : 'Could not move the task. It was put back.',
          ),
      },
    );
  }

  const hasFilters = Boolean(assigneeId || priority || mineOnly);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2.5">
          <div
            role="group"
            aria-label="View"
            className="flex rounded-control border border-line bg-surface p-0.5"
          >
            {(
              [
                ['board', 'Board', <KanbanSquare key="b" />],
                ['list', 'List', <List key="l" />],
              ] as const
            ).map(([key, label, icon]) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                onClick={() => setView(key)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-sub font-heavy transition-colors [&>svg]:size-4',
                  view === key ? 'bg-blue text-white' : 'text-muted hover:text-ink-2',
                )}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
          <SelectField
            label="Assignee"
            srOnlyLabel
            placeholder="Anyone"
            containerClassName="w-44"
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
            options={people}
          />
          <SelectField
            label="Priority"
            srOnlyLabel
            placeholder="Any priority"
            containerClassName="w-40"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))}
          />
          {user?.employeeId && (
            <label className="flex h-[38px] items-center gap-2 text-sub font-heavy text-ink-2">
              <input
                type="checkbox"
                className="size-4 accent-blue"
                checked={mineOnly}
                onChange={(event) => setMineOnly(event.target.checked)}
              />
              Only mine
            </label>
          )}
        </div>
        {canCreate && (
          <Button
            variant="primary"
            leadingIcon={<Plus />}
            onClick={() => setOpen({ taskId: null })}
          >
            New task
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {TASK_COLUMNS.map((c) => (
            <Skeleton key={c} className="h-56 w-full" />
          ))}
        </div>
      ) : (data?.data.length ?? 0) === 0 ? (
        <EmptyState
          icon={<KanbanSquare />}
          title="No tasks yet"
          description="Break the work into tasks, assign them to the team, and move them across the board as they progress."
          action={
            canCreate ? (
              <Button
                size="sm"
                variant="primary"
                leadingIcon={<Plus />}
                onClick={() => setOpen({ taskId: null })}
              >
                New task
              </Button>
            ) : undefined
          }
        />
      ) : view === 'board' ? (
        <Board
          byColumn={byColumn}
          user={user}
          can={can}
          closed={closed}
          canCreate={canCreate}
          onOpen={(task) => setOpen({ taskId: task.id })}
          onAdd={(status) => setOpen({ taskId: null, status })}
          onMove={moveTask}
        />
      ) : (
        <TaskList tasks={tasks} onOpen={(task) => setOpen({ taskId: task.id })} />
      )}

      {hasFilters && tasks.length === 0 && (data?.data.length ?? 0) > 0 && (
        <p className="text-sub text-muted">No tasks match these filters.</p>
      )}

      {open && (
        <TaskDrawer
          projectId={project.id}
          taskId={open.taskId}
          defaultStatus={open.status}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function Board({
  byColumn,
  user,
  can,
  closed,
  canCreate,
  onOpen,
  onAdd,
  onMove,
}: {
  byColumn: Record<TaskStatus, TaskListItem[]>;
  user: ReturnType<typeof useAuth>['user'];
  can: (permission: string) => boolean;
  closed: boolean;
  canCreate: boolean;
  onOpen: (task: TaskListItem) => void;
  onAdd: (status: TaskStatus) => void;
  onMove: (task: TaskListItem, status: TaskStatus, beforeTaskId?: string | null) => void;
}) {
  const [dragging, setDragging] = useState<TaskListItem | null>(null);
  const [target, setTarget] = useState<{ status: TaskStatus; beforeId: string | null } | null>(
    null,
  );

  function overCard(
    event: React.DragEvent,
    status: TaskStatus,
    card: TaskListItem,
    next: TaskListItem | undefined,
  ) {
    if (!dragging) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const upperHalf = event.clientY < rect.top + rect.height / 2;
    setTarget({ status, beforeId: upperHalf ? card.id : (next?.id ?? null) });
  }

  function drop() {
    if (dragging && target) onMove(dragging, target.status, target.beforeId);
    setDragging(null);
    setTarget(null);
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {TASK_COLUMNS.map((status) => {
        const cards = byColumn[status];
        const active = target?.status === status;

        return (
          <section
            key={status}
            aria-label={`${TASK_STATUS_LABEL[status]}, ${cards.length} tasks`}
            onDragOver={(event) => {
              if (!dragging) return;
              event.preventDefault();
              if (target?.status !== status || target.beforeId !== null) {
                // Over empty column space: drop at the bottom.
                setTarget({ status, beforeId: null });
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              drop();
            }}
            className={cn(
              'flex min-h-[220px] flex-col rounded-card border bg-surface-2 p-2.5 transition-colors',
              active ? 'border-blue-2 bg-pill-blue-bg/40' : 'border-line',
            )}
          >
            <header className="mb-2.5 flex items-center justify-between px-1">
              <h3 className="flex items-center gap-2 text-sub font-heavy text-ink">
                <span aria-hidden className={cn('size-2 rounded-full', COLUMN_TONE[status])} />
                {TASK_STATUS_LABEL[status]}
                <span className="rounded-full bg-line-soft px-1.5 text-micro font-black text-muted">
                  {cards.length}
                </span>
              </h3>
              {canCreate && (
                <button
                  type="button"
                  aria-label={`Add a task to ${TASK_STATUS_LABEL[status]}`}
                  onClick={() => onAdd(status)}
                  className="grid size-6 place-items-center rounded-md text-muted hover:bg-line-soft hover:text-ink-2"
                >
                  <Plus className="size-4" />
                </button>
              )}
            </header>

            <ul className="flex flex-1 flex-col gap-2">
              {cards.map((task, index) => {
                const access = taskAccess(user, can, task);
                const draggable = access.canEdit && !closed;
                const showLine = active && target?.beforeId === task.id && dragging?.id !== task.id;

                return (
                  <li
                    key={task.id}
                    onDragOver={(event) => overCard(event, status, task, cards[index + 1])}
                  >
                    {showLine && <div aria-hidden className="mb-2 h-0.5 rounded-full bg-blue" />}
                    <TaskCard
                      task={task}
                      draggable={draggable}
                      dragging={dragging?.id === task.id}
                      onDragStart={() => setDragging(task)}
                      onDragEnd={() => {
                        setDragging(null);
                        setTarget(null);
                      }}
                      onOpen={() => onOpen(task)}
                      onMove={draggable ? (to) => onMove(task, to) : undefined}
                    />
                  </li>
                );
              })}
              {active && target?.beforeId === null && cards.length > 0 && dragging && (
                <li aria-hidden className="h-0.5 rounded-full bg-blue" />
              )}
              {cards.length === 0 && (
                <li className="grid flex-1 place-items-center rounded-card border border-dashed border-line py-6 text-sub text-muted">
                  Nothing here
                </li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function TaskCard({
  task,
  draggable,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
  onMove,
}: {
  task: TaskListItem;
  draggable: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
  onMove?: (status: TaskStatus) => void;
}) {
  return (
    <article
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', task.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'group rounded-card border border-line bg-surface p-3 shadow-card-soft transition-shadow hover:shadow-card',
        draggable && 'cursor-grab active:cursor-grabbing',
        dragging && 'opacity-40',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="block w-full rounded text-left focus-visible:outline-none"
      >
        <p className="text-body font-heavy text-ink">{task.title}</p>
      </button>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PriorityPill priority={task.priority} />
        {task.milestone && (
          <span className="max-w-full truncate rounded-full bg-pill-violet-bg px-2 py-1 text-pill font-heavy text-pill-violet-fg">
            {task.milestone.name}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-sub text-muted">
        <span className="flex min-w-0 items-center gap-1.5">
          {task.assigneeName ? (
            <>
              <Avatar name={task.assigneeName} size="sm" />
              <span className="truncate">{task.assigneeName}</span>
            </>
          ) : (
            <span>Unassigned</span>
          )}
        </span>
        <span className="flex items-center gap-2.5">
          {task.dueDate && (
            <span
              className={cn(
                'inline-flex items-center gap-1',
                task.isOverdue && 'font-heavy text-red',
              )}
              title={task.isOverdue ? 'Overdue' : 'Due date'}
            >
              <CalendarDays aria-hidden className="size-3.5" />
              {formatDisplayDate(task.dueDate)}
            </span>
          )}
          {task.estimatedHours && (
            <span className="inline-flex items-center gap-1" title="Logged / estimated hours">
              <Clock aria-hidden className="size-3.5" />
              {Number(task.loggedHours)}/{Number(task.estimatedHours)}h
            </span>
          )}
          {task._count.comments > 0 && (
            <span className="inline-flex items-center gap-1" title="Comments">
              <MessageSquare aria-hidden className="size-3.5" />
              {task._count.comments}
            </span>
          )}
          {task._count.attachments > 0 && (
            <span className="inline-flex items-center gap-1" title="Files">
              <Paperclip aria-hidden className="size-3.5" />
              {task._count.attachments}
            </span>
          )}
        </span>
      </div>

      {onMove && (
        // The keyboard route to the same move a drag makes.
        <div className="mt-2 hidden group-focus-within:block group-hover:block">
          <select
            aria-label={`Move “${task.title}” to`}
            value={task.status}
            onChange={(event) => onMove(event.target.value as TaskStatus)}
            className="h-8 w-full rounded-control border border-line bg-surface px-2 text-sub text-ink-2"
          >
            {TASK_COLUMNS.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      )}
    </article>
  );
}

function TaskList({
  tasks,
  onOpen,
}: {
  tasks: TaskListItem[];
  onOpen: (task: TaskListItem) => void;
}) {
  const columns = useMemo<ColumnDef<TaskListItem, unknown>[]>(
    () => [
      {
        header: 'Task',
        id: 'title',
        enableSorting: false,
        meta: { className: 'w-[34%] max-w-0' },
        cell: ({ row }) => (
          <CellStack
            title={row.original.title}
            subtitle={row.original.milestone?.name ?? undefined}
          />
        ),
      },
      {
        header: 'Assignee',
        id: 'assignee',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{row.original.assigneeName ?? '—'}</span>
        ),
      },
      {
        header: 'Status',
        id: 'status',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span
              aria-hidden
              className={cn('size-2 rounded-full', COLUMN_TONE[row.original.status])}
            />
            {TASK_STATUS_LABEL[row.original.status]}
          </span>
        ),
      },
      {
        header: 'Priority',
        id: 'priority',
        enableSorting: false,
        cell: ({ row }) => <PriorityPill priority={row.original.priority} />,
      },
      {
        header: 'Due',
        id: 'due',
        enableSorting: false,
        cell: ({ row }) =>
          row.original.dueDate ? (
            <span
              className={cn('whitespace-nowrap', row.original.isOverdue && 'font-heavy text-red')}
            >
              {formatDisplayDate(row.original.dueDate)}
            </span>
          ) : (
            <span className="text-muted">—</span>
          ),
      },
      {
        header: 'Hours',
        id: 'hours',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {Number(row.original.loggedHours)}
            {row.original.estimatedHours ? ` / ${Number(row.original.estimatedHours)}` : ''} h
          </span>
        ),
      },
    ],
    [],
  );

  return (
    <div className="overflow-hidden rounded-panel border border-line bg-surface shadow-card">
      <DataTable
        data={tasks}
        columns={columns}
        minWidth={820}
        getRowId={(row) => row.id}
        onRowClick={onOpen}
        empty={<EmptyState title="No tasks match these filters" />}
      />
    </div>
  );
}
