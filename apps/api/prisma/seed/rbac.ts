import {
  ALL_PERMISSIONS,
  DEFAULT_ROLES,
  SENSITIVE_PERMISSIONS,
  resolveRolePermissions,
} from '@opsvera/shared';
import { log, prisma } from './helpers';

/** Human labels for the module half of a permission key. */
const MODULE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  client: 'Clients',
  booking: 'Bookings',
  project: 'Projects',
  task: 'Tasks',
  employee: 'People',
  attendance: 'Attendance',
  shift: 'Shifts',
  leave: 'Leave',
  timesheet: 'Timesheets',
  expense: 'Expenses',
  cost: 'Project Cost',
  report: 'Reports',
  role: 'Roles & Permissions',
  settings: 'Settings',
  audit: 'Audit Log',
  salary: 'Salary',
  margin: 'Margin',
};

const ACTION_LABELS: Record<string, string> = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
  approve: 'Approve',
  export: 'Export',
  confirm: 'Confirm',
  reopen: 'Reopen',
  reimburse: 'Mark reimbursed',
  regularise: 'Regularise',
  value: 'Value',
};

function labelFor(key: string): string {
  const parts = key.split('.');
  const module = MODULE_LABELS[parts[0]] ?? parts[0];
  const action = parts
    .slice(1)
    .map((p) => ACTION_LABELS[p] ?? p)
    .join(' ');
  return `${action} ${module}`.trim();
}

/** The permission catalogue is global, not per company. */
export async function seedPermissions(): Promise<void> {
  const sensitive = new Set<string>(SENSITIVE_PERMISSIONS);

  for (const key of ALL_PERMISSIONS) {
    const [module, ...rest] = key.split('.');
    await prisma.permission.upsert({
      where: { key },
      update: { label: labelFor(key), isSensitive: sensitive.has(key) },
      create: {
        key,
        module,
        action: rest.join('.'),
        label: labelFor(key),
        isSensitive: sensitive.has(key),
      },
    });
  }
  log(`${ALL_PERMISSIONS.length} permissions in catalogue`);
}

export async function seedRoles(companyId: string): Promise<Record<string, string>> {
  const permissions = await prisma.permission.findMany({ select: { id: true, key: true } });
  const permissionIdByKey = new Map(permissions.map((p) => [p.key, p.id]));
  const roleIdByKey: Record<string, string> = {};

  for (const def of DEFAULT_ROLES) {
    const role = await prisma.role.upsert({
      where: { companyId_name: { companyId, name: def.name } },
      update: { description: def.description, systemKey: def.systemKey, isSystem: true },
      create: {
        companyId,
        name: def.name,
        systemKey: def.systemKey,
        description: def.description,
        isSystem: true,
      },
    });
    roleIdByKey[def.systemKey] = role.id;

    const grants = resolveRolePermissions(def);
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: grants.flatMap((g) => {
        const permissionId = permissionIdByKey.get(g.key);
        return permissionId
          ? [{ companyId, roleId: role.id, permissionId, dataScope: g.dataScope }]
          : [];
      }),
    });
    log(`role ${def.name}: ${grants.length} permissions, default scope ${def.defaultScope}`);
  }

  return roleIdByKey;
}
