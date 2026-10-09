import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  canMoveProject,
  ProjectStatus,
  type AddProjectMemberInput,
  type ChangeProjectStatusInput,
  type MilestoneInput,
  type ProjectListQuery,
  type UpdateMilestoneInput,
  type UpdateProjectInput,
  type UpdateProjectMemberInput,
} from '@opsvera/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DataScopeService } from '../../common/scope/data-scope.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);
const today = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');

/** Columns the list may be sorted by. Anything else is ignored, not a 500. */
const SORTABLE = new Set([
  'projectCode',
  'name',
  'status',
  'health',
  'startDate',
  'endDate',
  'createdAt',
]);

const PROJECT_INCLUDE = {
  client: { select: { id: true, name: true } },
  projectType: { select: { id: true, name: true, shortCode: true, colorToken: true } },
  office: { select: { id: true, name: true, shortCode: true } },
  projectManager: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
} satisfies Prisma.ProjectInclude;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: DataScopeService,
  ) {}

  // -------------------------------------------------------------------------
  // Visibility
  // -------------------------------------------------------------------------

  /**
   * Throws a 404 — not a 403 — for a project outside the caller's data scope,
   * so the response does not reveal that the project exists.
   */
  async assertVisible(id: string, user: AuthenticatedUser, permission = 'project.view') {
    const filter = await this.scope.projectIdFilter(user, permission);
    // `filter` is `{ id: { in: [...] } }` for a narrowed scope, so it must be
    // ANDed: spreading it next to `id` would replace the requested id and
    // return whichever visible project came first.
    const project = await this.prisma.scoped.project.findFirst({
      where: { AND: [{ id, deletedAt: null }, filter] },
      select: { id: true, status: true, projectManagerId: true, name: true, projectCode: true },
    });
    if (!project) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Project not found.' });
    }
    return project;
  }

  // -------------------------------------------------------------------------
  // List, summary, lookups
  // -------------------------------------------------------------------------

  async list(query: ProjectListQuery, user: AuthenticatedUser) {
    const filter = await this.scope.projectIdFilter(user, 'project.view');

    const where: Prisma.ProjectWhereInput = {
      deletedAt: null,
      ...filter,
      ...(query.status ? { status: query.status } : {}),
      ...(query.health ? { health: query.health } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.officeId ? { officeId: query.officeId } : {}),
      ...(query.projectTypeId ? { projectTypeId: query.projectTypeId } : {}),
      ...(query.projectManagerId ? { projectManagerId: query.projectManagerId } : {}),
      ...(query.q
        ? {
            OR: [
              { projectCode: { contains: query.q } },
              { name: { contains: query.q } },
              { client: { name: { contains: query.q } } },
            ],
          }
        : {}),
    };

    const [requestedField, requestedDirection] = (query.sort ?? 'createdAt:desc').split(':');
    const sortField = SORTABLE.has(requestedField) ? requestedField : 'createdAt';
    const sortDirection = requestedDirection === 'asc' ? 'asc' : 'desc';

    const [rows, total] = await Promise.all([
      this.prisma.scoped.project.findMany({
        where,
        include: { ...PROJECT_INCLUDE, _count: { select: { members: true } } },
        orderBy: { [sortField]: sortDirection },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.scoped.project.count({ where }),
    ]);

    const taskStats = await this.taskStats(rows.map((r) => r.id));

    return {
      data: rows.map((row) => ({
        ...row,
        ...this.derived(row),
        tasks: taskStats.get(row.id) ?? emptyTaskStats(),
      })),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async summary(user: AuthenticatedUser) {
    const filter = await this.scope.projectIdFilter(user, 'project.view');
    const base = { deletedAt: null, ...filter };

    const [active, onHold, completed, cancelled, atRisk, overBudget] = await Promise.all([
      this.prisma.scoped.project.count({ where: { ...base, status: 'ACTIVE' } }),
      this.prisma.scoped.project.count({ where: { ...base, status: 'ON_HOLD' } }),
      this.prisma.scoped.project.count({ where: { ...base, status: 'COMPLETED' } }),
      this.prisma.scoped.project.count({ where: { ...base, status: 'CANCELLED' } }),
      this.prisma.scoped.project.count({
        where: { ...base, status: 'ACTIVE', health: { in: ['AT_RISK', 'CRITICAL'] } },
      }),
      // Compared in code rather than raw SQL: raw queries bypass the tenant
      // extension and the data-scope filter, and hours are not sensitive.
      this.prisma.scoped.project
        .findMany({
          where: { ...base, status: 'ACTIVE', budgetHours: { gt: 0 } },
          select: { budgetHours: true, actualHours: true },
        })
        .then((rows) => rows.filter((r) => r.actualHours.gt(r.budgetHours)).length),
    ]);

    return { active, onHold, completed, cancelled, atRisk, overBudgetHours: overBudget };
  }

  /**
   * People who can be added to a project team. Only for those who can edit the
   * team, so it does not turn into a company-wide employee directory for
   * everyone who can merely open a project.
   */
  async lookups() {
    const employees = await this.prisma.scoped.employee.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        designation: { select: { name: true } },
        office: { select: { shortCode: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    return {
      employees: employees.map((e) => ({
        id: e.id,
        employeeCode: e.employeeCode,
        fullName: `${e.firstName} ${e.lastName}`,
        designation: e.designation?.name ?? null,
        office: e.office.shortCode,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Project 360
  // -------------------------------------------------------------------------

  async findOne(id: string, user: AuthenticatedUser) {
    await this.assertVisible(id, user);

    const project = await this.prisma.scoped.project.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...PROJECT_INCLUDE,
        booking: {
          select: {
            id: true,
            bookingNumber: true,
            bookingDate: true,
            status: true,
            confirmedAt: true,
            scopeDescription: true,
            confirmation: {
              select: {
                type: true,
                emailReceivedAt: true,
                emailDocumentId: true,
                confirmedByName: true,
                confirmedOn: true,
                verbalMode: true,
                verbalSummary: true,
                poNumber: true,
              },
            },
          },
        },
        members: {
          include: {
            employee: {
              select: {
                id: true,
                employeeCode: true,
                firstName: true,
                lastName: true,
                designation: { select: { name: true } },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        milestones: {
          where: { deletedAt: null },
          orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }],
          include: { _count: { select: { tasks: true } } },
        },
      },
    });
    if (!project) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Project not found.' });
    }

    const stats = (await this.taskStats([id])).get(id) ?? emptyTaskStats();
    const derived = this.derived(project);

    const activeMembers = project.members.filter((m) => !m.leftOn);

    return {
      ...project,
      ...derived,
      members: project.members.map((m) => ({
        ...m,
        fullName: `${m.employee.firstName} ${m.employee.lastName}`,
        isActive: !m.leftOn,
      })),
      tasks: stats,
      // Scheduled = there is a plan (milestones or tasks) and someone to do it.
      scheduled: activeMembers.length > 0 && (project.milestones.length > 0 || stats.total > 0),
    };
  }

  /** Burn and margin figures derived from the stored totals. */
  private derived(row: {
    budgetHours: Prisma.Decimal;
    actualHours: Prisma.Decimal;
    projectValue: Prisma.Decimal;
    actualTotalCost: Prisma.Decimal;
  }) {
    const budget = Number(row.budgetHours);
    const actual = Number(row.actualHours);
    const value = Number(row.projectValue);
    const cost = Number(row.actualTotalCost);

    return {
      hoursBurnPercent: budget > 0 ? Math.round((actual / budget) * 1000) / 10 : null,
      // Masked unless the caller holds margin.view (see field masking).
      marginAmount: (value - cost).toFixed(2),
      marginPercent: value > 0 ? Math.round(((value - cost) / value) * 1000) / 10 : null,
    };
  }

  private async taskStats(projectIds: string[]) {
    const stats = new Map<string, ReturnType<typeof emptyTaskStats>>();
    if (projectIds.length === 0) return stats;

    const rows = await this.prisma.scoped.task.groupBy({
      by: ['projectId', 'status'],
      where: { projectId: { in: projectIds }, deletedAt: null },
      _count: { _all: true },
    });

    for (const row of rows) {
      const entry = stats.get(row.projectId) ?? emptyTaskStats();
      entry[row.status] += row._count._all;
      entry.total += row._count._all;
      stats.set(row.projectId, entry);
    }
    return stats;
  }

  // -------------------------------------------------------------------------
  // Update & status
  // -------------------------------------------------------------------------

  async update(id: string, input: UpdateProjectInput, user: AuthenticatedUser) {
    const before = await this.assertVisible(id, user, 'project.edit');

    if (input.projectManagerId) {
      await this.requireActiveEmployee(input.projectManagerId, 'project manager');
    }

    // The new dates have to agree with the stored one when only one is sent.
    if (input.startDate !== undefined || input.endDate !== undefined) {
      const current = await this.prisma.scoped.project.findFirstOrThrow({
        where: { id },
        select: { startDate: true, endDate: true },
      });
      const start =
        input.startDate === undefined
          ? current.startDate
          : input.startDate
            ? d(input.startDate)
            : null;
      const end =
        input.endDate === undefined ? current.endDate : input.endDate ? d(input.endDate) : null;
      if (start && end && end < start) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'End date must be on or after the start date.',
          details: [{ path: 'endDate', message: 'End date must be on or after the start date' }],
        });
      }
    }

    const full = await this.prisma.scoped.project.findFirstOrThrow({ where: { id } });
    const after = await this.prisma.scoped.project.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.health !== undefined ? { health: input.health } : {}),
        ...(input.projectManagerId !== undefined
          ? { projectManagerId: input.projectManagerId }
          : {}),
        ...(input.startDate !== undefined
          ? { startDate: input.startDate ? d(input.startDate) : null }
          : {}),
        ...(input.endDate !== undefined
          ? { endDate: input.endDate ? d(input.endDate) : null }
          : {}),
      },
    });

    await this.audit.recordChange({
      action: 'UPDATE',
      entityType: 'Project',
      entityId: id,
      summary: `Updated project ${before.projectCode}`,
      before: full as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      fields: ['name', 'description', 'health', 'projectManagerId', 'startDate', 'endDate'],
      userId: user.userId,
    });

    return this.findOne(id, user);
  }

  async changeStatus(id: string, input: ChangeProjectStatusInput, user: AuthenticatedUser) {
    const project = await this.assertVisible(id, user, 'project.edit');
    const from = project.status as ProjectStatus;

    if (from === input.status) {
      throw new ConflictException({
        code: 'NO_CHANGE',
        message: `The project is already ${input.status.toLowerCase().replace('_', ' ')}.`,
      });
    }
    if (!canMoveProject(from, input.status)) {
      throw new BadRequestException({
        code: 'INVALID_TRANSITION',
        message: `A ${from.toLowerCase().replace('_', ' ')} project cannot go straight to ${input.status
          .toLowerCase()
          .replace('_', ' ')}.`,
      });
    }

    await this.prisma.scoped.project.update({
      where: { id },
      data: {
        status: input.status,
        // Reopening clears the completion stamp so it is never stale.
        completedAt: input.status === ProjectStatus.COMPLETED ? new Date() : null,
      },
    });

    await this.audit.record({
      action: input.status === ProjectStatus.CANCELLED ? 'DELETE' : 'UPDATE',
      entityType: 'Project',
      entityId: id,
      summary: `Project ${project.projectCode}: ${from} → ${input.status}${input.reason ? ` (${input.reason})` : ''}`,
      before: { status: from },
      after: { status: input.status },
      reason: input.reason ?? null,
      userId: user.userId,
    });

    return this.findOne(id, user);
  }

  // -------------------------------------------------------------------------
  // Team
  // -------------------------------------------------------------------------

  async addMember(projectId: string, input: AddProjectMemberInput, user: AuthenticatedUser) {
    const project = await this.assertVisible(projectId, user, 'project.edit');
    await this.requireActiveEmployee(input.employeeId, 'team member');

    const existing = await this.prisma.scoped.projectMember.findFirst({
      where: { projectId, employeeId: input.employeeId },
    });
    if (existing && !existing.leftOn) {
      throw new ConflictException({
        code: 'ALREADY_MEMBER',
        message: 'That person is already on the project team.',
        details: { field: 'employeeId' },
      });
    }

    const data = {
      roleOnProject: input.roleOnProject ?? null,
      allocationPercent: input.allocationPercent,
      joinedOn: input.joinedOn ? d(input.joinedOn) : today(),
      leftOn: null,
    };

    // Re-adding someone who left reopens their row: the unique key is
    // (project, employee), and their history stays attached.
    const member = existing
      ? await this.prisma.scoped.projectMember.update({ where: { id: existing.id }, data })
      : await this.prisma.scoped.projectMember.create({
          data: {
            projectId,
            employeeId: input.employeeId,
            createdById: user.userId,
            ...data,
          } as never,
        });

    await this.audit.record({
      action: 'CREATE',
      entityType: 'ProjectMember',
      entityId: member.id,
      summary: `Added a team member to ${project.projectCode}`,
      after: { employeeId: input.employeeId, ...data },
      userId: user.userId,
    });

    return this.findOne(projectId, user);
  }

  async updateMember(
    projectId: string,
    memberId: string,
    input: UpdateProjectMemberInput,
    user: AuthenticatedUser,
  ) {
    await this.assertVisible(projectId, user, 'project.edit');
    const member = await this.requireMember(projectId, memberId);
    if (member.leftOn) {
      throw new BadRequestException({
        code: 'MEMBER_LEFT',
        message: 'That person has left the project. Add them back first.',
      });
    }
    await this.prisma.scoped.projectMember.update({ where: { id: memberId }, data: input });
    return this.findOne(projectId, user);
  }

  /**
   * Takes someone off the team by stamping `leftOn`, never by deleting the row:
   * time and cost already recorded against them keep resolving.
   */
  async removeMember(projectId: string, memberId: string, user: AuthenticatedUser) {
    const project = await this.assertVisible(projectId, user, 'project.edit');
    const member = await this.requireMember(projectId, memberId);
    if (member.leftOn) return this.findOne(projectId, user);

    const openTasks = await this.prisma.scoped.task.count({
      where: {
        projectId,
        assigneeId: member.employeeId,
        status: { not: 'DONE' },
        deletedAt: null,
      },
    });
    if (openTasks > 0) {
      throw new ConflictException({
        code: 'HAS_OPEN_TASKS',
        message: `They still have ${openTasks} open task${openTasks === 1 ? '' : 's'} on this project. Reassign or finish them first.`,
        details: { openTasks },
      });
    }

    await this.prisma.scoped.projectMember.update({
      where: { id: memberId },
      data: { leftOn: today() },
    });
    await this.audit.record({
      action: 'DELETE',
      entityType: 'ProjectMember',
      entityId: memberId,
      summary: `Removed a team member from ${project.projectCode}`,
      userId: user.userId,
    });
    return this.findOne(projectId, user);
  }

  private async requireMember(projectId: string, memberId: string) {
    const member = await this.prisma.scoped.projectMember.findFirst({
      where: { id: memberId, projectId },
    });
    if (!member) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Team member not found.' });
    }
    return member;
  }

  private async requireActiveEmployee(employeeId: string, label: string) {
    const employee = await this.prisma.scoped.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!employee) {
      throw new BadRequestException({
        code: 'EMPLOYEE_NOT_FOUND',
        message: `That ${label} does not exist.`,
      });
    }
    if (employee.status !== 'ACTIVE') {
      throw new BadRequestException({
        code: 'EMPLOYEE_INACTIVE',
        message: `That ${label} is not an active employee.`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Milestones
  // -------------------------------------------------------------------------

  async createMilestone(projectId: string, input: MilestoneInput, user: AuthenticatedUser) {
    await this.assertVisible(projectId, user, 'project.edit');
    await this.assertWithinProjectDates(projectId, input.dueDate);

    const last = await this.prisma.scoped.milestone.aggregate({
      where: { projectId, deletedAt: null },
      _max: { sortOrder: true },
    });

    const status = input.status ?? 'PENDING';
    const milestone = await this.prisma.scoped.milestone.create({
      data: {
        projectId,
        name: input.name,
        description: input.description ?? null,
        dueDate: d(input.dueDate),
        value: input.value ?? null,
        status,
        completedOn: status === 'COMPLETED' ? today() : null,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        createdById: user.userId,
      } as never,
    });
    return milestone;
  }

  async updateMilestone(
    projectId: string,
    milestoneId: string,
    input: UpdateMilestoneInput,
    user: AuthenticatedUser,
  ) {
    await this.assertVisible(projectId, user, 'project.edit');
    const existing = await this.requireMilestone(projectId, milestoneId);
    if (input.dueDate) await this.assertWithinProjectDates(projectId, input.dueDate);

    const becameComplete = input.status === 'COMPLETED' && existing.status !== 'COMPLETED';
    const reopened =
      input.status && input.status !== 'COMPLETED' && existing.status === 'COMPLETED';

    return this.prisma.scoped.milestone.update({
      where: { id: milestoneId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.dueDate !== undefined ? { dueDate: d(input.dueDate) } : {}),
        ...(input.value !== undefined ? { value: input.value } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(becameComplete ? { completedOn: today() } : {}),
        ...(reopened ? { completedOn: null } : {}),
      },
    });
  }

  async deleteMilestone(projectId: string, milestoneId: string, user: AuthenticatedUser) {
    const project = await this.assertVisible(projectId, user, 'project.edit');
    const milestone = await this.requireMilestone(projectId, milestoneId);

    await this.prisma.scoped.$transaction(async (tx) => {
      // Its tasks stay on the project, just unattached.
      await tx.task.updateMany({ where: { milestoneId }, data: { milestoneId: null } });
      await tx.milestone.update({ where: { id: milestoneId }, data: { deletedAt: new Date() } });
    });

    await this.audit.record({
      action: 'DELETE',
      entityType: 'Milestone',
      entityId: milestoneId,
      summary: `Deleted milestone "${milestone.name}" from ${project.projectCode}`,
      userId: user.userId,
    });
  }

  private async requireMilestone(projectId: string, milestoneId: string) {
    const milestone = await this.prisma.scoped.milestone.findFirst({
      where: { id: milestoneId, projectId, deletedAt: null },
    });
    if (!milestone) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Milestone not found.' });
    }
    return milestone;
  }

  /** A milestone after the project's end date is almost always a typo. */
  private async assertWithinProjectDates(projectId: string, dueDate: string) {
    const project = await this.prisma.scoped.project.findFirst({
      where: { id: projectId },
      select: { startDate: true, endDate: true },
    });
    if (!project) return;
    const due = d(dueDate);
    if (
      (project.endDate && due > project.endDate) ||
      (project.startDate && due < project.startDate)
    ) {
      throw new BadRequestException({
        code: 'OUTSIDE_PROJECT_DATES',
        message: 'The due date falls outside the project’s start and end dates.',
        details: [{ path: 'dueDate', message: 'Outside the project’s start and end dates' }],
      });
    }
  }
}

export function emptyTaskStats() {
  return { TODO: 0, IN_PROGRESS: 0, REVIEW: 0, DONE: 0, total: 0 };
}
