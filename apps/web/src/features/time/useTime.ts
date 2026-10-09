import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BulkTimesheetDecisionInput,
  ReopenTimesheetInput,
  StartTimerInput,
  StopTimerInput,
  TimeCellInput,
  TimeEntryInput,
  TimesheetDecisionInput,
  UpdateTimeEntryInput,
} from '@opsvera/shared';
import { api } from '../../lib/api';
import type { Paginated } from '../settings/useSettings';

export type SheetStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REOPENED';

export interface ProjectLite {
  id: string;
  projectCode: string;
  name: string;
}
export interface TaskLite {
  id: string;
  title: string;
}

export interface TimeEntryRow {
  id: string;
  projectId: string;
  project: ProjectLite;
  taskId: string | null;
  task: TaskLite | null;
  workDate: string;
  hours: number;
  isBillable: boolean;
  source: 'TIMER' | 'MANUAL';
  description: string | null;
  isLocked: boolean;
  startedAt: string | null;
  endedAt: string | null;
}

export interface RunningTimer extends TimeEntryRow {
  seconds: number;
}

export interface TimerState {
  now: string;
  running: RunningTimer | null;
}

export interface GridCell {
  hours: number;
  entryIds: string[];
  hasTimer: boolean;
  locked: boolean;
}

export interface GridRow {
  key: string;
  project: ProjectLite;
  task: TaskLite | null;
  isBillable: boolean;
  cells: Record<string, GridCell>;
  total: number;
}

export interface WeekDay {
  date: string;
  isFuture: boolean;
  dayType: 'WORKING' | 'WEEKLY_OFF' | 'HOLIDAY' | 'LEAVE';
  label: string | null;
  total: number;
}

export interface SheetApproval {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  comment: string | null;
  decidedAt: string;
  approver: string | null;
}

export interface WeekData {
  employee: { id: string; employeeCode: string; fullName: string; isMe: boolean };
  weekStart: string;
  weekEnd: string;
  today: string;
  now: string;
  timesheet: {
    id: string;
    status: SheetStatus;
    submittedAt: string | null;
    approvedAt: string | null;
    reopenReason: string | null;
    approvals: SheetApproval[];
  } | null;
  status: SheetStatus;
  days: WeekDay[];
  rows: GridRow[];
  entries: TimeEntryRow[];
  running: RunningTimer | null;
  totals: { total: number; billable: number; nonBillable: number };
  suggestions: Array<{ project: ProjectLite; task: TaskLite | null; isBillable: boolean }>;
  canEdit: boolean;
  canSubmit: boolean;
  canRecall: boolean;
}

export interface TimesheetRow {
  id: string;
  status: SheetStatus;
  weekStart: string;
  weekEnd: string;
  totalHours: number;
  billableHours: number;
  submittedAt: string | null;
  approvedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  employee: { id: string; employeeCode: string; fullName: string; office: string };
  projects: Array<{ code: string; hours: number }>;
  isMine: boolean;
  canDecide: boolean;
  canReopen: boolean;
}

export interface ProjectTimeSummary {
  totalHours: number;
  approvedHours: number;
  partial: boolean;
  byEmployee: Array<{
    employee: { id: string; employeeCode: string; fullName: string };
    hours: number;
    billable: number;
    approved: number;
  }>;
  byTask: Array<{ taskId: string | null; title: string; hours: number }>;
}

export interface StopResult {
  entryId: string | null;
  discarded: boolean;
  capped: boolean;
  adjusted: boolean;
  entry: TimeEntryRow | null;
}

export interface BulkResult {
  done: number;
  failed: number;
  results: Array<{ id: string; ok: boolean; code?: string; message?: string }>;
}

export const timeKeys = {
  all: ['time'] as const,
  timer: ['time', 'timer'] as const,
  projects: ['time', 'projects'] as const,
  tasks: (projectId: string) => ['time', 'tasks', projectId] as const,
  week: (weekStart: string | undefined, employeeId: string | undefined) =>
    ['time', 'week', weekStart ?? 'now', employeeId ?? 'me'] as const,
  sheets: (filters: object) => ['time', 'sheets', filters] as const,
  summary: (projectId: string) => ['time', 'summary', projectId] as const,
};

export function useTimer(enabled = true) {
  return useQuery({
    queryKey: timeKeys.timer,
    queryFn: async () => {
      const state = await api.get<TimerState>('/time/timer');
      // Remember how far the server clock is from ours, so the display counts
      // true elapsed time even if this machine's clock is off.
      return { ...state, offsetMs: new Date(state.now).getTime() - Date.now() };
    },
    enabled,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useTimeProjects(enabled = true) {
  return useQuery({
    queryKey: timeKeys.projects,
    queryFn: () => api.get<ProjectLite[]>('/time/lookups/projects'),
    enabled,
    staleTime: 60_000,
  });
}

export function useTimeTasks(projectId: string | undefined) {
  return useQuery({
    queryKey: timeKeys.tasks(projectId ?? ''),
    queryFn: () =>
      api.get<Array<{ id: string; title: string; status: string; assignedToMe: boolean }>>(
        '/time/lookups/tasks',
        { projectId },
      ),
    enabled: !!projectId,
    staleTime: 30_000,
  });
}

export function useWeek(weekStart: string | undefined, employeeId?: string, enabled = true) {
  return useQuery({
    queryKey: timeKeys.week(weekStart, employeeId),
    queryFn: () => api.get<WeekData>('/timesheets/week', { weekStart, employeeId }),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export interface SheetFilters {
  status?: string;
  toDecide?: boolean;
  mine?: boolean;
  weekStart?: string;
  page?: number;
  pageSize?: number;
}

export function useTimesheets(filters: SheetFilters, enabled = true) {
  return useQuery({
    queryKey: timeKeys.sheets(filters),
    queryFn: () =>
      api.get<Paginated<TimesheetRow>>('/timesheets', {
        status: filters.status,
        toDecide: filters.toDecide ? true : undefined,
        mine: filters.mine ? true : undefined,
        weekStart: filters.weekStart,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 25,
      }),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useProjectTimeSummary(projectId: string | undefined) {
  return useQuery({
    queryKey: timeKeys.summary(projectId ?? ''),
    queryFn: () => api.get<ProjectTimeSummary>(`/time/projects/${projectId}/summary`),
    enabled: !!projectId,
  });
}

/** Time moves the grid, the timer, the queue, project hours and task cards. */
function useInvalidateTime() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: timeKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
  };
}

export function useStartTimer() {
  const invalidate = useInvalidateTime();
  return useMutation({
    mutationFn: (input: StartTimerInput) => api.post<TimerState>('/time/timer/start', input),
    onSuccess: invalidate,
  });
}

export function useStopTimer() {
  const invalidate = useInvalidateTime();
  return useMutation({
    mutationFn: (input: StopTimerInput = {}) => api.post<StopResult>('/time/timer/stop', input),
    onSuccess: invalidate,
  });
}

export function useDiscardTimer() {
  const invalidate = useInvalidateTime();
  return useMutation({
    mutationFn: () => api.delete<{ discarded: boolean }>('/time/timer'),
    onSuccess: invalidate,
  });
}

export function useCreateEntry() {
  const invalidate = useInvalidateTime();
  return useMutation({
    mutationFn: (input: TimeEntryInput) => api.post<TimeEntryRow>('/time/entries', input),
    onSuccess: invalidate,
  });
}

export function useUpdateEntry() {
  const invalidate = useInvalidateTime();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTimeEntryInput }) =>
      api.patch<TimeEntryRow>(`/time/entries/${id}`, input),
    onSuccess: invalidate,
  });
}

export function useDeleteEntry() {
  const invalidate = useInvalidateTime();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: boolean }>(`/time/entries/${id}`),
    onSuccess: invalidate,
  });
}

export function useSetCell() {
  const invalidate = useInvalidateTime();
  return useMutation({
    mutationFn: (input: TimeCellInput) => api.put<TimeEntryRow | null>('/time/cell', input),
    onSuccess: invalidate,
  });
}

export function useSubmitWeek() {
  const invalidate = useInvalidateTime();
  return useMutation({
    mutationFn: (weekStart: string) => api.post<TimesheetRow>('/timesheets/submit', { weekStart }),
    onSuccess: invalidate,
  });
}

export function useRecallWeek() {
  const invalidate = useInvalidateTime();
  return useMutation({
    mutationFn: (id: string) => api.post<TimesheetRow>(`/timesheets/${id}/recall`),
    onSuccess: invalidate,
  });
}

export function useDecideTimesheet() {
  const invalidate = useInvalidateTime();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: TimesheetDecisionInput }) =>
      api.post<TimesheetRow>(`/timesheets/${id}/decision`, input),
    onSuccess: invalidate,
  });
}

export function useBulkDecide() {
  const invalidate = useInvalidateTime();
  return useMutation({
    mutationFn: (input: BulkTimesheetDecisionInput) =>
      api.post<BulkResult>('/timesheets/bulk-decision', input),
    onSuccess: invalidate,
  });
}

export function useReopenTimesheet() {
  const invalidate = useInvalidateTime();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReopenTimesheetInput }) =>
      api.post<TimesheetRow>(`/timesheets/${id}/reopen`, input),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** 7.5 -> "7h 30m", 0.33 -> "20m", 8 -> "8h". */
export function formatHoursMinutes(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}

/** Hours as shown in a grid cell: "7.5", "8", "" for zero. */
export function formatCell(hours: number): string {
  if (!hours) return '';
  return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100);
}

/**
 * Reads what someone typed into a cell: "7.5", "7,5", "1:30" or "90m".
 * Returns null when it is not a time, so the cell can refuse it.
 */
export function parseHoursInput(raw: string): number | null {
  const text = raw.trim().toLowerCase().replace(',', '.');
  if (text === '') return 0;
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(text);
  if (clock) return Number(clock[1]) + Number(clock[2]) / 60;
  const minutes = /^(\d+(?:\.\d+)?)\s*m(?:in)?$/.exec(text);
  if (minutes) return Number(minutes[1]) / 60;
  const hours = /^(\d+(?:\.\d+)?)\s*h?$/.exec(text);
  if (hours) return Number(hours[1]);
  return null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "05–11 Oct 2026", or "28 Sep – 04 Oct 2026" across a month. Fixed month names: locales disagree on "Sep". */
export function weekLabel(weekStart: string, weekEnd: string): string {
  const parts = (iso: string) => ({
    day: iso.slice(8, 10),
    month: MONTHS[Number(iso.slice(5, 7)) - 1],
  });
  const s = parts(weekStart);
  const e = parts(weekEnd);
  const year = weekEnd.slice(0, 4);
  return s.month === e.month
    ? `${s.day}–${e.day} ${e.month} ${year}`
    : `${s.day} ${s.month} – ${e.day} ${e.month} ${year}`;
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
