/**
 * The permission catalogue. Every guarded endpoint names one of these keys.
 * Format is `module.action` — the module half also drives sidebar/module access.
 */

export const MODULES = [
  'dashboard',
  'client',
  'booking',
  'project',
  'task',
  'employee',
  'attendance',
  'shift',
  'leave',
  'timesheet',
  'expense',
  'cost',
  'report',
  'role',
  'settings',
  'audit',
] as const;
export type Module = (typeof MODULES)[number];

export const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export'] as const;
export type Action = (typeof ACTIONS)[number];

/** Extra, non-CRUD permission keys that do not follow the module × action grid. */
export const SPECIAL_PERMISSIONS = [
  'booking.confirm',
  'timesheet.reopen',
  'expense.reimburse',
  'attendance.regularise',
  'salary.view',
  'salary.edit',
  'cost.view',
  'cost.edit',
  'margin.view',
  'project.value.view',
] as const;

/** Keys that mask sensitive response fields rather than gating a route. */
export const SENSITIVE_PERMISSIONS = [
  'salary.view',
  'cost.view',
  'margin.view',
  'project.value.view',
] as const;
export type SensitivePermission = (typeof SENSITIVE_PERMISSIONS)[number];

export type PermissionKey = `${Module}.${Action}` | (typeof SPECIAL_PERMISSIONS)[number];

/**
 * The full flat list of permission keys, used by the seeder and the matrix
 * screen.
 *
 * Deduplicated on purpose: a few special keys (`cost.view`, `cost.edit`) are
 * also valid module x action combinations, so the two sources overlap. The
 * catalogue is keyed uniquely in the database, and the matrix screen renders
 * each key once.
 */
export const ALL_PERMISSIONS: PermissionKey[] = [
  ...new Set<PermissionKey>([
    ...MODULES.flatMap((m) => ACTIONS.map((a) => `${m}.${a}` as PermissionKey)),
    ...SPECIAL_PERMISSIONS,
  ]),
];

export const SYSTEM_ROLES = {
  CEO: 'CEO',
  HR_ADMIN: 'HR_ADMIN',
  PROJECT_MANAGER: 'PROJECT_MANAGER',
  FINANCE: 'FINANCE',
  TEAM_LEAD: 'TEAM_LEAD',
  EMPLOYEE: 'EMPLOYEE',
} as const;
export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];
