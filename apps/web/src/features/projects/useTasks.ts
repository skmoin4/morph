import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  CreateTaskInput,
  MoveTaskInput,
  TaskCommentInput,
  UpdateTaskInput,
} from '@opsvera/shared';
import { api } from '../../lib/api';
import type { Paginated } from '../settings/useSettings';
import { projectKeys, type TaskStatus } from './useProjects';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface TaskListItem {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  startDate: string | null;
  dueDate: string | null;
  estimatedHours: string | null;
  loggedHours: string;
  sortOrder: number;
  completedAt: string | null;
  projectId: string;
  milestoneId: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  isOverdue: boolean;
  assignee: { id: string; firstName: string; lastName: string; employeeCode: string } | null;
  milestone: { id: string; name: string } | null;
  project: { id: string; projectCode: string; name: string; status: string };
  _count: { comments: number; attachments: number };
}

export interface TaskDetail extends TaskListItem {
  comments: Array<{
    id: string;
    body: string;
    createdAt: string;
    author: string;
    authorId: string | null;
  }>;
  attachments: Array<{
    id: string;
    createdAt: string;
    fileName: string;
    sizeBytes: number;
    mimeType: string;
  }>;
}

export interface TaskFilters {
  q?: string;
  projectId?: string;
  assigneeId?: string;
  status?: string;
  priority?: string;
  mine?: boolean;
  overdue?: boolean;
  page?: number;
  pageSize?: number;
  sort?: string;
}

export const taskKeys = {
  all: ['tasks'] as const,
  list: (filters: TaskFilters) => ['tasks', 'list', filters] as const,
  detail: (id: string) => ['tasks', 'detail', id] as const,
};

export function useTasks(filters: TaskFilters, enabled = true) {
  return useQuery({
    queryKey: taskKeys.list(filters),
    queryFn: () =>
      api.get<Paginated<TaskListItem>>('/tasks', {
        q: filters.q,
        projectId: filters.projectId,
        assigneeId: filters.assigneeId,
        status: filters.status,
        priority: filters.priority,
        mine: filters.mine ? true : undefined,
        overdue: filters.overdue ? true : undefined,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 25,
        sort: filters.sort,
      }),
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function useTask(id: string | null) {
  return useQuery({
    queryKey: taskKeys.detail(id ?? ''),
    queryFn: () => api.get<TaskDetail>(`/tasks/${id}`),
    enabled: Boolean(id),
  });
}

/** A task change also moves the project's task counts and progress bars. */
function refresh(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: taskKeys.all });
  void queryClient.invalidateQueries({ queryKey: projectKeys.all });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, input }: { projectId: string; input: CreateTaskInput }) =>
      api.post<TaskDetail>(`/projects/${projectId}/tasks`, input),
    onSuccess: () => refresh(queryClient),
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTaskInput }) =>
      api.patch<TaskDetail>(`/tasks/${id}`, input),
    onSuccess: () => refresh(queryClient),
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/tasks/${id}`),
    onSuccess: () => refresh(queryClient),
  });
}

export function useAddComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: TaskCommentInput }) =>
      api.post<TaskDetail>(`/tasks/${id}/comments`, input),
    onSuccess: (task) => {
      queryClient.setQueryData(taskKeys.detail(task.id), task);
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'list'] });
    },
  });
}

export function useAddAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) =>
      api.upload<TaskDetail>(`/tasks/${id}/attachments`, file),
    onSuccess: (task) => {
      queryClient.setQueryData(taskKeys.detail(task.id), task);
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'list'] });
    },
  });
}

export function useRemoveAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, attachmentId }: { id: string; attachmentId: string }) =>
      api.delete<TaskDetail>(`/tasks/${id}/attachments/${attachmentId}`),
    onSuccess: (task) => {
      queryClient.setQueryData(taskKeys.detail(task.id), task);
      void queryClient.invalidateQueries({ queryKey: ['tasks', 'list'] });
    },
  });
}

/**
 * Kanban drop, applied to the board straight away and rolled back if the API
 * refuses. A drag that waits for the network feels broken; one that silently
 * snaps back without saying why feels worse, so the caller toasts the error.
 */
export function useMoveTask(boardFilters: TaskFilters) {
  const queryClient = useQueryClient();
  const key = taskKeys.list(boardFilters);

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MoveTaskInput }) =>
      api.post<TaskDetail>(`/tasks/${id}/move`, input),

    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks', 'list'] });
      const previous = queryClient.getQueryData<Paginated<TaskListItem>>(key);

      if (previous) {
        const moving = previous.data.find((t) => t.id === id);
        if (moving) {
          const others = previous.data.filter((t) => t.id !== id);
          const column = others.filter((t) => t.status === input.status);
          const at = input.beforeTaskId ? column.findIndex((t) => t.id === input.beforeTaskId) : -1;
          const target = at === -1 ? column.length : at;

          const reordered = [...column];
          reordered.splice(target, 0, { ...moving, status: input.status });
          const renumbered = reordered.map((t, i) => ({ ...t, sortOrder: i }));

          queryClient.setQueryData<Paginated<TaskListItem>>(key, {
            ...previous,
            data: [...others.filter((t) => t.status !== input.status), ...renumbered],
          });
        }
      }
      return { previous };
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },

    onSettled: () => refresh(queryClient),
  });
}

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  REVIEW: 'In review',
  DONE: 'Done',
};

export const TASK_COLUMNS: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];
