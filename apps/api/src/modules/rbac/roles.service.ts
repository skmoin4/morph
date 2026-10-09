import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ACTIONS,
  DataScope,
  MODULES,
  SPECIAL_PERMISSIONS,
  type CreateRoleInput,
  type RoleListQuery,
  type SetRolePermissionsInput,
  type UpdateRoleInput,
} from '@opsvera/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The permission catalogue, shaped for the matrix screen: modules down the
   * side, actions across the top, plus the keys that do not fit that grid.
   */
  async catalogue() {
    const permissions = await this.prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
    });
    const byKey = new Map(permissions.map((p) => [p.key, p]));

    return {
      modules: MODULES.map((module) => ({
        module,
        actions: ACTIONS.flatMap((action) => {
          const permission = byKey.get(`${module}.${action}`);
          return permission ? [{ key: permission.key, action, label: permission.label }] : [];
        }),
      })),
      special: SPECIAL_PERMISSIONS.flatMap((key) => {
        const permission = byKey.get(key);
        return permission
          ? [
              {
                key: permission.key,
                module: permission.module,
                label: permission.label,
                isSensitive: permission.isSensitive,
              },
            ]
          : [];
      }),
      dataScopes: Object.values(DataScope),
    };
  }

  async list(query: RoleListQuery) {
    const where = {
      deletedAt: null,
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.q ? { name: { contains: query.q } } : {}),
    };
    const [sortField, sortDirection] = (query.sort ?? 'name:asc').split(':');

    const [roles, total] = await Promise.all([
      this.prisma.scoped.role.findMany({
        where,
        orderBy: { [sortField]: sortDirection as 'asc' | 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          _count: { select: { users: true, permissions: true } },
        },
      }),
      this.prisma.scoped.role.count({ where }),
    ]);

    return {
      data: roles.map((role) => ({
        id: role.id,
        name: role.name,
        systemKey: role.systemKey,
        description: role.description,
        isSystem: role.isSystem,
        isActive: role.isActive,
        userCount: role._count.users,
        permissionCount: role._count.permissions,
      })),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  /** One role with its full matrix, for the edit screen. */
  async findOne(roleId: string) {
    const role = await this.prisma.scoped.role.findFirst({
      where: { id: roleId, deletedAt: null },
      include: {
        permissions: { include: { permission: { select: { key: true } } } },
        _count: { select: { users: true } },
      },
    });
    if (!role) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Role not found.' });

    return {
      id: role.id,
      name: role.name,
      systemKey: role.systemKey,
      description: role.description,
      isSystem: role.isSystem,
      isActive: role.isActive,
      userCount: role._count.users,
      permissions: role.permissions
        .map((p) => ({ key: p.permission.key, dataScope: p.dataScope }))
        .sort((a, b) => a.key.localeCompare(b.key)),
    };
  }

  async create(input: CreateRoleInput, actor: AuthenticatedUser) {
    const existing = await this.prisma.scoped.role.findFirst({
      where: { name: input.name, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException({
        code: 'DUPLICATE',
        message: `A role called "${input.name}" already exists.`,
      });
    }

    const permissionIds = await this.resolvePermissionIds(input.permissions.map((p) => p.key));

    const role = await this.prisma.scoped.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          isSystem: false,
          createdById: actor.userId,
        } as never,
      });

      if (input.permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: input.permissions.map((grant) => ({
            roleId: created.id,
            permissionId: permissionIds.get(grant.key)!,
            dataScope: grant.dataScope,
            createdById: actor.userId,
          })) as never,
        });
      }

      await this.audit.record(
        {
          action: 'PERMISSION_CHANGE',
          entityType: 'Role',
          entityId: created.id,
          summary: `Created role "${input.name}" with ${input.permissions.length} permissions`,
          after: { name: input.name, permissions: input.permissions },
          userId: actor.userId,
        },
        tx,
      );

      return created;
    });

    return this.findOne(role.id);
  }

  async update(roleId: string, input: UpdateRoleInput, actor: AuthenticatedUser) {
    const role = await this.requireRole(roleId);

    if (input.name && input.name !== role.name) {
      const clash = await this.prisma.scoped.role.findFirst({
        where: { name: input.name, deletedAt: null, id: { not: roleId } },
      });
      if (clash) {
        throw new ConflictException({
          code: 'DUPLICATE',
          message: `A role called "${input.name}" already exists.`,
        });
      }
    }

    // A system role may be renamed and re-scoped, but never deactivated — the
    // seeded six are what new users are assigned to.
    if (role.isSystem && input.isActive === false) {
      throw new BadRequestException({
        code: 'ROLE_IS_SYSTEM',
        message: 'A built-in role cannot be deactivated.',
      });
    }

    const updated = await this.prisma.scoped.role.update({
      where: { id: roleId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      },
    });

    await this.audit.recordChange({
      action: 'UPDATE',
      entityType: 'Role',
      entityId: roleId,
      summary: `Updated role "${updated.name}"`,
      before: role as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
      fields: ['name', 'description', 'isActive'],
      userId: actor.userId,
    });

    return this.findOne(roleId);
  }

  /**
   * Replaces a role's whole matrix.
   *
   * Saving the entire grid rather than individual toggles means the diff — and
   * so the audit entry — describes one coherent change the admin actually made.
   */
  async setPermissions(roleId: string, input: SetRolePermissionsInput, actor: AuthenticatedUser) {
    const role = await this.requireRole(roleId);

    // The CEO role is the way back in if a matrix is misconfigured, so it keeps
    // at least the permission screen.
    if (role.systemKey === 'CEO') {
      const keys = new Set(input.permissions.map((p) => p.key));
      if (!keys.has('role.view') || !keys.has('role.edit')) {
        throw new BadRequestException({
          code: 'ROLE_LOCKOUT',
          message:
            'The CEO role must keep "View" and "Edit" on Roles & Permissions, or nobody could fix a mistake here.',
        });
      }
    }

    const permissionIds = await this.resolvePermissionIds(input.permissions.map((p) => p.key));

    const before = await this.prisma.scoped.rolePermission.findMany({
      where: { roleId },
      include: { permission: { select: { key: true } } },
    });
    const beforeGrants = before
      .map((g) => ({ key: g.permission.key, dataScope: g.dataScope }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const afterGrants = [...input.permissions].sort((a, b) => a.key.localeCompare(b.key));

    await this.prisma.scoped.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (afterGrants.length > 0) {
        await tx.rolePermission.createMany({
          data: afterGrants.map((grant) => ({
            roleId,
            permissionId: permissionIds.get(grant.key)!,
            dataScope: grant.dataScope,
            createdById: actor.userId,
          })) as never,
        });
      }

      await this.audit.record(
        {
          action: 'PERMISSION_CHANGE',
          entityType: 'Role',
          entityId: roleId,
          summary: `Changed permissions for "${role.name}": ${beforeGrants.length} -> ${afterGrants.length}`,
          before: { permissions: beforeGrants },
          after: { permissions: afterGrants },
          userId: actor.userId,
        },
        tx,
      );
    });

    return this.findOne(roleId);
  }

  async remove(roleId: string, actor: AuthenticatedUser) {
    const role = await this.requireRole(roleId);

    if (role.isSystem) {
      throw new BadRequestException({
        code: 'ROLE_IS_SYSTEM',
        message: 'A built-in role cannot be deleted. Deactivate a custom role instead.',
      });
    }

    const inUse = await this.prisma.scoped.user.count({
      where: { roleId, deletedAt: null },
    });
    if (inUse > 0) {
      throw new ConflictException({
        code: 'ROLE_IN_USE',
        message: `${inUse} ${inUse === 1 ? 'user is' : 'users are'} still on this role. Move them first.`,
      });
    }

    await this.prisma.scoped.role.update({
      where: { id: roleId },
      data: { deletedAt: new Date(), isActive: false },
    });

    await this.audit.record({
      action: 'DELETE',
      entityType: 'Role',
      entityId: roleId,
      summary: `Deleted role "${role.name}"`,
      before: { name: role.name },
      userId: actor.userId,
    });
  }

  /** Moves a user onto a different role. */
  async assign(userId: string, roleId: string, actor: AuthenticatedUser) {
    const [user, role] = await Promise.all([
      this.prisma.scoped.user.findFirst({ where: { id: userId, deletedAt: null } }),
      this.requireRole(roleId),
    ]);

    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found.' });
    if (!role.isActive) {
      throw new BadRequestException({
        code: 'ROLE_INACTIVE',
        message: 'That role is not active.',
      });
    }

    const previous = await this.prisma.scoped.role.findUnique({ where: { id: user.roleId } });

    await this.prisma.scoped.user.update({ where: { id: userId }, data: { roleId } });

    await this.audit.record({
      action: 'PERMISSION_CHANGE',
      entityType: 'User',
      entityId: userId,
      summary: `Moved ${user.fullName} from "${previous?.name ?? 'unknown'}" to "${role.name}"`,
      before: { roleId: user.roleId, roleName: previous?.name },
      after: { roleId, roleName: role.name },
      userId: actor.userId,
    });
  }

  // -------------------------------------------------------------------------

  private async requireRole(roleId: string) {
    const role = await this.prisma.scoped.role.findFirst({
      where: { id: roleId, deletedAt: null },
    });
    if (!role) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Role not found.' });
    return role;
  }

  /** Maps permission keys to ids, rejecting any the catalogue does not know. */
  private async resolvePermissionIds(keys: string[]): Promise<Map<string, string>> {
    if (keys.length === 0) return new Map();

    const rows = await this.prisma.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true, key: true },
    });
    const map = new Map(rows.map((r) => [r.key, r.id]));

    const unknown = keys.filter((k) => !map.has(k));
    if (unknown.length > 0) {
      throw new BadRequestException({
        code: 'UNKNOWN_PERMISSION',
        message: 'One or more permissions are not recognised.',
        details: { unknown },
      });
    }
    return map;
  }
}
