import { Injectable } from '@nestjs/common';
import type { NotificationType } from '@prisma/client';
import { DataScope } from '@opsvera/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { DataScopeService } from '../scope/data-scope.service';
import type { AuthenticatedUser } from '../types/authenticated-user';

export interface Note {
  title: string;
  body?: string | null;
  /** Where the bell item goes, e.g. "/leave?tab=approvals". */
  linkUrl: string;
  entityType: string;
  entityId: string;
}

/**
 * Bell notifications for the people a workflow step concerns.
 *
 * "Who approves this" is answered the same way the approval itself is: the
 * holders of the approve permission whose data scope covers the person.
 */
@Injectable()
export class NotifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: DataScopeService,
  ) {}

  private row(userId: string, type: NotificationType, note: Note) {
    return {
      userId,
      type,
      title: note.title.slice(0, 200),
      body: note.body?.slice(0, 1000) ?? null,
      linkUrl: note.linkUrl,
      entityType: note.entityType,
      entityId: note.entityId,
    };
  }

  /** A person's own bell, if they have a login. */
  async toEmployee(employeeId: string, type: NotificationType, note: Note): Promise<void> {
    const employee = await this.prisma.scoped.employee.findFirst({
      where: { id: employeeId },
      select: { userId: true },
    });
    if (!employee?.userId) return;
    await this.prisma.scoped.notification.create({
      data: this.row(employee.userId, type, note) as never,
    });
  }

  /**
   * Everyone who holds `permissionKey` with a scope that reaches `subjectEmployeeId`,
   * except the subject (nobody is told to approve their own request) and
   * `exceptEmployeeId`.
   */
  async toApprovers(
    permissionKey: string,
    subjectEmployeeId: string,
    type: NotificationType,
    note: Note,
    options: { exceptEmployeeId?: string } = {},
  ): Promise<number> {
    const holders = await this.prisma.scoped.user.findMany({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        employee: { isNot: null },
        role: { permissions: { some: { permission: { key: permissionKey } } } },
      },
      select: {
        id: true,
        employee: { select: { id: true, officeId: true } },
        role: {
          select: {
            permissions: {
              where: { permission: { key: permissionKey } },
              select: { dataScope: true },
            },
          },
        },
      },
    });

    const recipients: string[] = [];
    for (const holder of holders) {
      const me = holder.employee;
      if (!me || me.id === subjectEmployeeId || me.id === options.exceptEmployeeId) continue;
      const dataScope = (holder.role.permissions[0]?.dataScope ?? DataScope.OWN) as DataScope;
      const ids = await this.scope.visibleEmployeeIds(
        { employeeId: me.id, officeId: me.officeId } as AuthenticatedUser,
        dataScope,
      );
      if (ids === null || ids.includes(subjectEmployeeId)) recipients.push(holder.id);
    }
    if (recipients.length === 0) return 0;
    await this.prisma.scoped.notification.createMany({
      data: recipients.map((userId) => this.row(userId, type, note)) as never,
    });
    return recipients.length;
  }
}
