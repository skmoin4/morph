import { useMemo, useState } from 'react';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { ListChecks, Search } from 'lucide-react';
import { PageHeader } from '../components/layout/PageHeader';
import { Panel } from '../components/ui/Panel';
import { Button } from '../components/ui/Button';
import { CellStack, DataTable } from '../components/ui/DataTable';
import { EmptyState } from '../components/ui/EmptyState';
import { SelectField, TextField } from '../components/ui/Field';
import { cn } from '../lib/cn';
import { formatDisplayDate } from '../lib/format';
import { useAuth } from '../providers/AuthProvider';
import { PriorityPill } from '../features/projects/badges';
import { TaskDrawer } from '../features/projects/TaskDrawer';
import { useProjects } from '../features/projects/useProjects';
import {
  PRIORITY_LABEL,
  TASK_COLUMNS,
  TASK_STATUS_LABEL,
  useTasks,
  type TaskListItem,
} from '../features/projects/useTasks';

/**
 * Every task the caller can see, across projects. The Kanban board lives on the
 * project itself; this is the "what is on my plate" view.
 */
export function TasksPage() {
  const { user } = useAuth();

  const [q, setQ] = useState('');
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [mine, setMine] = useState(Boolean(user?.employeeId));
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'dueDate', desc: false }]);
  const [open, setOpen] = useState<TaskListItem | null>(null);

  const { data, isLoading, isFetching } = useTasks({
    q: q || undefined,
    projectId: projectId || undefined,
    status: status || undefined,
    priority: priority || undefined,
    mine,
    overdue,
    page,
    sort: sorting[0] ? `${sorting[0].id}:${sorting[0].desc ? 'desc' : 'asc'}` : undefined,
  });
  const { data: projects } = useProjects({ pageSize: 100, status: 'ACTIVE' });

  const reset =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
    };

  const columns = useMemo<ColumnDef<TaskListItem, unknown>[]>(
    () => [
      {
        header: 'Task',
        accessorKey: 'title',
        meta: { className: 'w-[32%] max-w-0' },
        cell: ({ row }) => (
          <CellStack
            title={row.original.title}
            subtitle={`${row.original.project.projectCode} · ${row.original.project.name}`}
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
        accessorKey: 'status',
        cell: ({ row }) => TASK_STATUS_LABEL[row.original.status],
      },
      {
        header: 'Priority',
        accessorKey: 'priority',
        cell: ({ row }) => <PriorityPill priority={row.original.priority} />,
      },
      {
        header: 'Due',
        accessorKey: 'dueDate',
        cell: ({ row }) =>
          row.original.dueDate ? (
            <span
              className={cn('whitespace-nowrap', row.original.isOverdue && 'font-heavy text-red')}
            >
              {formatDisplayDate(row.original.dueDate)}
              {row.original.isOverdue && ' · overdue'}
            </span>
          ) : (
            <span className="text-muted">—</span>
          ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Delivery"
        title="Tasks"
        subtitle="Everything assigned across your projects. Open a project for its Kanban board."
      />

      <Panel flush>
        <div className="flex flex-wrap items-end gap-2.5 border-b border-line px-4 py-3">
          <TextField
            label="Search"
            srOnlyLabel
            containerClassName="min-w-[200px] flex-1"
            placeholder="Search tasks…"
            leadingIcon={<Search />}
            value={q}
            onChange={(event) => reset(setQ)(event.target.value)}
          />
          <SelectField
            label="Project"
            srOnlyLabel
            placeholder="All projects"
            containerClassName="w-52"
            value={projectId}
            onChange={(event) => reset(setProjectId)(event.target.value)}
            options={(projects?.data ?? []).map((p) => ({
              value: p.id,
              label: `${p.projectCode} · ${p.name}`,
            }))}
          />
          <SelectField
            label="Status"
            srOnlyLabel
            placeholder="Any status"
            containerClassName="w-40"
            value={status}
            onChange={(event) => reset(setStatus)(event.target.value)}
            options={TASK_COLUMNS.map((s) => ({ value: s, label: TASK_STATUS_LABEL[s] }))}
          />
          <SelectField
            label="Priority"
            srOnlyLabel
            placeholder="Any priority"
            containerClassName="w-40"
            value={priority}
            onChange={(event) => reset(setPriority)(event.target.value)}
            options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))}
          />
          {user?.employeeId && (
            <label className="flex h-[38px] items-center gap-2 text-sub font-heavy text-ink-2">
              <input
                type="checkbox"
                className="size-4 accent-blue"
                checked={mine}
                onChange={(event) => reset(setMine)(event.target.checked)}
              />
              Assigned to me
            </label>
          )}
          <label className="flex h-[38px] items-center gap-2 text-sub font-heavy text-ink-2">
            <input
              type="checkbox"
              className="size-4 accent-blue"
              checked={overdue}
              onChange={(event) => reset(setOverdue)(event.target.checked)}
            />
            Overdue
          </label>
        </div>

        <DataTable
          data={data?.data ?? []}
          columns={columns}
          loading={isLoading}
          minWidth={820}
          getRowId={(row) => row.id}
          sorting={sorting}
          onSortingChange={(updater) => {
            setSorting(updater);
            setPage(1);
          }}
          onRowClick={(row) => setOpen(row)}
          empty={
            <EmptyState
              icon={<ListChecks />}
              title={mine ? 'Nothing is assigned to you' : 'No tasks match these filters'}
              description={
                mine
                  ? 'Untick “Assigned to me” to see every task on your projects.'
                  : 'Clear a filter, or open a project to add tasks.'
              }
            />
          }
        />

        {data && data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
            <p className="text-sub text-muted">
              Page {data.meta.page} of {data.meta.totalPages} · {data.meta.total} tasks
              {isFetching && ' · updating…'}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={page >= data.meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Panel>

      {open && (
        <TaskDrawer projectId={open.projectId} taskId={open.id} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
