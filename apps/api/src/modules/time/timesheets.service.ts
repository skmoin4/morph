import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  round2,
  startOfWeek,
  weekEndOf,
  type BulkTimesheetDecisionInput,
  type ReopenTimesheetInput,
  type SubmitWeekInput,
  type TimesheetDecisionInput,
  type TimesheetListQuery,
  type TimesheetStatusValue,
} from '@opsvera/shared';
import { Clock } from '../../common/clock';
import { NotifyService } from '../../common/notify/notify.service';
import { DataScopeService } from '../../common/scope/data-scope.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  computeTimesheetPostings,
  postTimesheetCost,
  reverseTimesheetCost,
  type TxClient,
} from '../cost/cost-posting.logic';
import { BudgetAlertService } from '../cost/budget-alert.service';
import { d, iso, num, TimeService } from './time.service';

const SHEET_INCLUDE = {
  employee: {
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      office: { select: { shortCode: true } },
    },
  },
} satisfies Prisma.TimesheetInclude;

type SheetRow = Prisma.TimesheetGetPayload<{ include: typeof SHEET_INCLUDE }>;

/**
 * Submitting a week, deciding on it, and correcting it afterwards.
 *
 * Approval is where time becomes money: inside one transaction the entries are
 * locked and the labour cost is posted to the ledger at the rate effective on
 * each work date. Reopening reverses that posting; approving again posts the
 * next version. The ledger is append-only, so every figure stays explainable.
 */
@Injectable()
export class TimesheetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: DataScopeService,
    private readonly notify: NotifyService,
    private readonly time: TimeService,
    private readonly clock: Clock,
    private readonly budget: BudgetAlertService,
  ) {}

  /** The projects a timesheet's hours were on. */
  private async projectsOf(timesheetId: string): Promise<string[]> {
    const rows = await this.prisma.scoped.timeEntry.findMany({
      where: { timesheetId, deletedAt: null },
      select: { projectId: true },
      distinct: ['projectId'],
    });
    return rows.map((r) => r.projectId);
  }

  private notFound() {
    return new NotFoundException({ code: 'NOT_FOUND', message: 'Timesheet not found.' });
  }

  // -------------------------------------------------------------------------
  // Submit and recall
  // -------------------------------------------------------------------------

  async submit(input: SubmitWeekInput, user: AuthenticatedUser) {
    const employee = await this.time.me(user);
    const weekStart = input.weekStart;
    if (weekStart > startOfWeek(this.time.today(employee))) {
      throw this.time.invalid('weekStart', 'That week has not started yet.');
    }

    const sheet = await this.prisma.scoped.$transaction(async (tx) => {
      await this.time.lock(tx, employee.id);
      const found = await tx.timesheet.findFirst({
        where: { employeeId: employee.id, weekStartDate: d(weekStart) },
      });
      if (!found) {
        throw new BadRequestException({
          code: 'EMPTY_TIMESHEET',
          message: 'There is no time logged that week.',
        });
      }
      this.time.assertEditable(found);

      const running = await tx.timeEntry.findFirst({
        where: {
          employeeId: employee.id,
          source: 'TIMER',
          endedAt: null,
          deletedAt: null,
          workDate: { gte: d(weekStart), lte: d(weekEndOf(weekStart)) },
        },
      });
      if (running) {
        throw new ConflictException({
          code: 'TIMER_RUNNING',
          message: 'A timer is still running for that week. Stop it before submitting.',
        });
      }

      const entries = await tx.timeEntry.findMany({
        where: { timesheetId: found.id, deletedAt: null },
        select: { hours: true, isBillable: true },
      });
      const total = entries.reduce((a, e) => a + num(e.hours), 0);
      if (entries.length === 0 || total <= 0) {
        throw new BadRequestException({
          code: 'EMPTY_TIMESHEET',
          message: 'There is no time logged that week.',
        });
      }
      const billable = entries.filter((e) => e.isBillable).reduce((a, e) => a + num(e.hours), 0);

      return tx.timesheet.update({
        where: { id: found.id },
        data: {
          status: 'SUBMITTED',
          submittedAt: this.clock.now(),
          totalHours: round2(total),
          billableHours: round2(billable),
        },
      });
    });

    await this.audit.record({
      action: 'UPDATE',
      entityType: 'Timesheet',
      entityId: sheet.id,
      summary: `${employee.employeeCode} submitted the timesheet for ${weekStart} (${num(sheet.totalHours)} h)`,
      userId: user.userId,
    });
    await this.notify.toApprovers('timesheet.approve', employee.id, 'TIMESHEET_SUBMITTED', {
      title: `${employee.firstName} ${employee.lastName} submitted a timesheet`,
      body: `Week of ${weekStart} · ${num(sheet.totalHours)} hours`,
      linkUrl: '/timesheets?tab=approvals',
      entityType: 'Timesheet',
      entityId: sheet.id,
    });
    return this.one(sheet.id, user);
  }

  /** Takes a submitted week back to a draft, before anyone has decided on it. */
  async recall(id: string, user: AuthenticatedUser) {
    const employee = await this.time.me(user);
    const sheet = await this.prisma.scoped.$transaction(async (tx) => {
      await this.time.lock(tx, employee.id);
      const found = await tx.timesheet.findFirst({ where: { id } });
      if (!found || found.employeeId !== employee.id) throw this.notFound();
      if (found.status !== 'SUBMITTED') {
        throw new ConflictException({
          code: 'NOT_SUBMITTED',
          message: 'Only a submitted week that is still waiting can be withdrawn.',
        });
      }
      return tx.timesheet.update({
        where: { id },
        data: { status: 'DRAFT', submittedAt: null },
      });
    });
    await this.audit.record({
      action: 'UPDATE',
      entityType: 'Timesheet',
      entityId: id,
      summary: `${employee.employeeCode} withdrew the timesheet for ${iso(sheet.weekStartDate)}`,
      userId: user.userId,
    });
    return this.one(id, user);
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  private async scopes(user: AuthenticatedUser) {
    const approvable = user.permissions.has('timesheet.approve')
      ? await this.scope.visibleEmployeeIds(user, this.scope.scopeFor(user, 'timesheet.approve'))
      : [];
    const viewable = user.permissions.has('timesheet.view')
      ? await this.scope.visibleEmployeeIds(user, this.scope.scopeFor(user, 'timesheet.view'))
      : [];
    const mine = user.employeeId ? [user.employeeId] : [];
    const allowed =
      approvable === null || viewable === null
        ? null
        : [...new Set([...mine, ...viewable, ...approvable])];
    return { approvable, viewable, allowed };
  }

  async list(query: TimesheetListQuery, user: AuthenticatedUser) {
    const { approvable, allowed } = await this.scopes(user);

    const wanted = query.mine ? (user.employeeId ?? '__none__') : query.employeeId;
    const employeeFilter: Prisma.TimesheetWhereInput['employeeId'] = wanted
      ? allowed === null || allowed.includes(wanted)
        ? wanted
        : '__none__'
      : allowed === null
        ? undefined
        : { in: allowed };

    const and: Prisma.TimesheetWhereInput[] = [];
    if (employeeFilter !== undefined) and.push({ employeeId: employeeFilter });
    if (query.status) and.push({ status: query.status });
    if (query.weekStart) and.push({ weekStartDate: d(startOfWeek(query.weekStart)) });
    if (query.toDecide) {
      and.push({ status: 'SUBMITTED' });
      if (!user.permissions.has('timesheet.approve')) and.push({ id: '__none__' });
      if (approvable !== null) {
        and.push({ employeeId: { in: approvable.filter((e) => e !== user.employeeId) } });
      }
      if (user.employeeId) and.push({ NOT: { employeeId: user.employeeId } });
    }
    const where: Prisma.TimesheetWhereInput = and.length ? { AND: and } : {};

    const [rows, total] = await Promise.all([
      this.prisma.scoped.timesheet.findMany({
        where,
        include: SHEET_INCLUDE,
        orderBy: [{ weekStartDate: 'desc' }, { submittedAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.scoped.timesheet.count({ where }),
    ]);

    // Which projects the hours went to, for a quick look before opening a sheet.
    const byProject = rows.length
      ? await this.prisma.scoped.timeEntry.groupBy({
          by: ['timesheetId', 'projectId'],
          where: { timesheetId: { in: rows.map((r) => r.id) }, deletedAt: null },
          _sum: { hours: true },
        })
      : [];
    const projects = byProject.length
      ? await this.prisma.scoped.project.findMany({
          where: { id: { in: [...new Set(byProject.map((b) => b.projectId))] } },
          select: { id: true, projectCode: true },
        })
      : [];
    const code = new Map(projects.map((p) => [p.id, p.projectCode]));
    const breakdown = new Map<string, Array<{ code: string; hours: number }>>();
    for (const b of byProject) {
      const list = breakdown.get(b.timesheetId!) ?? [];
      list.push({ code: code.get(b.projectId) ?? '—', hours: num(b._sum.hours) });
      breakdown.set(b.timesheetId!, list);
    }

    const approvableSet = approvable === null ? null : new Set(approvable);
    return {
      data: rows.map((r) =>
        this.shape(
          r,
          user,
          approvableSet,
          breakdown.get(r.id)?.sort((a, b) => b.hours - a.hours),
        ),
      ),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  private async one(id: string, user: AuthenticatedUser) {
    const row = await this.prisma.scoped.timesheet.findFirst({
      where: { id },
      include: SHEET_INCLUDE,
    });
    if (!row) throw this.notFound();
    const { approvable } = await this.scopes(user);
    return this.shape(row, user, approvable === null ? null : new Set(approvable));
  }

  private shape(
    row: SheetRow,
    user: AuthenticatedUser,
    approvable: Set<string> | null,
    projects?: Array<{ code: string; hours: number }>,
  ) {
    const owner = row.employeeId === user.employeeId;
    const inApproveScope =
      user.permissions.has('timesheet.approve') &&
      (approvable === null || approvable.has(row.employeeId));
    return {
      id: row.id,
      status: row.status as TimesheetStatusValue,
      weekStart: iso(row.weekStartDate),
      weekEnd: iso(row.weekEndDate),
      totalHours: num(row.totalHours),
      billableHours: num(row.billableHours),
      submittedAt: row.submittedAt?.toISOString() ?? null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      reopenedAt: row.reopenedAt?.toISOString() ?? null,
      reopenReason: row.reopenReason,
      employee: {
        id: row.employee.id,
        employeeCode: row.employee.employeeCode,
        fullName: `${row.employee.firstName} ${row.employee.lastName}`,
        office: row.employee.office.shortCode,
      },
      projects: projects ?? [],
      isMine: owner,
      canDecide: row.status === 'SUBMITTED' && inApproveScope && !owner,
      canReopen: row.status === 'APPROVED' && user.permissions.has('timesheet.reopen') && !owner,
    };
  }

  // -------------------------------------------------------------------------
  // Decide
  // -------------------------------------------------------------------------

  async decide(id: string, input: TimesheetDecisionInput, user: AuthenticatedUser) {
    const found = await this.prisma.scoped.timesheet.findFirst({
      where: { id },
      include: SHEET_INCLUDE,
    });
    if (!found) throw this.notFound();

    // Outside your approval scope the sheet does not exist for you.
    const approvable = await this.scope.visibleEmployeeIds(
      user,
      this.scope.scopeFor(user, 'timesheet.approve'),
    );
    if (approvable !== null && !approvable.includes(found.employeeId)) throw this.notFound();
    if (found.employeeId === user.employeeId) {
      throw new ForbiddenException({
        code: 'SELF_APPROVAL',
        message: 'You cannot decide your own timesheet. Someone else has to.',
      });
    }

    const week = iso(found.weekStartDate);
    const label = `${found.employee.employeeCode} week of ${week}`;
    const now = this.clock.now();

    await this.prisma.scoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM timesheets WHERE id = ${id} FOR UPDATE`;
      const sheet = await tx.timesheet.findFirstOrThrow({ where: { id } });
      if (sheet.status !== 'SUBMITTED') {
        throw new ConflictException({
          code: 'NOT_PENDING',
          message: 'That timesheet has already been decided, or was withdrawn.',
        });
      }

      if (input.decision === 'REJECTED') {
        await tx.timesheet.update({
          where: { id },
          data: { status: 'REJECTED', rejectedAt: now },
        });
        await tx.timesheetApproval.create({
          data: {
            timesheetId: id,
            approverId: user.userId,
            status: 'REJECTED',
            comment: input.comment ?? null,
            decidedAt: now,
          } as never,
        });
        return;
      }

      const entries = await tx.timeEntry.findMany({
        where: { timesheetId: id, deletedAt: null },
        select: { projectId: true, workDate: true, hours: true },
      });
      const rates = await tx.employeeCostRate.findMany({
        where: { employeeId: found.employeeId },
        select: { hourlyRate: true, effectiveFrom: true },
      });
      let postings;
      try {
        postings = computeTimesheetPostings(entries, rates);
      } catch (error) {
        // An unrated day cannot be costed; approving anyway would hide the cost.
        throw new ConflictException({
          code: 'NO_COST_RATE',
          message: `${(error as Error).message} Add a cost rate for ${found.employee.firstName} ${found.employee.lastName} first.`,
        });
      }

      await tx.timeEntry.updateMany({ where: { timesheetId: id }, data: { isLocked: true } });
      await postTimesheetCost(tx as unknown as TxClient, {
        companyId: user.companyId,
        timesheetId: id,
        employeeId: found.employeeId,
        postingDate: sheet.weekEndDate,
        postings,
        createdById: user.userId,
        description: `Approved timesheet ${week} to ${iso(sheet.weekEndDate)}`,
      });
      await tx.timesheet.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedAt: now,
          approvedById: user.userId,
          costPostedAt: now,
          reopenedAt: null,
          reopenReason: null,
        },
      });
      await tx.timesheetApproval.create({
        data: {
          timesheetId: id,
          approverId: user.userId,
          status: 'APPROVED',
          comment: input.comment ?? null,
          decidedAt: now,
        } as never,
      });
    });

    if (input.decision === 'APPROVED') await this.budget.evaluate(await this.projectsOf(id));
    await this.audit.record({
      action: input.decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
      entityType: 'Timesheet',
      entityId: id,
      summary:
        input.decision === 'APPROVED'
          ? `Approved the timesheet for ${label}; labour cost posted`
          : `Rejected the timesheet for ${label}: ${input.comment}`,
      userId: user.userId,
    });
    await this.notify.toEmployee(
      found.employeeId,
      input.decision === 'APPROVED' ? 'TIMESHEET_APPROVED' : 'TIMESHEET_REJECTED',
      {
        title:
          input.decision === 'APPROVED'
            ? `Your timesheet for the week of ${week} was approved`
            : `Your timesheet for the week of ${week} was sent back`,
        body: input.comment ?? undefined,
        linkUrl: `/timesheets?week=${week}`,
        entityType: 'Timesheet',
        entityId: id,
      },
    );
    return this.one(id, user);
  }

  /** Decides many at once. Each is its own transaction: one failing does not stop the rest. */
  async bulkDecide(input: BulkTimesheetDecisionInput, user: AuthenticatedUser) {
    const results: Array<{ id: string; ok: boolean; code?: string; message?: string }> = [];
    for (const id of input.ids) {
      try {
        await this.decide(id, { decision: input.decision, comment: input.comment }, user);
        results.push({ id, ok: true });
      } catch (error) {
        const body = (error as { getResponse?: () => unknown }).getResponse?.() as
          { code?: string; message?: string } | undefined;
        results.push({
          id,
          ok: false,
          code: body?.code ?? 'ERROR',
          message: body?.message ?? 'Could not decide.',
        });
      }
    }
    return {
      results,
      done: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };
  }

  // -------------------------------------------------------------------------
  // Reopen
  // -------------------------------------------------------------------------

  /**
   * Takes an approved week back for correction. Its cost posting is reversed on
   * the ledger, the entries unlock, and the owner edits and resubmits; the next
   * approval posts the next version.
   */
  async reopen(id: string, input: ReopenTimesheetInput, user: AuthenticatedUser) {
    const found = await this.prisma.scoped.timesheet.findFirst({
      where: { id },
      include: SHEET_INCLUDE,
    });
    if (!found) throw this.notFound();
    const reach = await this.scope.visibleEmployeeIds(
      user,
      this.scope.scopeFor(user, 'timesheet.reopen'),
    );
    if (reach !== null && !reach.includes(found.employeeId)) throw this.notFound();
    if (found.employeeId === user.employeeId) {
      throw new ForbiddenException({
        code: 'SELF_APPROVAL',
        message: 'You cannot reopen your own timesheet. Someone else has to.',
      });
    }

    const now = this.clock.now();
    const week = iso(found.weekStartDate);
    const reversed = await this.prisma.scoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM timesheets WHERE id = ${id} FOR UPDATE`;
      const sheet = await tx.timesheet.findFirstOrThrow({ where: { id } });
      if (sheet.status !== 'APPROVED') {
        throw new ConflictException({
          code: 'NOT_APPROVED',
          message: 'Only an approved timesheet can be reopened.',
        });
      }
      const result = await reverseTimesheetCost(tx as unknown as TxClient, {
        companyId: user.companyId,
        timesheetId: id,
        reason: input.reason,
        createdById: user.userId,
      });
      await tx.timeEntry.updateMany({ where: { timesheetId: id }, data: { isLocked: false } });
      await tx.timesheet.update({
        where: { id },
        data: {
          status: 'REOPENED',
          reopenedAt: now,
          reopenReason: input.reason,
          costPostedAt: null,
          approvedAt: null,
          approvedById: null,
        },
      });
      return result;
    });

    await this.budget.evaluate(await this.projectsOf(id));
    await this.audit.record({
      action: 'REOPEN',
      entityType: 'Timesheet',
      entityId: id,
      summary: `Reopened the approved timesheet for ${found.employee.employeeCode}, week of ${week}; ${reversed.rows} cost posting(s) reversed`,
      reason: input.reason,
      userId: user.userId,
    });
    await this.notify.toEmployee(found.employeeId, 'TIMESHEET_REJECTED', {
      title: `Your approved timesheet for the week of ${week} was reopened`,
      body: input.reason,
      linkUrl: `/timesheets?week=${week}`,
      entityType: 'Timesheet',
      entityId: id,
    });
    return this.one(id, user);
  }
}
