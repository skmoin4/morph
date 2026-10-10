import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export type DashboardKind = 'EXECUTIVE' | 'MANAGER' | 'MY_DAY';

export interface DashboardHome {
  kind: DashboardKind;
  dashboards: DashboardKind[];
}

export interface OfficeOption {
  id: string;
  name: string;
  shortCode: string;
}

export type Health = 'HEALTHY' | 'AT_RISK' | 'CRITICAL' | string;

export interface ActionItem {
  id: string;
  severity: 'high' | 'medium' | 'low';
  kind: string;
  title: string;
  detail: string;
  linkUrl: string;
  ageDays: number | null;
}

export interface PortfolioRow {
  id: string;
  projectCode: string;
  name: string;
  client: string;
  manager: string | null;
  health: Health;
  alertLevel: 0 | 80 | 100;
  burnPercent: number | null;
  budgetHours: number;
  actualHours: number;
  taskProgress: number | null;
  taskCount: number;
  endDate: string | null;
  daysToEnd: number | null;
  /** The last two are absent without cost.view / margin.view. */
  actualTotalCost?: string;
  marginAmount?: string;
  marginPercent?: number | null;
}

export interface AttendanceDay {
  date: string;
  expected: number;
  present: number;
  presentPercent: number;
  late: number;
  onLeave: number;
  absent: number;
  notIn: number;
  flagged: number;
  clockedIn: number;
}

export interface ExecutiveDashboard {
  asOf: string;
  today: string;
  monthStart: string;
  monthLabel: string;
  office: OfficeOption | null;
  offices: OfficeOption[];
  kpis: {
    booked: { count: number; projectValue?: string } | null;
    activeProjects: { count: number; attention: number } | null;
    utilization: {
      percent: number;
      previousPercent: number;
      deltaPoints: number;
      capacityHours: number;
      billableHours: number;
      loggedHours: number;
      people: number;
    } | null;
    approvals: {
      total: number;
      timesheets: number;
      leave: number;
      expenses: number;
      expensesAmount?: string;
      regularisations: number;
    } | null;
    budget: { over: number; near: number } | null;
    margin: { amount: string; value: number; cost: number; percent: number | null } | null;
  };
  lifecycle: {
    draft: number;
    awaitingApproval: number;
    confirmedThisMonth: number;
    verbalEmailPending: number;
    verbalEmailOverdue: number;
    codesThisYear: number;
    scheduled: { scheduled: number; active: number; unscheduled: number };
  } | null;
  portfolio: PortfolioRow[] | null;
  actions: ActionItem[];
  work: {
    attendance: AttendanceDay | null;
    hours: {
      todayLogged: number;
      weekLogged: number;
      weekBillable: number;
      weekCapacity: number;
      weekBillablePercent: number | null;
      weekUnlogged: number;
    } | null;
  } | null;
  money: {
    expenses: {
      awaitingManager: { count: number; amount: string };
      awaitingFinance: { count: number; amount: string };
      toReimburse: { count: number; amount: string };
    } | null;
    cost: {
      thisMonth: { labour: string; expense: string; total: string };
      lastMonth: { total: string };
    } | null;
  } | null;
  charts: {
    costByProject: Array<{
      id: string;
      projectCode: string;
      name: string;
      actualLabourCost: string;
      actualExpenseCost: string;
      actualTotalCost: string;
    }> | null;
    costByMonth: Array<{
      month: string;
      label: string;
      actualLabourCost: string;
      actualExpenseCost: string;
    }> | null;
    bookingsByMonth: Array<{
      month: string;
      label: string;
      count: number;
      projectValue?: string;
    }> | null;
  };
}

export interface WaitingItem {
  id: string;
  type: 'TIMESHEET' | 'LEAVE' | 'EXPENSE' | 'CORRECTION';
  person: string;
  title: string;
  detail: string;
  linkUrl: string;
  ageDays: number;
  amount?: string;
}

export interface TeamRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  designation: string | null;
  status: string;
  dayType: string;
  shift: string | null;
  firstInAt: string | null;
  clockedIn: boolean;
  workedMinutes: number;
  isLate: boolean;
  lateMinutes: number;
  flagged: boolean;
}

export interface ManagerDashboard {
  today: string;
  weekStart: string;
  counts: {
    timesheets: number;
    leave: number;
    expenses: number;
    corrections: number;
    total: number;
  };
  waiting: WaitingItem[];
  team: {
    size: number;
    today: {
      date: string;
      expected: number;
      present: number;
      late: number;
      onLeave: number;
      absent: number;
      notIn: number;
      rows: TeamRow[];
    } | null;
    workload: Array<{
      id: string;
      fullName: string;
      employeeCode: string;
      logged: number;
      billable: number;
      expected: number;
      behind: number;
    }> | null;
    unsubmittedLastWeek: number;
  };
  projects: Array<{
    id: string;
    projectCode: string;
    name: string;
    client: string;
    health: Health;
    alertLevel: 0 | 80 | 100;
    burnPercent: number | null;
    actualHours: number;
    budgetHours: number;
    taskProgress: number | null;
    taskCount: number;
    overdueTasks: number;
    endDate: string | null;
    actualTotalCost?: string;
    marginPercent?: number | null;
  }>;
  upcoming: {
    milestones: Array<{
      id: string;
      name: string;
      dueDate: string;
      daysAway: number;
      project: { id: string; projectCode: string } | null;
    }>;
    leave: Array<{
      id: string;
      person: string;
      code: string;
      from: string;
      to: string;
      days: number;
    }>;
  };
}

export interface MyDayTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  overdue: boolean;
  dueSoon: boolean;
  estimatedHours: number | null;
  loggedHours: number;
  project: { id: string; projectCode: string; name: string } | null;
}

export interface MyDay {
  today: string;
  weekStart: string;
  weekEnd: string;
  employee: { id: string; firstName: string; office: string; officeName: string };
  projects: number;
  tasks: MyDayTask[];
  hours: { week: number; billable: number; capacity: number; expectedSoFar: number } | null;
  week: Array<{
    date: string;
    isToday: boolean;
    isFuture: boolean;
    hours: number;
    attendance: string | null;
  }>;
  leaveBalances: Array<{
    type: string;
    code: string;
    colorToken: string;
    available: number;
    used: number;
    pending: number;
    total: number;
  }>;
  upcoming: {
    holidays: Array<{ id: string; name: string; date: string; daysAway: number }>;
    leave: Array<{
      id: string;
      type: string;
      code: string;
      from: string;
      to: string;
      days: number;
      status: string;
    }>;
  };
  todo: Array<{
    id: string;
    tone: 'red' | 'amber' | 'blue';
    title: string;
    detail: string;
    linkUrl: string;
  }>;
  waiting: {
    leave: number;
    expenses: number;
    expensesToReceive: number;
    corrections: number;
    timesheet: boolean;
  };
}

export const dashboardKeys = {
  all: ['dashboard'] as const,
  home: () => ['dashboard', 'home'] as const,
  executive: (officeId?: string) => ['dashboard', 'executive', officeId ?? 'all'] as const,
  manager: () => ['dashboard', 'manager'] as const,
  myDay: () => ['dashboard', 'my-day'] as const,
};

/** Figures change as people work, so each dashboard re-reads itself every minute. */
const REFRESH_MS = 60_000;

export function useDashboardHome() {
  return useQuery({
    queryKey: dashboardKeys.home(),
    queryFn: () => api.get<DashboardHome>('/dashboard/home'),
  });
}

export function useExecutiveDashboard(officeId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.executive(officeId),
    queryFn: () => api.get<ExecutiveDashboard>('/dashboard/executive', { officeId }),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
}

export function useManagerDashboard(enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.manager(),
    queryFn: () => api.get<ManagerDashboard>('/dashboard/manager'),
    enabled,
    refetchInterval: REFRESH_MS,
  });
}

export function useMyDay(enabled = true) {
  return useQuery({
    queryKey: dashboardKeys.myDay(),
    queryFn: () => api.get<MyDay>('/dashboard/my-day'),
    enabled,
    refetchInterval: REFRESH_MS,
  });
}
