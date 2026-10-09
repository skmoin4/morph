import { DataScope } from './enums';
import { ALL_PERMISSIONS, MODULES, SYSTEM_ROLES, type PermissionKey } from './permissions';

export interface RoleDefinition {
  systemKey: string;
  name: string;
  description: string;
  /** Explicit permission keys, or 'ALL' for every key in the catalogue. */
  permissions: PermissionKey[] | 'ALL';
  /** Scope applied to every permission unless overridden below. */
  defaultScope: DataScope;
  /** Per-key scope overrides. */
  scopeOverrides?: Partial<Record<PermissionKey, DataScope>>;
}

/** Every `view` + `export` key for a module, the common read-only grant. */
const read = (module: string): PermissionKey[] =>
  [`${module}.view`, `${module}.export`] as PermissionKey[];

/** Full CRUD on a module, without approve. */
const crud = (module: string): PermissionKey[] =>
  [
    `${module}.view`,
    `${module}.create`,
    `${module}.edit`,
    `${module}.delete`,
    `${module}.export`,
  ] as PermissionKey[];

/**
 * The six seeded roles. Admins can edit these and add their own (Sales,
 * Booking Manager…) through the permission matrix screen — these are only the
 * starting point, which is why every row is `isSystem` but still editable.
 */
export const DEFAULT_ROLES: RoleDefinition[] = [
  {
    systemKey: SYSTEM_ROLES.CEO,
    name: 'CEO / Director',
    description: 'Full access to every module and every office.',
    permissions: 'ALL',
    defaultScope: DataScope.ALL,
  },
  {
    systemKey: SYSTEM_ROLES.HR_ADMIN,
    name: 'HR / Admin',
    description: 'People, attendance, shifts, leave and company setup.',
    permissions: [
      'dashboard.view',
      ...crud('employee'),
      ...crud('attendance'),
      'attendance.approve',
      'attendance.regularise',
      ...crud('shift'),
      ...crud('leave'),
      'leave.approve',
      ...crud('settings'),
      ...crud('role'),
      'role.approve',
      ...read('report'),
      ...read('audit'),
      ...read('project'),
      ...read('client'),
      'salary.view',
      'salary.edit',
    ],
    defaultScope: DataScope.ALL,
  },
  {
    systemKey: SYSTEM_ROLES.PROJECT_MANAGER,
    name: 'Project Manager',
    description: 'Owns delivery: schedule, tasks, team time and project cost.',
    permissions: [
      'dashboard.view',
      ...crud('project'),
      ...crud('task'),
      'task.approve',
      ...read('booking'),
      ...read('client'),
      ...read('employee'),
      ...read('attendance'),
      'timesheet.view',
      'timesheet.approve',
      'timesheet.export',
      'expense.view',
      'expense.approve',
      'expense.export',
      'leave.view',
      'leave.approve',
      ...read('cost'),
      ...read('report'),
      'cost.view',
      'margin.view',
      'project.value.view',
    ],
    defaultScope: DataScope.PROJECT,
    scopeOverrides: {
      'dashboard.view': DataScope.PROJECT,
      'employee.view': DataScope.OFFICE,
      'attendance.view': DataScope.TEAM,
      'leave.view': DataScope.TEAM,
      'leave.approve': DataScope.TEAM,
    },
  },
  {
    systemKey: SYSTEM_ROLES.FINANCE,
    name: 'Finance',
    description: 'Second-level expense approval, cost ledger and money reports.',
    permissions: [
      'dashboard.view',
      ...crud('expense'),
      'expense.approve',
      'expense.reimburse',
      ...crud('cost'),
      'cost.view',
      'cost.edit',
      'margin.view',
      'project.value.view',
      'salary.view',
      ...read('project'),
      ...read('booking'),
      ...read('client'),
      ...read('employee'),
      ...read('timesheet'),
      ...read('report'),
      ...read('audit'),
      ...crud('settings'),
    ],
    defaultScope: DataScope.ALL,
  },
  {
    systemKey: SYSTEM_ROLES.TEAM_LEAD,
    name: 'Team Lead',
    description: 'First-level approver for their own team.',
    permissions: [
      'dashboard.view',
      ...read('project'),
      'task.view',
      'task.create',
      'task.edit',
      'task.export',
      ...read('employee'),
      ...read('attendance'),
      'attendance.approve',
      'attendance.regularise',
      'timesheet.view',
      'timesheet.create',
      'timesheet.edit',
      'timesheet.approve',
      'timesheet.export',
      'leave.view',
      'leave.create',
      'leave.approve',
      'expense.view',
      'expense.create',
      'expense.approve',
    ],
    defaultScope: DataScope.TEAM,
    scopeOverrides: {
      'project.view': DataScope.PROJECT,
      'task.view': DataScope.PROJECT,
      'timesheet.create': DataScope.OWN,
      'timesheet.edit': DataScope.OWN,
      'leave.create': DataScope.OWN,
      'expense.create': DataScope.OWN,
    },
  },
  {
    systemKey: SYSTEM_ROLES.EMPLOYEE,
    name: 'Employee',
    description: 'My Day: clock in, log time, apply for leave, claim expenses.',
    permissions: [
      'dashboard.view',
      'project.view',
      'task.view',
      'task.edit',
      'attendance.view',
      'attendance.create',
      'attendance.regularise',
      'timesheet.view',
      'timesheet.create',
      'timesheet.edit',
      'leave.view',
      'leave.create',
      'expense.view',
      'expense.create',
      'expense.edit',
    ],
    defaultScope: DataScope.OWN,
    scopeOverrides: {
      'project.view': DataScope.PROJECT,
      'task.view': DataScope.PROJECT,
      'task.edit': DataScope.OWN,
    },
  },
];

/** Resolves a role definition into concrete (permissionKey, dataScope) pairs. */
export function resolveRolePermissions(
  role: RoleDefinition,
): Array<{ key: PermissionKey; dataScope: DataScope }> {
  const keys = role.permissions === 'ALL' ? ALL_PERMISSIONS : role.permissions;
  const seen = new Set<string>();
  const out: Array<{ key: PermissionKey; dataScope: DataScope }> = [];

  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, dataScope: role.scopeOverrides?.[key] ?? role.defaultScope });
  }
  return out;
}

/** Modules a role can open at all — drives the sidebar. */
export function modulesForPermissions(permissionKeys: string[]): string[] {
  const granted = new Set(permissionKeys.map((k) => k.split('.')[0]));
  return MODULES.filter((m) => granted.has(m));
}
