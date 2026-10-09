import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DataScope,
  validateTaskAttachment,
  type CreateTaskInput,
  type MoveTaskInput,
  type TaskCommentInput,
  type TaskListQuery,
  type UpdateTaskInput,
} from '@opsvera/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FilesService } from '../files/files.service';
import { DataScopeService } from '../../common/scope/data-scope.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ProjectsService } from './projects.service';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);
const today = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');

const SORTABLE = new Set(['sortOrder', 'title', 'dueDate', 'priority', 'status', 'createdAt']);

const TASK_INCLUDE = {
  assignee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
  milestone: { select: { id: true, name: true } },
  project: { select: { id: true, projectCode: true, name: true, status: true } },
  _count: { select: { comments: true, attachments: true } },
} satisfies Prisma.TaskInclude;

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: DataScopeService,
    private readonly projects: ProjectsService,
    private readonly files: FilesService,
  ) {}

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async list(query: TaskListQuery, user: AuthenticatedUser) {
    const filter = await this.scope.projectFilter(user, 'task.view');

    // Every condition is its own AND clause, so filters can only narrow the
    // visible set — two of them touching the same column cannot override each
    // other, and the project filter can never widen the data scope.
    const clauses: Prisma.TaskWhereInput[] = [{ deletedAt: null }];
    if (filter.projectId) clauses.push({ projectId: filter.projectId });
    if (query.projectId) clauses.push({ projectId: query.projectId });
    if (query.milestoneId) clauses.push({ milestoneId: query.milestoneId });
    if (query.assigneeId) clauses.push({ assigneeId: query.assigneeId });
    if (query.mine) clauses.push({ assigneeId: user.employeeId ?? '__none__' });
    if (query.status) clauses.push({ status: query.status });
    if (query.priority) clauses.push({ priority: query.priority });
    if (query.overdue) clauses.push({ dueDate: { lt: today() }, status: { not: 'DONE' } });
    if (query.q) {
      clauses.push({
        OR: [{ title: { contains: query.q } }, { description: { contains: query.q } }],
      });
    }
    const where: Prisma.TaskWhereInput = { AND: clauses };

    const [requestedField, requestedDirection] = (query.sort ?? 'sortOrder:asc').split(':');
    const sortField = SORTABLE.has(requestedField) ? requestedField : 'sortOrder';
    const sortDirection = requestedDirection === 'desc' ? 'desc' : 'asc';

    const [rows, total] = await Promise.all([
      this.prisma.scoped.task.findMany({
        where,
        include: TASK_INCLUDE,
        orderBy: [{ [sortField]: sortDirection }, { createdAt: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.scoped.task.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.shape(row)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async findOne(id: string, user: AuthenticatedUser) {
    await this.assertVisible(id, user, 'task.view');

    const task = await this.prisma.scoped.task.findFirstOrThrow({
      where: { id, deletedAt: null },
      include: {
        ...TASK_INCLUDE,
        comments: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: { employee: { select: { id: true, firstName: true, lastName: true } } },
        },
        attachments: {
          orderBy: { createdAt: 'desc' },
          include: {
            document: { select: { id: true, fileName: true, sizeBytes: true, mimeType: true } },
          },
        },
      },
    });

    return {
      ...this.shape(task),
      comments: task.comments.map((c) => ({
        id: c.id,
        body: c.body,
        createdAt: c.createdAt,
        author: c.employee ? `${c.employee.firstName} ${c.employee.lastName}` : 'Former employee',
        authorId: c.employeeId,
      })),
      attachments: task.attachments.map((a) => ({
        // `id` is the attachment's (what the download and delete URLs take).
        id: a.id,
        createdAt: a.createdAt,
        fileName: a.document.fileName,
        sizeBytes: a.document.sizeBytes,
        mimeType: a.document.mimeType,
      })),
    };
  }

  private shape<
    T extends {
      assignee: { firstName: string; lastName: string } | null;
      dueDate: Date | null;
      status: string;
    },
  >(row: T) {
    return {
      ...row,
      assigneeName: row.assignee ? `${row.assignee.firstName} ${row.assignee.lastName}` : null,
      isOverdue: Boolean(row.dueDate && row.dueDate < today() && row.status !== 'DONE'),
    };
  }

  // -------------------------------------------------------------------------
  // Create, update, move, delete
  // -------------------------------------------------------------------------

  async create(projectId: string, input: CreateTaskInput, user: AuthenticatedUser) {
    const project = await this.projects.assertVisible(projectId, user, 'task.create');
    this.assertProjectOpen(project.status);
    await this.assertAssignable(projectId, input.assigneeId);
    await this.assertMilestoneOnProject(projectId, input.milestoneId);

    const last = await this.prisma.scoped.task.aggregate({
      where: { projectId, status: input.status, deletedAt: null },
      _max: { sortOrder: true },
    });

    const created = await this.prisma.scoped.task.create({
      data: {
        projectId,
        title: input.title,
        description: input.description ?? null,
        milestoneId: input.milestoneId ?? null,
        assigneeId: input.assigneeId ?? null,
        priority: input.priority,
        status: input.status,
        startDate: input.startDate ? d(input.startDate) : null,
        dueDate: input.dueDate ? d(input.dueDate) : null,
        estimatedHours: input.estimatedHours ?? null,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
        completedAt: input.status === 'DONE' ? new Date() : null,
        createdById: user.userId,
      } as never,
    });

    return this.findOne(created.id, user);
  }

  async update(id: string, input: UpdateTaskInput, user: AuthenticatedUser) {
    const task = await this.assertCanEdit(id, user);

    if (input.assigneeId !== undefined)
      await this.assertAssignable(task.projectId, input.assigneeId);
    if (input.milestoneId !== undefined) {
      await this.assertMilestoneOnProject(task.projectId, input.milestoneId);
    }

    // Someone who may only edit their own tasks cannot hand them to others or
    // take over another person's: reassigning is a planning action.
    if (
      input.assigneeId !== undefined &&
      input.assigneeId !== task.assigneeId &&
      this.scope.scopeFor(user, 'task.edit') === DataScope.OWN
    ) {
      throw new ForbiddenException({
        code: 'CANNOT_REASSIGN',
        message:
          'You can update your own tasks, but only a planner can change who they are assigned to.',
      });
    }

    const statusChanged = input.status !== undefined && input.status !== task.status;
    let sortOrder: number | undefined;
    if (statusChanged) {
      const last = await this.prisma.scoped.task.aggregate({
        where: { projectId: task.projectId, status: input.status, deletedAt: null },
        _max: { sortOrder: true },
      });
      sortOrder = (last._max.sortOrder ?? -1) + 1;
    }

    await this.prisma.scoped.task.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.milestoneId !== undefined ? { milestoneId: input.milestoneId } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.startDate !== undefined
          ? { startDate: input.startDate ? d(input.startDate) : null }
          : {}),
        ...(input.dueDate !== undefined
          ? { dueDate: input.dueDate ? d(input.dueDate) : null }
          : {}),
        ...(input.estimatedHours !== undefined ? { estimatedHours: input.estimatedHours } : {}),
        ...(statusChanged
          ? {
              status: input.status,
              sortOrder,
              completedAt: input.status === 'DONE' ? new Date() : null,
            }
          : {}),
      },
    });

    return this.findOne(id, user);
  }

  /**
   * Drag-and-drop. Places the card in a column, just above `beforeTaskId`, and
   * renumbers that column so the order is always a clean 0..n.
   */
  async move(id: string, input: MoveTaskInput, user: AuthenticatedUser) {
    const task = await this.assertCanEdit(id, user);

    if (input.beforeTaskId === id) {
      throw new BadRequestException({
        code: 'INVALID_MOVE',
        message: 'A task cannot go before itself.',
      });
    }

    await this.prisma.scoped.$transaction(async (tx) => {
      const column = await tx.task.findMany({
        where: {
          projectId: task.projectId,
          status: input.status,
          deletedAt: null,
          id: { not: id },
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      });

      let index = column.length;
      if (input.beforeTaskId) {
        const at = column.findIndex((t) => t.id === input.beforeTaskId);
        // A stale drop target (moved or deleted meanwhile) falls back to the bottom.
        if (at !== -1) index = at;
      }

      const ordered = [...column.map((t) => t.id)];
      ordered.splice(index, 0, id);

      const changedStatus = input.status !== task.status;
      await tx.task.update({
        where: { id },
        data: {
          status: input.status,
          sortOrder: index,
          ...(changedStatus ? { completedAt: input.status === 'DONE' ? new Date() : null } : {}),
        },
      });

      // Everything after the drop point shifts down by one.
      for (let i = index + 1; i < ordered.length; i += 1) {
        await tx.task.update({ where: { id: ordered[i] }, data: { sortOrder: i } });
      }
      for (let i = 0; i < index; i += 1) {
        await tx.task.update({ where: { id: ordered[i] }, data: { sortOrder: i } });
      }
    });

    return this.findOne(id, user);
  }

  async remove(id: string, user: AuthenticatedUser) {
    const task = await this.assertVisible(id, user, 'task.delete');
    const logged = await this.prisma.scoped.timeEntry.count({ where: { taskId: id } });
    if (logged > 0) {
      throw new BadRequestException({
        code: 'HAS_TIME',
        message: 'Time has been logged against this task. Mark it done instead of deleting it.',
      });
    }
    await this.prisma.scoped.task.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record({
      action: 'DELETE',
      entityType: 'Task',
      entityId: id,
      summary: `Deleted task "${task.title}"`,
      userId: user.userId,
    });
  }

  // -------------------------------------------------------------------------
  // Comments & attachments
  // -------------------------------------------------------------------------

  async addComment(id: string, input: TaskCommentInput, user: AuthenticatedUser) {
    await this.assertVisible(id, user, 'task.view');
    await this.prisma.scoped.taskComment.create({
      data: {
        taskId: id,
        employeeId: user.employeeId,
        body: input.body,
        createdById: user.userId,
      } as never,
    });
    return this.findOne(id, user);
  }

  async addAttachment(
    id: string,
    file: { originalName: string; mimeType: string; size: number; buffer: Buffer },
    user: AuthenticatedUser,
  ) {
    await this.assertCanEdit(id, user);

    const verdict = validateTaskAttachment({ name: file.originalName, size: file.size });
    if (!verdict.ok) {
      throw new BadRequestException({ code: 'UNSUPPORTED_FILE', message: verdict.message });
    }

    const document = await this.files.store(
      file,
      { ownerType: 'TASK', ownerId: id, category: 'Task file' },
      user,
    );
    await this.prisma.scoped.attachment.create({
      data: { documentId: document.id, taskId: id, createdById: user.userId } as never,
    });
    return this.findOne(id, user);
  }

  async removeAttachment(id: string, attachmentId: string, user: AuthenticatedUser) {
    await this.assertCanEdit(id, user);
    const attachment = await this.prisma.scoped.attachment.findFirst({
      where: { id: attachmentId, taskId: id },
    });
    if (!attachment) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Attachment not found.' });
    }
    await this.prisma.scoped.attachment.delete({ where: { id: attachmentId } });
    await this.prisma.scoped.document.update({
      where: { id: attachment.documentId },
      data: { deletedAt: new Date() },
    });
    return this.findOne(id, user);
  }

  async openAttachment(id: string, attachmentId: string, user: AuthenticatedUser) {
    await this.assertVisible(id, user, 'task.view');
    const attachment = await this.prisma.scoped.attachment.findFirst({
      where: { id: attachmentId, taskId: id },
    });
    if (!attachment) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Attachment not found.' });
    }
    return this.files.openForDownload(attachment.documentId);
  }

  // -------------------------------------------------------------------------
  // Rules
  // -------------------------------------------------------------------------

  /** 404 for a task on a project the caller cannot see. */
  private async assertVisible(id: string, user: AuthenticatedUser, permission: string) {
    const filter = await this.scope.projectFilter(user, permission);
    const task = await this.prisma.scoped.task.findFirst({
      where: { id, deletedAt: null, ...filter },
      select: { id: true, title: true, projectId: true, assigneeId: true, status: true },
    });
    if (!task) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Task not found.' });
    }
    return task;
  }

  /**
   * Edit rights. A role scoped to OWN (the Employee role) may update only the
   * tasks assigned to them — enough to move their own card across the board —
   * while a planner (PROJECT / TEAM / ALL scope) may edit any task they can see.
   */
  private async assertCanEdit(id: string, user: AuthenticatedUser) {
    const task = await this.assertVisible(id, user, 'task.edit');

    if (this.scope.scopeFor(user, 'task.edit') === DataScope.OWN) {
      if (!user.employeeId || task.assigneeId !== user.employeeId) {
        // Visible but not theirs: say so plainly rather than pretending it is missing.
        throw new ForbiddenException({
          code: 'NOT_YOUR_TASK',
          message: 'You can only change tasks that are assigned to you.',
        });
      }
    }
    const project = await this.prisma.scoped.project.findFirstOrThrow({
      where: { id: task.projectId },
      select: { status: true },
    });
    this.assertProjectOpen(project.status);
    return task;
  }

  private assertProjectOpen(status: string) {
    if (status === 'CANCELLED' || status === 'COMPLETED') {
      throw new BadRequestException({
        code: 'PROJECT_CLOSED',
        message: `This project is ${status.toLowerCase()}. Reopen it to change its tasks.`,
      });
    }
  }

  /** An assignee has to be on the team (or be the PM): work lands on people who are planned for it. */
  private async assertAssignable(projectId: string, assigneeId?: string | null) {
    if (!assigneeId) return;
    const project = await this.prisma.scoped.project.findFirstOrThrow({
      where: { id: projectId },
      select: {
        projectManagerId: true,
        members: { where: { leftOn: null }, select: { employeeId: true } },
      },
    });
    const onTeam =
      project.projectManagerId === assigneeId ||
      project.members.some((m) => m.employeeId === assigneeId);
    if (!onTeam) {
      throw new BadRequestException({
        code: 'ASSIGNEE_NOT_ON_PROJECT',
        message: 'Add that person to the project team before assigning them a task.',
        details: [{ path: 'assigneeId', message: 'Not on the project team' }],
      });
    }
  }

  private async assertMilestoneOnProject(projectId: string, milestoneId?: string | null) {
    if (!milestoneId) return;
    const found = await this.prisma.scoped.milestone.findFirst({
      where: { id: milestoneId, projectId, deletedAt: null },
      select: { id: true },
    });
    if (!found) {
      throw new BadRequestException({
        code: 'MILESTONE_NOT_ON_PROJECT',
        message: 'That milestone does not belong to this project.',
        details: [{ path: 'milestoneId', message: 'Not a milestone of this project' }],
      });
    }
  }
}
