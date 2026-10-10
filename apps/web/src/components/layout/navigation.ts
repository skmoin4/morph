import type { LucideIcon } from 'lucide-react';
import {
  Banknote,
  BarChart3,
  Briefcase,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  Clock,
  Coins,
  FileText,
  Fingerprint,
  LayoutDashboard,
  ListChecks,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** The permission that reveals this item. The sidebar hides what is not granted. */
  permission: string;
  /** False until the module's screens exist; the Home page marks these "Soon". */
  ready?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * The Phase 1 sidebar, exactly as scoped. The prototype shows the full future
 * product (Leads, Proposals, Invoices, Payroll, Screenshots, AI COO); none of
 * that is here.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Command Center',
    items: [
      {
        label: 'Dashboard',
        to: '/',
        icon: LayoutDashboard,
        permission: 'dashboard.view',
      },
    ],
  },
  {
    label: 'Commercial',
    items: [
      { label: 'Clients', to: '/clients', icon: Briefcase, permission: 'client.view', ready: true },
      {
        label: 'Bookings',
        to: '/bookings',
        icon: FileText,
        permission: 'booking.view',
        ready: true,
      },
    ],
  },
  {
    label: 'People & Work',
    items: [
      { label: 'People', to: '/people', icon: Users, permission: 'employee.view', ready: true },
      {
        label: 'Attendance',
        to: '/attendance',
        icon: Fingerprint,
        permission: 'attendance.view',
        ready: true,
      },
      {
        label: 'Shifts',
        to: '/shifts',
        icon: CalendarClock,
        permission: 'shift.view',
        ready: true,
      },
      { label: 'Leave', to: '/leave', icon: CalendarDays, permission: 'leave.view', ready: true },
      {
        label: 'Timesheets',
        to: '/timesheets',
        icon: Clock,
        permission: 'timesheet.view',
        ready: true,
      },
    ],
  },
  {
    label: 'Projects',
    items: [
      {
        label: 'Projects',
        to: '/projects',
        icon: ClipboardList,
        permission: 'project.view',
        ready: true,
      },
      { label: 'Tasks', to: '/tasks', icon: ListChecks, permission: 'task.view', ready: true },
    ],
  },
  {
    label: 'Money',
    items: [
      {
        label: 'Expenses',
        to: '/expenses',
        icon: Banknote,
        permission: 'expense.view',
        ready: true,
      },
      {
        label: 'Project Cost',
        to: '/project-cost',
        icon: Coins,
        permission: 'cost.view',
        ready: true,
      },
    ],
  },
  {
    label: 'Insights & Admin',
    items: [
      {
        label: 'Reports',
        to: '/reports',
        icon: BarChart3,
        permission: 'report.view',
        ready: true,
      },
      {
        label: 'Roles & Permissions',
        to: '/roles',
        icon: ShieldCheck,
        permission: 'role.view',
      },
      {
        label: 'Settings',
        to: '/settings',
        icon: Settings,
        permission: 'settings.view',
        ready: true,
      },
    ],
  },
];

/** The five destinations on the mobile bottom bar, for employee screens. */
export const MOBILE_NAV: NavItem[] = [
  { label: 'My Day', to: '/', icon: LayoutDashboard, permission: 'dashboard.view' },
  { label: 'Attendance', to: '/attendance', icon: Fingerprint, permission: 'attendance.view' },
  {
    label: 'Timesheets',
    to: '/timesheets',
    icon: Clock,
    permission: 'timesheet.view',
    ready: true,
  },
  { label: 'Leave', to: '/leave', icon: CalendarDays, permission: 'leave.view', ready: true },
  {
    label: 'Expenses',
    to: '/expenses',
    icon: Banknote,
    permission: 'expense.view',
    ready: true,
  },
];

/** Hides what a role cannot open. The backend is what actually enforces it. */
export function visibleGroups(permissions: ReadonlySet<string>): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => permissions.has(item.permission)),
  })).filter((group) => group.items.length > 0);
}
