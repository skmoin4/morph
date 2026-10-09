import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddProjectMemberInput,
  ChangeProjectStatusInput,
  MilestoneInput,
  UpdateMilestoneInput,
  UpdateProjectInput,
  UpdateProjectMemberInput,
} from '@opsvera/shared';
import { api } from '../../lib/api';
import type { Paginated } from '../settings/useSettings';

export type ProjectStatus = 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
export type ProjectHealth = 'HEALTHY' | 'AT_RISK' | 'CRITICAL';
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';

export interface TaskStats {
  TODO: number;
  IN_PROGRESS: number;
  REVIEW: number;
  DONE: number;
  total: number;
}

export interface PersonRef {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
}

export interface ProjectListItem {
  id: string;
  projectCode: string;
  name: string;
  status: ProjectStatus;
  health: ProjectHealth;
  startDate: string | null;
  endDate: string | null;
  billingType: 'FIXED' | 'HOURLY' | 'MILESTONE';
  budgetHours: string;
  actualHours: string;
  hoursBurnPercent: number | null;
  /** Each of these is stripped by the API unless the caller holds the matching permission. */
  projectValue?: string;
  actualTotalCost?: string;
  marginAmount?: string;
  marginPercent?: number | null;
  client: { id: string; name: string };
  projectType: { id: string; name: string; shortCode: string; colorToken: string | null };
  office: { id: string; name: string; shortCode: string };
  projectManager: PersonRef | null;
  _count: { members: number };
  tasks: TaskStats;
}

export interface ProjectMember {
  id: string;
  employeeId: string;
  fullName: string;
  roleOnProject: string | null;
  allocationPercent: number;
  joinedOn: string | null;
  leftOn: string | null;
  isActive: boolean;
  employee: {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    designation: { name: string } | null;
  };
}

export interface Milestone {
  id: string;
  name: string;
  description: string | null;
  dueDate: string;
  completedOn: string | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  value?: string | null;
  _count: { tasks: number };
}

export interface ProjectDetail extends Omit<ProjectListItem, '_count'> {
  description: string | null;
  completedAt: string | null;
  projectManagerId: string | null;
  scheduled: boolean;
  booking: {
    id: string;
    bookingNumber: string;
    bookingDate: string;
    status: string;
    confirmedAt: string | null;
    scopeDescription: string | null;
    confirmation: {
      type: 'EMAIL' | 'VERBAL';
      emailReceivedAt: string | null;
      emailDocumentId: string | null;
      confirmedByName: string | null;
      confirmedOn: string | null;
      verbalMode: 'CALL' | 'MEETING' | null;
      verbalSummary: string | null;
      poNumber: string | null;
    } | null;
  };
  members: ProjectMember[];
  milestones: Milestone[];
}

export interface ProjectSummary {
  active: number;
  onHold: number;
  completed: number;
  cancelled: number;
  atRisk: number;
  overBudgetHours: number;
}

export interface ProjectFilters {
  q?: string;
  status?: string;
  health?: string;
  clientId?: string;
  officeId?: string;
  projectTypeId?: string;
  projectManagerId?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}

export interface TeamLookup {
  employees: Array<{
    id: string;
    employeeCode: string;
    fullName: string;
    designation: string | null;
    office: string;
  }>;
}

export const projectKeys = {
  all: ['projects'] as const,
  list: (filters: ProjectFilters) => ['projects', 'list', filters] as const,
  detail: (id: string) => ['projects', 'detail', id] as const,
  summary: ['projects', 'summary'] as const,
  lookups: ['projects', 'lookups'] as const,
};

export function useProjects(filters: ProjectFilters) {
  return useQuery({
    queryKey: projectKeys.list(filters),
    queryFn: () =>
      api.get<Paginated<ProjectListItem>>('/projects', {
        q: filters.q,
        status: filters.status,
        health: filters.health,
        clientId: filters.clientId,
        officeId: filters.officeId,
        projectTypeId: filters.projectTypeId,
        projectManagerId: filters.projectManagerId,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 25,
        sort: filters.sort,
      }),
    placeholderData: (previous) => previous,
  });
}

export function useProject(id: string | null | undefined) {
  return useQuery({
    queryKey: projectKeys.detail(id ?? ''),
    queryFn: () => api.get<ProjectDetail>(`/projects/${id}`),
    enabled: Boolean(id),
  });
}

export function useProjectSummary(enabled = true) {
  return useQuery({
    queryKey: projectKeys.summary,
    queryFn: () => api.get<ProjectSummary>('/projects/summary'),
    enabled,
  });
}

export function useTeamLookup(enabled: boolean) {
  return useQuery({
    queryKey: projectKeys.lookups,
    queryFn: () => api.get<TeamLookup>('/projects/lookups'),
    enabled,
    staleTime: 60_000,
  });
}

/** Any change to a project also moves the list counts, the KPIs and the 360. */
function useProjectMutation<TVariables, TResult>(run: (variables: TVariables) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
      // A project's status or team feeds the booking register's KPIs too.
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}

export const useUpdateProject = () =>
  useProjectMutation(({ id, input }: { id: string; input: UpdateProjectInput }) =>
    api.patch<ProjectDetail>(`/projects/${id}`, input),
  );

export const useChangeProjectStatus = () =>
  useProjectMutation(({ id, input }: { id: string; input: ChangeProjectStatusInput }) =>
    api.post<ProjectDetail>(`/projects/${id}/status`, input),
  );

export const useAddMember = () =>
  useProjectMutation(({ id, input }: { id: string; input: AddProjectMemberInput }) =>
    api.post<ProjectDetail>(`/projects/${id}/members`, input),
  );

export const useUpdateMember = () =>
  useProjectMutation(
    ({ id, memberId, input }: { id: string; memberId: string; input: UpdateProjectMemberInput }) =>
      api.patch<ProjectDetail>(`/projects/${id}/members/${memberId}`, input),
  );

export const useRemoveMember = () =>
  useProjectMutation(({ id, memberId }: { id: string; memberId: string }) =>
    api.delete<ProjectDetail>(`/projects/${id}/members/${memberId}`),
  );

export const useCreateMilestone = () =>
  useProjectMutation(({ id, input }: { id: string; input: MilestoneInput }) =>
    api.post<Milestone>(`/projects/${id}/milestones`, input),
  );

export const useUpdateMilestone = () =>
  useProjectMutation(
    ({
      id,
      milestoneId,
      input,
    }: {
      id: string;
      milestoneId: string;
      input: UpdateMilestoneInput;
    }) => api.patch<Milestone>(`/projects/${id}/milestones/${milestoneId}`, input),
  );

export const useDeleteMilestone = () =>
  useProjectMutation(({ id, milestoneId }: { id: string; milestoneId: string }) =>
    api.delete<void>(`/projects/${id}/milestones/${milestoneId}`),
  );

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const HEALTH_LABEL: Record<ProjectHealth, string> = {
  HEALTHY: 'On track',
  AT_RISK: 'At risk',
  CRITICAL: 'Critical',
};

export function personName(person: { firstName: string; lastName: string } | null | undefined) {
  return person ? `${person.firstName} ${person.lastName}` : '—';
}
