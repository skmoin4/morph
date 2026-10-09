import { Injectable } from '@nestjs/common';
import { DataScope } from '@opsvera/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { runUnscoped } from '../../prisma/tenant-context';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';

interface LoadedUser {
  user: AuthenticatedUser;
  status: string;
}

/**
 * Loads a user together with the permissions and data scopes their role grants.
 *
 * Runs unscoped because it is called by the JWT guard *before* the tenant scope
 * exists — the company id is what it is fetching. It filters by the company id
 * from the token explicitly, so this is not a hole in the tenancy model.
 */
@Injectable()
export class UserPermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async load(userId: string, companyId: string): Promise<LoadedUser | null> {
    const row = await runUnscoped(() =>
      this.prisma.user.findFirst({
        where: { id: userId, companyId, deletedAt: null },
        include: {
          role: {
            include: {
              permissions: { include: { permission: { select: { key: true } } } },
            },
          },
          employee: { select: { id: true, officeId: true } },
        },
      }),
    );

    if (!row) return null;

    const permissions = new Set<string>();
    const scopes = new Map<string, DataScope>();
    for (const grant of row.role.permissions) {
      permissions.add(grant.permission.key);
      scopes.set(grant.permission.key, grant.dataScope as DataScope);
    }

    return {
      status: row.status,
      user: {
        userId: row.id,
        companyId: row.companyId,
        employeeId: row.employee?.id ?? null,
        roleId: row.roleId,
        roleName: row.role.name,
        systemRoleKey: row.role.systemKey,
        email: row.email,
        fullName: row.fullName,
        officeId: row.employee?.officeId ?? null,
        permissions,
        scopes,
      },
    };
  }
}
