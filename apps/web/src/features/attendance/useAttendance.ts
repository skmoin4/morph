import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RegularisationDecisionInput, RegularisationInput } from '@opsvera/shared';
import { api } from '../../lib/api';
import type { Paginated } from '../settings/useSettings';

export type DayStatus =
  'PRESENT' | 'LATE' | 'HALF_DAY' | 'ABSENT' | 'ON_LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF' | 'NOT_IN';

export type DayType = 'WORKING' | 'WEEKLY_OFF' | 'HOLIDAY' | 'LEAVE';

export interface TodayPunch {
  id: string;
  type: 'IN' | 'OUT';
  source: 'MOBILE_GPS' | 'OFFICE_IP' | 'MANUAL' | 'REGULARISED';
  punchedAt: string;
  isFlagged: boolean;
  flagReason: string | null;
}

export interface MyToday {
  date: string;
  now: string;
  employeeId: string;
  office: {
    id: string;
    name: string;
    shortCode: string;
    timezone: string;
    latitude: number | null;
    longitude: number | null;
    geofenceRadiusM: number;
    requiresGps: boolean;
    geofenceMode: 'FLAG' | 'REJECT';
  };
  shift: { name: string; startTime: string; endTime: string; crossesMidnight: boolean } | null;
  methods: { mobile: boolean; office: boolean };
  network: { ip: string | null; allowed: boolean };
  dayType: DayType;
  holidayName: string | null;
  status: DayStatus;
  clockedIn: boolean;
  clockedInSince: string | null;
  nextAction: 'IN' | 'OUT';
  firstInAt: string | null;
  lastOutAt: string | null;
  workedMinutes: number;
  isLate: boolean;
  lateMinutes: number;
  punches: TodayPunch[];
}

export interface BoardRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  designation: string | null;
  office: { id: string; name: string; shortCode: string; timezone: string };
  department: { id: string; name: string } | null;
  status: DayStatus;
  dayType: DayType;
  shift: string | null;
  firstInAt: string | null;
  lastOutAt: string | null;
  clockedIn: boolean;
  workedMinutes: number;
  isLate: boolean;
  lateMinutes: number;
  isEarlyExit: boolean;
  overtimeMinutes: number;
  method: TodayPunch['source'] | null;
  distanceM: number | null;
  flagged: boolean;
  flagReason: string | null;
  isRegularised: boolean;
  final: boolean;
}

export interface BoardSummary {
  total: number;
  present: number;
  late: number;
  halfDay: number;
  absent: number;
  onLeave: number;
  notIn: number;
  holiday: number;
  weeklyOff: number;
  flagged: number;
  clockedIn: number;
}

export interface Board extends Paginated<BoardRow> {
  date: string;
  summary: BoardSummary;
}

export interface RegisterCell {
  date: string;
  status: DayStatus | null;
  isLate?: boolean;
  flagged?: boolean;
  regularised?: boolean;
  final?: boolean;
  dayValue?: number;
  firstInAt?: string | null;
  lastOutAt?: string | null;
  workedMinutes?: number;
  lateMinutes?: number;
  overtimeMinutes?: number;
}

export interface RegisterRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  office: { id: string; name: string; shortCode: string; timezone: string };
  department: { id: string; name: string } | null;
  days: RegisterCell[];
  totals: {
    present: number;
    late: number;
    halfDay: number;
    absent: number;
    onLeave: number;
    weeklyOff: number;
    holiday: number;
    overtimeMinutes: number;
    lateMarkPenaltyDays: number;
    creditedDays: number;
  };
}

export interface Register extends Paginated<RegisterRow> {
  month: string;
  days: string[];
}

export interface EmployeeRange {
  employee: { id: string; employeeCode: string; fullName: string };
  from: string;
  to: string;
  days: Array<{
    date: string;
    status: DayStatus;
    dayType: DayType;
    holidayName: string | null;
    shift: string | null;
    firstInAt: string | null;
    lastOutAt: string | null;
    workedMinutes: number;
    lateMinutes: number;
    earlyExitMinutes: number;
    overtimeMinutes: number;
    isLate: boolean;
    isEarlyExit: boolean;
    dayValue: number;
    final: boolean;
    flagged: boolean;
    flagReason: string | null;
    regularised: boolean;
    punchCount: number;
  }>;
  totals: {
    present: number;
    late: number;
    halfDay: number;
    absent: number;
    onLeave: number;
    overtimeMinutes: number;
  };
}

export interface DayDetail {
  employee: { id: string; employeeCode: string; fullName: string };
  date: string;
  office: { id: string; name: string; timezone: string };
  shift: {
    name: string;
    startTime: string;
    endTime: string;
    breakMinutes: number;
    graceMinutes: number;
  } | null;
  policy: {
    name: string;
    graceMinutes: number;
    lateMarkAfterMinutes: number;
    halfDayFromHours: number;
    fullDayMinimumHours: number;
    overtimeAfterHours: number;
    earlyExitBeforeMinutes: number;
  };
  dayType: DayType;
  holidayName: string | null;
  result: {
    status: DayStatus;
    final: boolean;
    firstInAt: string | null;
    lastOutAt: string | null;
    workedMinutes: number;
    presenceMinutes: number;
    breakMinutes: number;
    lateMinutes: number;
    earlyExitMinutes: number;
    overtimeMinutes: number;
    isLate: boolean;
    isEarlyExit: boolean;
    dayValue: number;
    flagReason: string | null;
    clockedIn: boolean;
  };
  punches: Array<{
    id: string;
    type: 'IN' | 'OUT';
    source: TodayPunch['source'];
    punchedAt: string;
    isFlagged: boolean;
    flagReason: string | null;
    distanceM: number | null;
    withinGeofence: boolean | null;
    accuracyM: number | null;
    ipAddress: string | null;
    ipAllowed: boolean | null;
    hasSelfie: boolean;
    note: string | null;
    superseded: boolean;
  }>;
  regularisations: Array<{
    id: string;
    status: string;
    requestedInTime: string | null;
    requestedOutTime: string | null;
    reason: string;
    decisionNote: string | null;
    createdAt: string;
  }>;
}

export interface RegularisationRow {
  id: string;
  employeeId: string;
  attendanceDate: string;
  requestedInTime: string | null;
  requestedOutTime: string | null;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  employee: { id: string; employeeCode: string; fullName: string; office: string };
  canDecide: boolean;
  isMine: boolean;
}

export interface BoardFilters {
  date?: string;
  officeId?: string;
  departmentId?: string;
  status?: string;
  flagged?: boolean;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface RegisterFilters {
  month: string;
  officeId?: string;
  departmentId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export const attendanceKeys = {
  all: ['attendance'] as const,
  today: ['attendance', 'today'] as const,
  board: (filters: BoardFilters) => ['attendance', 'board', filters] as const,
  register: (filters: RegisterFilters) => ['attendance', 'register', filters] as const,
  range: (id: string, from: string, to: string) => ['attendance', 'range', id, from, to] as const,
  day: (id: string, date: string) => ['attendance', 'day', id, date] as const,
  regularisations: (filters: object) => ['attendance', 'regularisations', filters] as const,
};

export interface AttendanceLookups {
  offices: Array<{ id: string; name: string; shortCode: string }>;
  departments: Array<{ id: string; name: string }>;
}

export function useAttendanceLookups() {
  return useQuery({
    queryKey: ['attendance', 'lookups'] as const,
    queryFn: () => api.get<AttendanceLookups>('/attendance/lookups'),
    staleTime: 5 * 60_000,
  });
}

export function useMyToday(enabled = true) {
  return useQuery({
    queryKey: attendanceKeys.today,
    queryFn: () => api.get<MyToday>('/attendance/me/today'),
    enabled,
    // Another device, or a manager's correction, can change the day.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useBoard(filters: BoardFilters) {
  return useQuery({
    queryKey: attendanceKeys.board(filters),
    queryFn: () =>
      api.get<Board>('/attendance/board', {
        date: filters.date,
        officeId: filters.officeId,
        departmentId: filters.departmentId,
        status: filters.status,
        flagged: filters.flagged ? true : undefined,
        q: filters.q,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 50,
      }),
    placeholderData: (previous) => previous,
    // A live board: people are punching right now.
    refetchInterval: 30_000,
  });
}

export function useRegister(filters: RegisterFilters) {
  return useQuery({
    queryKey: attendanceKeys.register(filters),
    queryFn: () =>
      api.get<Register>('/attendance/register', {
        month: filters.month,
        officeId: filters.officeId,
        departmentId: filters.departmentId,
        q: filters.q,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 25,
      }),
    placeholderData: (previous) => previous,
  });
}

export function useEmployeeRange(id: string | null, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: attendanceKeys.range(id ?? '', from, to),
    queryFn: () => api.get<EmployeeRange>(`/attendance/employees/${id}`, { from, to }),
    enabled: Boolean(id) && enabled,
  });
}

export function useDayDetail(id: string | null, date: string | null) {
  return useQuery({
    queryKey: attendanceKeys.day(id ?? '', date ?? ''),
    queryFn: () => api.get<DayDetail>(`/attendance/employees/${id}/days/${date}`),
    enabled: Boolean(id && date),
  });
}

export function useRegularisations(filters: {
  status?: string;
  mine?: boolean;
  page?: number;
  pageSize?: number;
}) {
  return useQuery({
    queryKey: attendanceKeys.regularisations(filters),
    queryFn: () =>
      api.get<Paginated<RegularisationRow>>('/attendance/regularisations', {
        status: filters.status,
        mine: filters.mine ? true : undefined,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 25,
      }),
    placeholderData: (previous) => previous,
  });
}

/** A punch changes today's card, the board, the register and any open day. */
export function useInvalidateAttendance() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: attendanceKeys.all });
}

export function usePunchOffice() {
  const invalidate = useInvalidateAttendance();
  return useMutation({
    mutationFn: () =>
      api.post<{ punch: TodayPunch; today: MyToday }>('/attendance/punch/office', {
        deviceInfo: navigator.userAgent.slice(0, 280),
      }),
    onSuccess: () => void invalidate(),
  });
}

export function usePunchMobile() {
  const invalidate = useInvalidateAttendance();
  return useMutation({
    mutationFn: async (input: {
      latitude: number;
      longitude: number;
      accuracyM?: number;
      selfie: Blob;
    }) => {
      const form = new FormData();
      form.append('latitude', String(input.latitude));
      form.append('longitude', String(input.longitude));
      if (input.accuracyM !== undefined) form.append('accuracyM', String(input.accuracyM));
      form.append('deviceInfo', navigator.userAgent.slice(0, 280));
      form.append('selfie', input.selfie, 'selfie.jpg');
      return api.post<{ punch: TodayPunch; today: MyToday }>('/attendance/punch/mobile', form);
    },
    onSuccess: () => void invalidate(),
  });
}

export function useCreateRegularisation() {
  const invalidate = useInvalidateAttendance();
  return useMutation({
    mutationFn: (input: RegularisationInput) =>
      api.post<RegularisationRow>('/attendance/regularisations', input),
    onSuccess: () => void invalidate(),
  });
}

export function useCancelRegularisation() {
  const invalidate = useInvalidateAttendance();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<RegularisationRow>(`/attendance/regularisations/${id}/cancel`),
    onSuccess: () => void invalidate(),
  });
}

export function useDecideRegularisation() {
  const invalidate = useInvalidateAttendance();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RegularisationDecisionInput }) =>
      api.post<RegularisationRow>(`/attendance/regularisations/${id}/decision`, input),
    onSuccess: () => void invalidate(),
  });
}

export const STATUS_LABEL: Record<DayStatus, string> = {
  PRESENT: 'Present',
  LATE: 'Late',
  HALF_DAY: 'Half day',
  ABSENT: 'Absent',
  ON_LEAVE: 'On leave',
  HOLIDAY: 'Holiday',
  WEEKLY_OFF: 'Weekly off',
  NOT_IN: 'Not in yet',
};

export const SOURCE_LABEL: Record<TodayPunch['source'], string> = {
  MOBILE_GPS: 'Phone (GPS)',
  OFFICE_IP: 'Office network',
  MANUAL: 'Added by HR',
  REGULARISED: 'Corrected',
};

/** 487 -> "8h 07m" */
export function formatMinutes(total: number): string {
  const minutes = Math.max(0, Math.round(total));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** The wall-clock time of an instant in an office's own zone: "09:28". */
export function timeIn(instant: string | null | undefined, timeZone: string): string {
  if (!instant) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(instant));
}
