import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  LeaveCancelInput,
  LeaveDecisionInput,
  LeavePreviewInput,
  LeaveRequestInput,
} from '@opsvera/shared';
import { api } from '../../lib/api';
import type { PillTone } from '../../components/ui/Pill';
import type { Paginated } from '../settings/useSettings';

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type LeaveDayPart = 'FULL_DAY' | 'FIRST_HALF' | 'SECOND_HALF';

export interface LeaveTypeLite {
  id: string;
  name: string;
  shortCode: string;
  colorToken: string | null;
  isPaid: boolean;
  allowHalfDay: boolean;
  approvalFlow: 'SINGLE_LEVEL' | 'TEAM_LEAD_THEN_MANAGER';
  yearlyQuota: number;
}

export interface LeaveBalance {
  leaveType: LeaveTypeLite;
  year: number;
  opening: number;
  accrued: number;
  carriedForward: number;
  used: number;
  pending: number;
  available: number;
}

export interface PersonLite {
  id: string;
  employeeCode: string;
  fullName: string;
  office: string;
}

export interface BalancesResponse {
  employee: PersonLite;
  year: number;
  balances: LeaveBalance[];
}

export interface TeamBalancesResponse {
  year: number;
  types: LeaveTypeLite[];
  data: Array<{ employee: PersonLite; balances: LeaveBalance[] }>;
}

export interface LeaveDecisionTrail {
  approver: string | null;
  decidedAt: string | null;
  note: string | null;
}

export interface LeaveRow {
  id: string;
  status: LeaveStatus;
  fromDate: string;
  toDate: string;
  dayPart: LeaveDayPart;
  totalDays: number;
  reason: string;
  createdAt: string;
  decidedAt: string | null;
  cancelledAt: string | null;
  leaveType: LeaveTypeLite;
  employee: PersonLite;
  flow: LeaveTypeLite['approvalFlow'];
  awaitingLevel: 1 | 2 | null;
  level1: LeaveDecisionTrail | null;
  level2: LeaveDecisionTrail | null;
  isMine: boolean;
  canDecide: boolean;
  canCancel: boolean;
}

export interface LeavePreview {
  leaveType: LeaveTypeLite;
  totalDays: number;
  workingDates: string[];
  skipped: Array<{ date: string; reason: 'WEEKLY_OFF' | 'HOLIDAY'; holiday: string | null }>;
  balance: { year: number; available: number; afterRequest: number; enforced: boolean };
  enoughBalance: boolean;
  overlap: { id: string; from: string; to: string; status: LeaveStatus } | null;
}

export interface LeaveCalendar {
  from: string;
  to: string;
  leaves: Array<{
    id: string;
    status: LeaveStatus;
    fromDate: string;
    toDate: string;
    dayPart: LeaveDayPart;
    totalDays: number;
    employee: PersonLite;
    leaveType: { id: string; name: string; shortCode: string; colorToken: string | null };
  }>;
  holidays: Array<{
    id: string;
    date: string;
    name: string;
    officeId: string | null;
    isOptional: boolean;
  }>;
}

export const leaveKeys = {
  all: ['leave'] as const,
  types: ['leave', 'types'] as const,
  balances: (employeeId: string | undefined, year: number | undefined) =>
    ['leave', 'balances', employeeId ?? 'me', year ?? 'now'] as const,
  team: (filters: object) => ['leave', 'team-balances', filters] as const,
  requests: (filters: object) => ['leave', 'requests', filters] as const,
  calendar: (filters: object) => ['leave', 'calendar', filters] as const,
  preview: (input: object) => ['leave', 'preview', input] as const,
};

export function useLeaveTypes() {
  return useQuery({
    queryKey: leaveKeys.types,
    queryFn: () => api.get<LeaveTypeLite[]>('/leave/types'),
    staleTime: 5 * 60_000,
  });
}

export function useLeaveBalances(
  opts: { employeeId?: string; year?: number; enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: leaveKeys.balances(opts.employeeId, opts.year),
    queryFn: () =>
      api.get<BalancesResponse>('/leave/balances', {
        employeeId: opts.employeeId,
        year: opts.year,
      }),
    enabled: opts.enabled ?? true,
  });
}

export function useTeamBalances(filters: { year?: number; officeId?: string; q?: string }) {
  return useQuery({
    queryKey: leaveKeys.team(filters),
    queryFn: () => api.get<TeamBalancesResponse>('/leave/balances/team', filters),
    placeholderData: keepPreviousData,
  });
}

export interface LeaveFilters {
  status?: string;
  mine?: boolean;
  toDecide?: boolean;
  employeeId?: string;
  leaveTypeId?: string;
  page?: number;
  pageSize?: number;
}

export function useLeaveRequests(filters: LeaveFilters, enabled = true) {
  return useQuery({
    queryKey: leaveKeys.requests(filters),
    queryFn: () =>
      api.get<Paginated<LeaveRow>>('/leave/requests', {
        status: filters.status,
        mine: filters.mine ? true : undefined,
        toDecide: filters.toDecide ? true : undefined,
        employeeId: filters.employeeId,
        leaveTypeId: filters.leaveTypeId,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 25,
      }),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useLeaveCalendar(filters: { from: string; to: string; officeId?: string }) {
  return useQuery({
    queryKey: leaveKeys.calendar(filters),
    queryFn: () => api.get<LeaveCalendar>('/leave/calendar', filters),
    placeholderData: keepPreviousData,
  });
}

/** What a leave would cost, asked as the form is filled in. */
export function useLeavePreview(input: LeavePreviewInput | null) {
  return useQuery({
    queryKey: leaveKeys.preview(input ?? {}),
    queryFn: () => api.post<LeavePreview>('/leave/preview', input),
    enabled: input !== null,
    retry: false,
    staleTime: 0,
  });
}

/** Any leave change moves balances, the calendar and — through approval — attendance. */
function useInvalidateLeave() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: leaveKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['attendance'] });
  };
}

export function useApplyLeave() {
  const invalidate = useInvalidateLeave();
  return useMutation({
    mutationFn: (input: LeaveRequestInput) => api.post<LeaveRow>('/leave/requests', input),
    onSuccess: invalidate,
  });
}

export function useDecideLeave() {
  const invalidate = useInvalidateLeave();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: LeaveDecisionInput }) =>
      api.post<LeaveRow>(`/leave/requests/${id}/decision`, input),
    onSuccess: invalidate,
  });
}

export function useCancelLeave() {
  const invalidate = useInvalidateLeave();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: LeaveCancelInput }) =>
      api.post<LeaveRow>(`/leave/requests/${id}/cancel`, input),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export const DAY_PART_LABEL: Record<LeaveDayPart, string> = {
  FULL_DAY: 'Full day',
  FIRST_HALF: 'First half',
  SECOND_HALF: 'Second half',
};

/** The type's colour token, as the one pill tone the design system has for it. */
export function toneForType(token: string | null): PillTone {
  switch (token) {
    case 'green':
      return 'green';
    case 'amber':
      return 'amber';
    case 'red':
      return 'red';
    case 'violet':
      return 'violet';
    case 'blue':
    case 'cyan':
      return 'blue';
    default:
      return 'gray';
  }
}

export function formatDays(days: number): string {
  return `${Number.isInteger(days) ? days : days.toFixed(1)} day${days === 1 ? '' : 's'}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "02 Oct" for one day, "19–21 Oct" or "30 Oct – 02 Nov" for a range. Fixed month names: locales disagree on "Sep". */
export function formatRange(from: string, to: string): string {
  const label = (iso: string) => `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
  if (from === to) return label(from);
  const [fd, fm] = label(from).split(' ');
  const [td, tm] = label(to).split(' ');
  return fm === tm ? `${fd}–${td} ${fm}` : `${fd} ${fm} – ${td} ${tm}`;
}

export function awaitingLabel(
  row: Pick<LeaveRow, 'status' | 'flow' | 'awaitingLevel'>,
): string | null {
  if (row.status !== 'PENDING') return null;
  if (row.flow === 'SINGLE_LEVEL') return 'Awaiting approval';
  return row.awaitingLevel === 2 ? 'Needs final approval (2/2)' : 'Needs team lead (1/2)';
}
