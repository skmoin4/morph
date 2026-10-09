import { Injectable } from '@nestjs/common';
import { DataScope } from '@opsvera/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../types/authenticated-user';

/**
 * Turns a role's data scope into a Prisma `where` fragment.
 *
 * Scope is the third level of the permission model, after module access and
 * action access. It is always applied as a query filter on the server — the
 * frontend never decides what a list contains.
 *
 *   OWN      the user's own rows
 *   TEAM     the user plus everyone reporting to them (one level, plus nested)
 *   PROJECT  rows on projects the user manages or is a member of
 *   OFFICE   rows belonging to the user's office
 *   ALL      no filter
 */
@Injectable()
export class DataScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** The scope granted for a permission key, defaulting to the narrowest. */
  scopeFor(user: AuthenticatedUser, permissionKey: string): DataScope {
    return user.scopes.get(permissionKey) ?? DataScope.OWN;
  }

  /**
   * Employee ids the user may see at this scope. `null` means "no restriction".
   * Returned as ids rather than a nested filter so the same answer can be
   * reused across attendance, timesheets, leave and expenses.
   */
  async visibleEmployeeIds(user: AuthenticatedUser, scope: DataScope): Promise<string[] | null> {
    if (scope === DataScope.ALL) return null;

    const self = user.employeeId ? [user.employeeId] : [];

    switch (scope) {
      case DataScope.OWN:
        return self;

      case DataScope.TEAM: {
        if (!user.employeeId) return [];
        const team = await this.descendantEmployeeIds(user.employeeId);
        return [...new Set([...self, ...team])];
      }

      case DataScope.PROJECT: {
        if (!user.employeeId) return [];
        const projectIds = await this.visibleProjectIds(user, scope);
        if (projectIds === null) return null;
        const members = await this.prisma.scoped.projectMember.findMany({
          where: { projectId: { in: projectIds } },
          select: { employeeId: true },
        });
        return [...new Set([...self, ...members.map((m) => m.employeeId)])];
      }

      case DataScope.OFFICE: {
        if (!user.officeId) return self;
        const colleagues = await this.prisma.scoped.employee.findMany({
          where: { officeId: user.officeId, deletedAt: null },
          select: { id: true },
        });
        return [...new Set([...self, ...colleagues.map((e) => e.id)])];
      }

      default:
        return self;
    }
  }

  /** Project ids the user may see. `null` means "no restriction". */
  async visibleProjectIds(user: AuthenticatedUser, scope: DataScope): Promise<string[] | null> {
    if (scope === DataScope.ALL) return null;
    if (!user.employeeId) return [];

    if (scope === DataScope.OFFICE && user.officeId) {
      const rows = await this.prisma.scoped.project.findMany({
        where: { officeId: user.officeId, deletedAt: null },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    }

    // OWN, TEAM and PROJECT all resolve to "projects I manage or work on".
    // For TEAM, a lead also sees the projects their reports are on.
    const employeeIds =
      scope === DataScope.TEAM
        ? [user.employeeId, ...(await this.descendantEmployeeIds(user.employeeId))]
        : [user.employeeId];

    const rows = await this.prisma.scoped.project.findMany({
      where: {
        deletedAt: null,
        OR: [
          { projectManagerId: { in: employeeIds } },
          { members: { some: { employeeId: { in: employeeIds } } } },
        ],
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * A `where` fragment for any model with an `employeeId` column.
   * Spreading `{}` when the scope is ALL keeps call sites free of conditionals.
   */
  async employeeFilter(
    user: AuthenticatedUser,
    permissionKey: string,
  ): Promise<{ employeeId?: { in: string[] } }> {
    const ids = await this.visibleEmployeeIds(user, this.scopeFor(user, permissionKey));
    return ids === null ? {} : { employeeId: { in: ids } };
  }

  /** A `where` fragment for any model with a `projectId` column. */
  async projectFilter(
    user: AuthenticatedUser,
    permissionKey: string,
  ): Promise<{ projectId?: { in: string[] } }> {
    const ids = await this.visibleProjectIds(user, this.scopeFor(user, permissionKey));
    return ids === null ? {} : { projectId: { in: ids } };
  }

  /** A `where` fragment for the Project model itself. */
  async projectIdFilter(
    user: AuthenticatedUser,
    permissionKey: string,
  ): Promise<{ id?: { in: string[] } }> {
    const ids = await this.visibleProjectIds(user, this.scopeFor(user, permissionKey));
    return ids === null ? {} : { id: { in: ids } };
  }

  /**
   * The reporting tree below an employee, following managerId downward.
   * Iterative rather than recursive SQL so it stays portable, and depth-capped
   * so a bad managerId cycle cannot hang a request.
   */
  private async descendantEmployeeIds(rootEmployeeId: string): Promise<string[]> {
    const collected = new Set<string>();
    let frontier = [rootEmployeeId];

    for (let depth = 0; depth < 10 && frontier.length > 0; depth += 1) {
      const reports = await this.prisma.scoped.employee.findMany({
        where: { managerId: { in: frontier }, deletedAt: null },
        select: { id: true },
      });
      frontier = reports.map((r) => r.id).filter((id) => !collected.has(id));
      for (const id of frontier) collected.add(id);
    }

    return [...collected];
  }
}
