import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ShiftAssignmentInput, ShiftInput } from '@opsvera/shared';
import { api } from '../../lib/api';
import type { Paginated } from '../settings/useSettings';

export interface Shift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  breakMinutes: number;
  graceMinutes: number;
  isDefault: boolean;
  isActive: boolean;
  assignmentCount: number;
  currentAssignments: number;
}

export interface ShiftAssignment {
  id: string;
  shiftId: string;
  effectiveFrom: string;
  /** Exclusive: the first day the assignment no longer applies. */
  effectiveTo: string | null;
  weeklyOffDays: number[] | null;
  employee: { id: string; employeeCode: string; fullName: string } | null;
  department: { id: string; name: string } | null;
}

export type RosterCell =
  | { date: string; kind: 'NONE' }
  | { date: string; kind: 'OFF' }
  | { date: string; kind: 'HOLIDAY'; label: string }
  | { date: string; kind: 'LEAVE' }
  | {
      date: string;
      kind: 'SHIFT';
      shiftId: string | null;
      shift: string | null;
      start: string | null;
      end: string | null;
      halfLeave: 'FIRST_HALF' | 'SECOND_HALF' | null;
    };

export interface RosterRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  office: string;
  department: string | null;
  days: RosterCell[];
}

export interface Roster extends Paginated<RosterRow> {
  weekStart: string;
  weekEnd: string;
  days: string[];
}

export interface ShiftLookups {
  employees: Array<{ id: string; employeeCode: string; fullName: string; office: string }>;
  departments: Array<{ id: string; name: string }>;
}

export const shiftKeys = {
  all: ['shifts'] as const,
  list: ['shifts', 'list'] as const,
  assignments: (id: string) => ['shifts', 'assignments', id] as const,
  roster: (filters: object) => ['shifts', 'roster', filters] as const,
  lookups: ['shifts', 'lookups'] as const,
};

export function useShifts() {
  return useQuery({ queryKey: shiftKeys.list, queryFn: () => api.get<Shift[]>('/shifts') });
}

export function useShiftAssignments(id: string | null) {
  return useQuery({
    queryKey: shiftKeys.assignments(id ?? ''),
    queryFn: () => api.get<ShiftAssignment[]>(`/shifts/${id}/assignments`),
    enabled: Boolean(id),
  });
}

export function useRoster(filters: {
  weekOf?: string;
  officeId?: string;
  departmentId?: string;
  q?: string;
  page?: number;
}) {
  return useQuery({
    queryKey: shiftKeys.roster(filters),
    queryFn: () =>
      api.get<Roster>('/shifts/roster', {
        weekOf: filters.weekOf,
        officeId: filters.officeId,
        departmentId: filters.departmentId,
        q: filters.q,
        page: filters.page ?? 1,
        pageSize: 25,
      }),
    placeholderData: (previous) => previous,
  });
}

export function useShiftLookups(enabled: boolean) {
  return useQuery({
    queryKey: shiftKeys.lookups,
    queryFn: () => api.get<ShiftLookups>('/shifts/lookups'),
    enabled,
    staleTime: 60_000,
  });
}

function useShiftMutation<TVariables, TResult>(run: (variables: TVariables) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shiftKeys.all });
      // A roster change re-judges days, so the attendance screens are stale too.
      void queryClient.invalidateQueries({ queryKey: ['attendance'] });
    },
  });
}

export const useCreateShift = () =>
  useShiftMutation((input: ShiftInput) => api.post<Shift>('/shifts', input));

export const useUpdateShift = () =>
  useShiftMutation(({ id, input }: { id: string; input: ShiftInput }) =>
    api.put<Shift>(`/shifts/${id}`, input),
  );

export const useDeleteShift = () =>
  useShiftMutation((id: string) => api.delete<void>(`/shifts/${id}`));

export const useAssignShift = () =>
  useShiftMutation(({ id, input }: { id: string; input: ShiftAssignmentInput }) =>
    api.post<ShiftAssignment>(`/shifts/${id}/assignments`, input),
  );

export const useRemoveAssignment = () =>
  useShiftMutation((assignmentId: string) =>
    api.delete<void>(`/shifts/assignments/${assignmentId}`),
  );

export const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
