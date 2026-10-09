import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Paginated } from '../settings/useSettings';

export interface EmployeeListItem {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  workEmail: string | null;
  phone: string | null;
  joiningDate: string;
  status: 'ACTIVE' | 'INACTIVE' | 'NOTICE_PERIOD' | 'EXITED';
  attendanceMethod: 'MOBILE' | 'OFFICE' | 'BOTH';
  office: { id: string; name: string; shortCode: string; timezone: string };
  department: { id: string; name: string } | null;
  designation: { id: string; name: string } | null;
  manager: { id: string; firstName: string; lastName: string } | null;
  user: { id: string; email: string; status: string; lastLoginAt: string | null } | null;
  /** Stripped by the API unless the caller holds cost.view / salary.view. */
  hourlyRate?: string | null;
  monthlyAmount?: string | null;
}

export interface CostRateRow {
  id: string;
  hourlyRate: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
  createdAt: string;
}

export interface SalaryRow {
  id: string;
  monthlyAmount: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
}

export interface EmployeeDetail extends Omit<EmployeeListItem, 'manager'> {
  /** The 360 payload carries the manager's code too, unlike the list row. */
  manager: { id: string; firstName: string; lastName: string; employeeCode: string } | null;
  personalEmail: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  exitDate: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  officeId: string;
  departmentId: string | null;
  designationId: string | null;
  managerId: string | null;
  directReports: Array<{ id: string; firstName: string; lastName: string; employeeCode: string }>;
  costRates: CostRateRow[];
  salaries: SalaryRow[];
  projects: Array<{
    id: string;
    projectCode: string;
    name: string;
    status: string;
    health: string;
    roleOnProject: string | null;
  }>;
  leaveBalances: Array<{
    leaveType: { id: string; name: string; shortCode: string };
    available: string;
    used: string;
    pending: string;
  }>;
  attendanceSummary: Record<string, number>;
  hoursSummary: { totalHours: string; billableHours: string };
}

export interface PeopleFilters {
  q?: string;
  officeId?: string;
  departmentId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}

export const peopleKeys = {
  list: (filters: PeopleFilters) => ['people', 'list', filters] as const,
  detail: (id: string) => ['people', 'detail', id] as const,
  costRates: (id: string) => ['people', 'cost-rates', id] as const,
  salaries: (id: string) => ['people', 'salaries', id] as const,
};

export function useEmployees(filters: PeopleFilters) {
  return useQuery({
    queryKey: peopleKeys.list(filters),
    queryFn: () =>
      api.get<Paginated<EmployeeListItem>>('/employees', {
        q: filters.q,
        officeId: filters.officeId,
        departmentId: filters.departmentId,
        status: filters.status,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 25,
        sort: filters.sort,
      }),
    // Keeps the previous page on screen while the next one loads, so the
    // table does not flash empty on every filter change.
    placeholderData: (previous) => previous,
  });
}

export function useEmployee(id: string | null) {
  return useQuery({
    queryKey: peopleKeys.detail(id ?? ''),
    queryFn: () => api.get<EmployeeDetail>(`/employees/${id}`),
    enabled: Boolean(id),
  });
}

export function useCostRates(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: peopleKeys.costRates(id ?? ''),
    queryFn: () => api.get<CostRateRow[]>(`/employees/${id}/cost-rates`),
    enabled: Boolean(id) && enabled,
  });
}

export function useSalaries(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: peopleKeys.salaries(id ?? ''),
    queryFn: () => api.get<SalaryRow[]>(`/employees/${id}/salaries`),
    enabled: Boolean(id) && enabled,
  });
}
