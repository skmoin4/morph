import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiRequestError } from '../../lib/api';

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface Company {
  id: string;
  name: string;
  legalName: string | null;
  codePrefix: string;
  projectCodePattern: string;
  fyStartMonth: number;
  currency: string;
  currencySymbol: string;
  gstin: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
}

export interface Office {
  id: string;
  name: string;
  shortCode: string;
  timezone: string;
  city: string | null;
  state: string | null;
  country: string | null;
  addressLine1: string | null;
  latitude: string | null;
  longitude: string | null;
  geofenceRadiusM: number;
  weeklyOffDays: number[];
  allowedIPs: string[];
  requiresGps: boolean;
  isActive: boolean;
  _count: { employees: number; projects: number };
}

export interface Department {
  id: string;
  name: string;
  shortCode: string | null;
  isActive: boolean;
  _count: { employees: number; designations: number };
}

export interface Designation {
  id: string;
  name: string;
  level: number | null;
  departmentId: string | null;
  department: { id: string; name: string } | null;
  isActive: boolean;
  _count: { employees: number };
}

export interface ProjectType {
  id: string;
  name: string;
  shortCode: string;
  colorToken: string | null;
  isActive: boolean;
  _count: { projects: number; bookings: number };
}

export interface Holiday {
  id: string;
  name: string;
  date: string;
  isOptional: boolean;
  officeId: string | null;
  office: { id: string; name: string; shortCode: string } | null;
}

export interface AttendancePolicy {
  id: string;
  name: string;
  officeId: string | null;
  shiftId: string | null;
  office: { id: string; name: string } | null;
  shift: { id: string; name: string } | null;
  graceMinutes: number;
  lateMarkAfterMinutes: number;
  halfDayBelowHours: string;
  fullDayMinimumHours: string;
  overtimeAfterHours: string;
  earlyExitBeforeMinutes: number;
  lateMarksPerHalfDay: number;
  isDefault: boolean;
  isActive: boolean;
}

export interface LeaveType {
  id: string;
  name: string;
  shortCode: string;
  yearlyQuota: string;
  carryForward: boolean;
  maxCarryForward: string | null;
  allowHalfDay: boolean;
  isPaid: boolean;
  approvalFlow: 'SINGLE_LEVEL' | 'TEAM_LEAD_THEN_MANAGER';
  isActive: boolean;
  _count: { requests: number };
}

export interface ExpenseCategory {
  id: string;
  name: string;
  shortCode: string | null;
  perClaimLimit: string | null;
  perMonthLimit: string | null;
  requiresReceipt: boolean;
  isActive: boolean;
  _count: { expenses: number };
}

export const settingsKeys = {
  company: ['settings', 'company'] as const,
  offices: ['settings', 'offices'] as const,
  departments: ['settings', 'departments'] as const,
  designations: ['settings', 'designations'] as const,
  projectTypes: ['settings', 'project-types'] as const,
  holidays: (year?: number) => ['settings', 'holidays', year ?? 'all'] as const,
  attendancePolicies: ['settings', 'attendance-policies'] as const,
  leaveTypes: ['settings', 'leave-types'] as const,
  expenseCategories: ['settings', 'expense-categories'] as const,
};

export function useCompany() {
  return useQuery({
    queryKey: settingsKeys.company,
    queryFn: () => api.get<Company>('/settings/company'),
  });
}

export function useOffices() {
  return useQuery({
    queryKey: settingsKeys.offices,
    queryFn: () => api.get<Paginated<Office>>('/settings/offices', { pageSize: 100 }),
  });
}

export function useDepartments() {
  return useQuery({
    queryKey: settingsKeys.departments,
    queryFn: () => api.get<Paginated<Department>>('/settings/departments', { pageSize: 100 }),
  });
}

export function useDesignations() {
  return useQuery({
    queryKey: settingsKeys.designations,
    queryFn: () => api.get<Paginated<Designation>>('/settings/designations', { pageSize: 100 }),
  });
}

export function useProjectTypes() {
  return useQuery({
    queryKey: settingsKeys.projectTypes,
    queryFn: () => api.get<Paginated<ProjectType>>('/settings/project-types', { pageSize: 100 }),
  });
}

export function useHolidays(year?: number) {
  return useQuery({
    queryKey: settingsKeys.holidays(year),
    queryFn: () => api.get<Paginated<Holiday>>('/settings/holidays', { pageSize: 200, year }),
  });
}

export function useAttendancePolicies() {
  return useQuery({
    queryKey: settingsKeys.attendancePolicies,
    queryFn: () => api.get<AttendancePolicy[]>('/settings/attendance-policies'),
  });
}

export function useLeaveTypes() {
  return useQuery({
    queryKey: settingsKeys.leaveTypes,
    queryFn: () => api.get<Paginated<LeaveType>>('/settings/leave-types', { pageSize: 100 }),
  });
}

export function useExpenseCategories() {
  return useQuery({
    queryKey: settingsKeys.expenseCategories,
    queryFn: () =>
      api.get<Paginated<ExpenseCategory>>('/settings/expense-categories', { pageSize: 100 }),
  });
}

/**
 * One mutation helper for every settings write.
 *
 * Errors are surfaced as a toast with the server's own message — the API
 * explains why something is blocked ("3 employees are in Finance"), and
 * re-wording that in the client would only make it vaguer.
 */
export function useSettingsMutation<TVariables, TResult = unknown>(options: {
  mutationFn: (variables: TVariables) => Promise<TResult>;
  invalidate: QueryKey[];
  successMessage: string | ((result: TResult, variables: TVariables) => string);
  onSuccess?: (result: TResult) => void;
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: options.mutationFn,
    onSuccess: (result, variables) => {
      for (const key of options.invalidate) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success(
        typeof options.successMessage === 'function'
          ? options.successMessage(result, variables)
          : options.successMessage,
      );
      options.onSuccess?.(result);
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof ApiRequestError ? error.message : 'Something went wrong. Try again.',
      );
    },
  });
}
