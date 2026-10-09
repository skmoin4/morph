import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  addDays,
  approvalCompletes,
  availableDays,
  carryForwardAmount,
  closingDays,
  countLeaveDays,
  eachDate,
  LEAVE_ADVANCE_DAYS,
  LEAVE_BACKDATE_DAYS,
  leaveYearOf,
  nextLeaveStage,
  openingForYear,
  round2,
  toOfficeDateString,
  type BalanceFigures,
  type LeaveBalanceQuery,
  type LeaveCalendarQuery,
  type LeaveCancelInput,
  type LeaveDecisionInput,
  type LeaveFlow,
  type LeaveListQuery,
  type LeavePreviewInput,
  type LeaveRequestInput,
} from '@opsvera/shared';
import { Clock } from '../../common/clock';
import { NotifyService } from '../../common/notify/notify.service';
import { DataScopeService } from '../../common/scope/data-scope.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService, type ScopedDb } from '../../prisma/prisma.service';
import { AttendanceContextLoader } from '../attendance/attendance-context';
import { AttendanceService } from '../attendance/attendance.service';
import { AuditService } from '../audit/audit.service';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);
const num = (value: Prisma.Decimal | number | string | null | undefined) => Number(value ?? 0);

/** Longest range the team calendar will answer in one go. */
const MAX_CALENDAR_DAYS = 70;

type TypeRow = {
  id: string;
  name: string;
  shortCode: string;
  yearlyQuota: Prisma.Decimal;
  carryForward: boolean;
  maxCarryForward: Prisma.Decimal | null;
  allowHalfDay: boolean;
  isPaid: boolean;
  approvalFlow: LeaveFlow;
  colorToken: string | null;
  isActive: boolean;
};

type EmployeeRow = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  officeId: string;
  departmentId: string | null;
  joiningDate: Date;
  exitDate: Date | null;
  office: { timezone: string; shortCode: string };
};

type Db = ScopedDb;

/**
 * Leave: balances, applying, the one- or two-level approval, and what an
 * approval does to attendance.
 *
 * Money-like care is taken with balances: every change that moves days between
 * `pending`, `used` and available happens inside a transaction that first locks
 * the request (or the employee), so two approvers clicking at once, or a double
 * tap on Apply, cannot count a day twice.
 */
@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: DataScopeService,
    private readonly attendance: AttendanceService,
    private readonly loader: AttendanceContextLoader,
    private readonly clock: Clock,
    private readonly notify: NotifyService,
  ) {}

  // -------------------------------------------------------------------------
  // Lookups
  // -------------------------------------------------------------------------

  async types() {
    const rows = await this.prisma.scoped.leaveType.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: [{ name: 'asc' }],
    });
    return rows.map((t) => this.shapeType(t as unknown as TypeRow));
  }

  private shapeType(t: TypeRow) {
    return {
      id: t.id,
      name: t.name,
      shortCode: t.shortCode,
      colorToken: t.colorToken,
      isPaid: t.isPaid,
      allowHalfDay: t.allowHalfDay,
      approvalFlow: t.approvalFlow,
      yearlyQuota: num(t.yearlyQuota),
    };
  }

  // -------------------------------------------------------------------------
  // Balances
  // -------------------------------------------------------------------------

  /**
   * The figures a balance has — or would have, if its row were created now.
   * Reading never writes: the row appears when the first request is made.
   */
  private figures(
    type: TypeRow,
    employee: Pick<EmployeeRow, 'joiningDate'>,
    year: number,
    row: BalanceFigures | null,
    previous: BalanceFigures | null,
  ): BalanceFigures {
    if (row) return row;
    const carried =
      previous && type.carryForward
        ? carryForwardAmount(
            closingDays(previous),
            true,
            type.maxCarryForward === null ? null : num(type.maxCarryForward),
          )
        : 0;
    return {
      opening: openingForYear(num(type.yearlyQuota), iso(employee.joiningDate), year),
      accrued: 0,
      carriedForward: carried,
      used: 0,
      pending: 0,
    };
  }

  private toFigures(row: {
    opening: Prisma.Decimal;
    accrued: Prisma.Decimal;
    carriedForward: Prisma.Decimal;
    used: Prisma.Decimal;
    pending: Prisma.Decimal;
  }): BalanceFigures {
    return {
      opening: num(row.opening),
      accrued: num(row.accrued),
      carriedForward: num(row.carriedForward),
      used: num(row.used),
      pending: num(row.pending),
    };
  }

  private shapeBalance(type: TypeRow, year: number, b: BalanceFigures) {
    return {
      leaveType: this.shapeType(type),
      year,
      ...b,
      available: availableDays(b),
    };
  }

  /** The year's balance row for a person and type, created on first use. */
  private async ensureBalance(
    tx: Db,
    type: TypeRow,
    employee: EmployeeRow,
    year: number,
  ): Promise<{ id: string; figures: BalanceFigures }> {
    const key = { employeeId: employee.id, leaveTypeId: type.id, year };
    const found = await tx.leaveBalance.findFirst({ where: key });
    if (found) return { id: found.id, figures: this.toFigures(found) };

    const prev = await tx.leaveBalance.findFirst({ where: { ...key, year: year - 1 } });
    const start = this.figures(type, employee, year, null, prev ? this.toFigures(prev) : null);
    try {
      const created = await tx.leaveBalance.create({
        data: {
          ...key,
          opening: start.opening,
          accrued: 0,
          carriedForward: start.carriedForward,
          used: 0,
          pending: 0,
        } as never,
      });
      return { id: created.id, figures: this.toFigures(created) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const again = await tx.leaveBalance.findFirstOrThrow({ where: key });
        return { id: again.id, figures: this.toFigures(again) };
      }
      throw error;
    }
  }

  async balances(query: LeaveBalanceQuery, user: AuthenticatedUser) {
    const employee = await this.visibleEmployee(
      query.employeeId ?? user.employeeId,
      user,
      'leave.view',
    );
    const year =
      query.year ?? leaveYearOf(toOfficeDateString(this.clock.now(), employee.office.timezone));
    const [types, rows] = await Promise.all([
      this.prisma.scoped.leaveType.findMany({
        where: { isActive: true, deletedAt: null },
        orderBy: [{ name: 'asc' }],
      }),
      this.prisma.scoped.leaveBalance.findMany({
        where: { employeeId: employee.id, year: { in: [year, year - 1] } },
      }),
    ]);
    const at = (typeId: string, y: number) =>
      rows.find((r) => r.leaveTypeId === typeId && r.year === y);

    return {
      employee: this.shapeEmployee(employee),
      year,
      balances: types.map((t) => {
        const type = t as unknown as TypeRow;
        const row = at(t.id, year);
        const prev = at(t.id, year - 1);
        return this.shapeBalance(
          type,
          year,
          this.figures(
            type,
            employee,
            year,
            row ? this.toFigures(row) : null,
            prev ? this.toFigures(prev) : null,
          ),
        );
      }),
    };
  }

  /** Everyone in the caller's scope, one row each, for the HR balances table. */
  async teamBalances(
    query: { year?: number; officeId?: string; departmentId?: string; q?: string },
    user: AuthenticatedUser,
  ) {
    const ids = await this.scope.visibleEmployeeIds(user, this.scope.scopeFor(user, 'leave.view'));
    const where: Prisma.EmployeeWhereInput = {
      deletedAt: null,
      status: { in: ['ACTIVE', 'NOTICE_PERIOD'] },
      ...(ids === null ? {} : { id: { in: ids } }),
      ...(query.officeId ? { officeId: query.officeId } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.q
        ? {
            OR: [
              { firstName: { contains: query.q } },
              { lastName: { contains: query.q } },
              { employeeCode: { contains: query.q } },
            ],
          }
        : {}),
    };
    const employees = (await this.prisma.scoped.employee.findMany({
      where,
      include: { office: { select: { timezone: true, shortCode: true } } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    })) as unknown as EmployeeRow[];

    const year =
      query.year ??
      leaveYearOf(toOfficeDateString(this.clock.now(), employees[0]?.office.timezone ?? 'UTC'));
    const [types, rows] = await Promise.all([
      this.prisma.scoped.leaveType.findMany({
        where: { isActive: true, deletedAt: null },
        orderBy: [{ name: 'asc' }],
      }),
      this.prisma.scoped.leaveBalance.findMany({
        where: { employeeId: { in: employees.map((e) => e.id) }, year: { in: [year, year - 1] } },
      }),
    ]);
    const byKey = new Map(rows.map((r) => [`${r.employeeId}|${r.leaveTypeId}|${r.year}`, r]));

    return {
      year,
      types: types.map((t) => this.shapeType(t as unknown as TypeRow)),
      data: employees.map((employee) => ({
        employee: this.shapeEmployee(employee),
        balances: types.map((t) => {
          const type = t as unknown as TypeRow;
          const row = byKey.get(`${employee.id}|${t.id}|${year}`);
          const prev = byKey.get(`${employee.id}|${t.id}|${year - 1}`);
          return this.shapeBalance(
            type,
            year,
            this.figures(
              type,
              employee,
              year,
              row ? this.toFigures(row) : null,
              prev ? this.toFigures(prev) : null,
            ),
          );
        }),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Preview and apply
  // -------------------------------------------------------------------------

  async preview(input: LeavePreviewInput, user: AuthenticatedUser) {
    const employee = await this.applicant(input.employeeId, user);
    const type = await this.activeType(input.leaveTypeId);
    const plan = await this.plan(employee, type, input);
    const year = leaveYearOf(input.fromDate);

    const [row, prev, overlap] = await Promise.all([
      this.prisma.scoped.leaveBalance.findFirst({
        where: { employeeId: employee.id, leaveTypeId: type.id, year },
      }),
      this.prisma.scoped.leaveBalance.findFirst({
        where: { employeeId: employee.id, leaveTypeId: type.id, year: year - 1 },
      }),
      this.findOverlap(this.prisma.scoped, employee.id, input.fromDate, input.toDate),
    ]);
    const before = this.figures(
      type,
      employee,
      year,
      row ? this.toFigures(row) : null,
      prev ? this.toFigures(prev) : null,
    );
    const available = availableDays(before);

    return {
      leaveType: this.shapeType(type),
      totalDays: plan.totalDays,
      workingDates: plan.workingDates,
      skipped: plan.skipped,
      balance: {
        year,
        available,
        afterRequest: round2(available - plan.totalDays),
        /** Unpaid types are not limited by a quota. */
        enforced: type.isPaid,
      },
      enoughBalance: !type.isPaid || available >= plan.totalDays,
      overlap: overlap
        ? {
            id: overlap.id,
            from: iso(overlap.fromDate),
            to: iso(overlap.toDate),
            status: overlap.status,
          }
        : null,
    };
  }

  async apply(input: LeaveRequestInput, user: AuthenticatedUser) {
    const employee = await this.applicant(input.employeeId, user);
    const type = await this.activeType(input.leaveTypeId);
    const plan = await this.plan(employee, type, input);
    const year = leaveYearOf(input.fromDate);

    const created = await this.prisma.scoped.$transaction(async (tx) => {
      // One application at a time per person: without the lock, a double tap
      // would pass the overlap and balance checks twice.
      await tx.$queryRaw`SELECT id FROM employees WHERE id = ${employee.id} FOR UPDATE`;

      const overlap = await this.findOverlap(tx, employee.id, input.fromDate, input.toDate);
      if (overlap) {
        throw new ConflictException({
          code: 'LEAVE_OVERLAP',
          message: `That overlaps a ${overlap.status === 'APPROVED' ? 'approved' : 'pending'} leave from ${iso(overlap.fromDate)} to ${iso(overlap.toDate)}.`,
        });
      }

      const balance = await this.ensureBalance(tx, type, employee, year);
      const available = availableDays(balance.figures);
      if (type.isPaid && available < plan.totalDays) {
        throw new ConflictException({
          code: 'INSUFFICIENT_BALANCE',
          message: `Only ${available} day${available === 1 ? '' : 's'} of ${type.name} left; this needs ${plan.totalDays}. Use an unpaid type for the rest.`,
        });
      }

      const request = await tx.leaveRequest.create({
        data: {
          employeeId: employee.id,
          leaveTypeId: type.id,
          fromDate: d(input.fromDate),
          toDate: d(input.toDate),
          dayPart: input.dayPart,
          totalDays: plan.totalDays,
          reason: input.reason,
          status: 'PENDING',
          createdById: user.userId,
        } as never,
      });
      await tx.leaveBalance.update({
        where: { id: balance.id },
        data: { pending: { increment: plan.totalDays } },
      });
      return request;
    });

    await this.audit.record({
      action: 'CREATE',
      entityType: 'LeaveRequest',
      entityId: created.id,
      summary: `${employee.employeeCode} applied for ${plan.totalDays} day(s) of ${type.name}, ${input.fromDate} to ${input.toDate}`,
      userId: user.userId,
    });
    await this.notifyApprovers(employee, {
      title: `${employee.firstName} ${employee.lastName} applied for ${plan.totalDays} day${plan.totalDays === 1 ? '' : 's'} of ${type.name}`,
      body: `${input.fromDate} to ${input.toDate}. ${input.reason}`,
      entityId: created.id,
    });
    return this.get(created.id, user);
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async list(query: LeaveListQuery, user: AuthenticatedUser) {
    const approvable = user.permissions.has('leave.approve')
      ? await this.scope.visibleEmployeeIds(user, this.scope.scopeFor(user, 'leave.approve'))
      : [];
    const viewable = user.permissions.has('leave.view')
      ? await this.scope.visibleEmployeeIds(user, this.scope.scopeFor(user, 'leave.view'))
      : [];
    const mine = user.employeeId ? [user.employeeId] : [];

    // What the caller may see: their own, what they can view, what they decide.
    const allowed =
      approvable === null || viewable === null
        ? null
        : [...new Set([...mine, ...viewable, ...approvable])];

    const wanted = query.mine ? (user.employeeId ?? '__none__') : query.employeeId;
    const employeeFilter: Prisma.LeaveRequestWhereInput['employeeId'] = wanted
      ? allowed === null || allowed.includes(wanted)
        ? wanted
        : '__none__'
      : allowed === null
        ? undefined
        : { in: allowed };

    const and: Prisma.LeaveRequestWhereInput[] = [];
    if (employeeFilter !== undefined) and.push({ employeeId: employeeFilter });
    if (query.status) and.push({ status: query.status });
    if (query.leaveTypeId) and.push({ leaveTypeId: query.leaveTypeId });
    if (query.from) and.push({ toDate: { gte: d(query.from) } });
    if (query.to) and.push({ fromDate: { lte: d(query.to) } });
    if (query.toDecide) {
      // Waiting, in the caller's approval scope, not their own, and — for the
      // second level — not something they already passed on at the first.
      and.push({ status: 'PENDING' });
      and.push(
        approvable === null
          ? {}
          : { employeeId: { in: approvable.filter((id) => id !== user.employeeId) } },
      );
      if (user.employeeId) {
        and.push({ NOT: { employeeId: user.employeeId } });
        and.push({
          OR: [{ level1ApproverId: null }, { level1ApproverId: { not: user.employeeId } }],
        });
      }
      if (!user.permissions.has('leave.approve')) and.push({ id: '__none__' });
    }
    const where: Prisma.LeaveRequestWhereInput = and.length ? { AND: and } : {};

    const [rows, total] = await Promise.all([
      this.prisma.scoped.leaveRequest.findMany({
        where,
        include: this.requestInclude,
        orderBy: [{ fromDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.scoped.leaveRequest.count({ where }),
    ]);

    const names = await this.approverNames(rows);
    const approvableSet = approvable === null ? null : new Set(approvable);
    return {
      data: rows.map((row) => this.shape(row as unknown as RequestRow, names, user, approvableSet)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async get(id: string, user: AuthenticatedUser) {
    const row = await this.prisma.scoped.leaveRequest.findFirst({
      where: { id },
      include: this.requestInclude,
    });
    if (!row) throw this.notFound();
    const view = await this.canSee(row.employeeId, user);
    if (!view) throw this.notFound();

    const approvable = user.permissions.has('leave.approve')
      ? await this.scope.visibleEmployeeIds(user, this.scope.scopeFor(user, 'leave.approve'))
      : [];
    const names = await this.approverNames([row]);
    return this.shape(
      row as unknown as RequestRow,
      names,
      user,
      approvable === null ? null : new Set(approvable),
    );
  }

  /** Who is off when, for a window, within the caller's reach. */
  async calendar(query: LeaveCalendarQuery, user: AuthenticatedUser) {
    const days = eachDate(query.from, query.to).length;
    if (days < 1 || days > MAX_CALENDAR_DAYS) {
      throw new BadRequestException({
        code: 'RANGE_TOO_LONG',
        message: `Ask for between 1 and ${MAX_CALENDAR_DAYS} days at a time.`,
      });
    }
    const viewable = await this.scope.visibleEmployeeIds(
      user,
      this.scope.scopeFor(user, 'leave.view'),
    );
    const mine = user.employeeId ? [user.employeeId] : [];
    const people = viewable === null ? null : [...new Set([...mine, ...viewable])];

    const rows = await this.prisma.scoped.leaveRequest.findMany({
      where: {
        status: { in: ['APPROVED', 'PENDING'] },
        fromDate: { lte: d(query.to) },
        toDate: { gte: d(query.from) },
        ...(people === null ? {} : { employeeId: { in: people } }),
        employee: {
          deletedAt: null,
          ...(query.officeId ? { officeId: query.officeId } : {}),
          ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        },
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            office: { select: { shortCode: true } },
          },
        },
        leaveType: { select: { id: true, name: true, shortCode: true, colorToken: true } },
      },
      orderBy: [{ fromDate: 'asc' }],
    });

    const holidays = await this.prisma.scoped.holiday.findMany({
      where: {
        date: { gte: d(query.from), lte: d(query.to) },
        ...(query.officeId ? { OR: [{ officeId: null }, { officeId: query.officeId }] } : {}),
      },
      orderBy: [{ date: 'asc' }],
    });

    return {
      from: query.from,
      to: query.to,
      leaves: rows.map((r) => ({
        id: r.id,
        status: r.status,
        fromDate: iso(r.fromDate),
        toDate: iso(r.toDate),
        dayPart: r.dayPart,
        totalDays: num(r.totalDays),
        employee: {
          id: r.employee.id,
          employeeCode: r.employee.employeeCode,
          fullName: `${r.employee.firstName} ${r.employee.lastName}`,
          office: r.employee.office.shortCode,
        },
        leaveType: r.leaveType,
      })),
      holidays: holidays.map((h) => ({
        id: h.id,
        date: iso(h.date),
        name: h.name,
        officeId: h.officeId,
        isOptional: h.isOptional,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Decide
  // -------------------------------------------------------------------------

  async decide(id: string, input: LeaveDecisionInput, user: AuthenticatedUser) {
    const found = await this.prisma.scoped.leaveRequest.findFirst({
      where: { id },
      include: {
        employee: { include: { office: { select: { timezone: true, shortCode: true } } } },
        leaveType: true,
      },
    });
    if (!found) throw this.notFound();

    // Outside your approval scope the request does not exist for you.
    const approvable = await this.scope.visibleEmployeeIds(
      user,
      this.scope.scopeFor(user, 'leave.approve'),
    );
    if (approvable !== null && !approvable.includes(found.employeeId)) throw this.notFound();
    if (found.employeeId === user.employeeId) {
      throw new ForbiddenException({
        code: 'SELF_APPROVAL',
        message: 'You cannot decide your own leave. Someone else has to.',
      });
    }
    if (!user.employeeId) {
      throw new ForbiddenException({
        code: 'NO_EMPLOYEE_PROFILE',
        message: 'Your login is not linked to an employee record, so you cannot approve leave.',
      });
    }
    const approverId = user.employeeId;
    const seesEveryone = approvable === null;
    const type = found.leaveType as unknown as TypeRow;
    const employee = found.employee as unknown as EmployeeRow;
    const year = leaveYearOf(iso(found.fromDate));
    const days = num(found.totalDays);
    const now = this.clock.now();

    const outcome = await this.prisma.scoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM leave_requests WHERE id = ${id} FOR UPDATE`;
      const request = await tx.leaveRequest.findFirstOrThrow({ where: { id } });
      if (request.status !== 'PENDING') {
        throw new ConflictException({
          code: 'NOT_PENDING',
          message: 'That request has already been decided or cancelled.',
        });
      }

      const flow = type.approvalFlow;
      const stage = nextLeaveStage(flow, request.level1ApproverId !== null);
      if (stage === 2 && request.level1ApproverId === approverId) {
        throw new ForbiddenException({
          code: 'SAME_APPROVER',
          message: 'You approved the first level. The second level needs someone else.',
        });
      }
      const stageData = (note: string | null | undefined) =>
        stage === 1
          ? { level1ApproverId: approverId, level1DecidedAt: now, level1Note: note ?? null }
          : { level2ApproverId: approverId, level2DecidedAt: now, level2Note: note ?? null };

      const balance = await this.ensureBalance(tx, type, employee, year);

      if (input.decision === 'REJECTED') {
        await tx.leaveRequest.update({
          where: { id },
          data: { status: 'REJECTED', decidedAt: now, ...stageData(input.note) },
        });
        await tx.leaveBalance.update({
          where: { id: balance.id },
          data: { pending: { decrement: days } },
        });
        return 'REJECTED' as const;
      }

      if (!approvalCompletes(flow, stage, seesEveryone)) {
        await tx.leaveRequest.update({ where: { id }, data: stageData(input.note) });
        return 'LEVEL_1_DONE' as const;
      }

      await tx.leaveRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          decidedAt: now,
          attendanceApplied: false,
          ...stageData(input.note),
        },
      });
      await tx.leaveBalance.update({
        where: { id: balance.id },
        data: { pending: { decrement: days }, used: { increment: days } },
      });
      return 'APPROVED' as const;
    });

    const label = `${employee.employeeCode} ${iso(found.fromDate)}–${iso(found.toDate)} (${type.name})`;
    if (outcome === 'LEVEL_1_DONE') {
      await this.audit.record({
        action: 'APPROVE',
        entityType: 'LeaveRequest',
        entityId: id,
        summary: `First-level approval of leave for ${label}`,
        userId: user.userId,
      });
      await this.notifyApprovers(
        employee,
        {
          title: `${employee.firstName} ${employee.lastName}'s ${type.name} awaits your final approval`,
          body: `${iso(found.fromDate)} to ${iso(found.toDate)}`,
          entityId: id,
        },
        { exceptEmployeeId: approverId },
      );
    } else if (outcome === 'APPROVED') {
      await this.applyToAttendance(id, employee.id, iso(found.fromDate), iso(found.toDate));
      await this.audit.record({
        action: 'APPROVE',
        entityType: 'LeaveRequest',
        entityId: id,
        summary: `Approved leave for ${label}`,
        userId: user.userId,
      });
      await this.notifyEmployee(employee.id, 'LEAVE_APPROVED', {
        title: `Your ${type.name} was approved`,
        body: `${iso(found.fromDate)} to ${iso(found.toDate)}`,
        entityId: id,
      });
    } else {
      await this.audit.record({
        action: 'REJECT',
        entityType: 'LeaveRequest',
        entityId: id,
        summary: `Rejected leave for ${label}: ${input.note}`,
        userId: user.userId,
      });
      await this.notifyEmployee(employee.id, 'LEAVE_REJECTED', {
        title: `Your ${type.name} was not approved`,
        body: input.note ?? undefined,
        entityId: id,
      });
    }
    return this.get(id, user);
  }

  // -------------------------------------------------------------------------
  // Cancel
  // -------------------------------------------------------------------------

  /**
   * The owner withdraws a waiting request, or an approved one that has not
   * started. After that, only an approver can take it back, with a reason.
   */
  async cancel(id: string, input: LeaveCancelInput, user: AuthenticatedUser) {
    const found = await this.prisma.scoped.leaveRequest.findFirst({
      where: { id },
      include: {
        employee: { include: { office: { select: { timezone: true, shortCode: true } } } },
        leaveType: true,
      },
    });
    if (!found) throw this.notFound();
    if (!(await this.canSee(found.employeeId, user))) throw this.notFound();

    const owner = found.employeeId === user.employeeId;
    const approvable = user.permissions.has('leave.approve')
      ? await this.scope.visibleEmployeeIds(user, this.scope.scopeFor(user, 'leave.approve'))
      : [];
    const isApprover = approvable === null || approvable.includes(found.employeeId);

    const employee = found.employee as unknown as EmployeeRow;
    const type = found.leaveType as unknown as TypeRow;
    const today = toOfficeDateString(this.clock.now(), employee.office.timezone);
    const hasStarted = iso(found.fromDate) <= today;

    if (found.status === 'APPROVED') {
      const ownerMay = owner && !hasStarted;
      if (!ownerMay && !(isApprover && !owner)) {
        throw new ForbiddenException({
          code: 'CANNOT_CANCEL',
          message: owner
            ? 'That leave has already started. Ask your manager or HR to cancel it.'
            : 'You cannot cancel this leave.',
        });
      }
      if (!owner && (input.note ?? '').length < 5) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Say why the approved leave is being cancelled.',
          details: [{ path: 'note', message: 'Say why the approved leave is being cancelled.' }],
        });
      }
    } else if (found.status === 'PENDING') {
      if (!owner && !isApprover) throw this.notFound();
    } else {
      throw new ConflictException({
        code: 'NOT_CANCELLABLE',
        message: 'Only a waiting or an approved leave can be cancelled.',
      });
    }

    const year = leaveYearOf(iso(found.fromDate));
    const days = num(found.totalDays);
    const now = this.clock.now();
    const wasApproved = found.status === 'APPROVED';

    await this.prisma.scoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM leave_requests WHERE id = ${id} FOR UPDATE`;
      const request = await tx.leaveRequest.findFirstOrThrow({ where: { id } });
      if (request.status !== found.status) {
        throw new ConflictException({
          code: 'NOT_PENDING',
          message: 'That request changed while you were looking. Reload and try again.',
        });
      }
      const balance = await this.ensureBalance(tx, type, employee, year);
      await tx.leaveRequest.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          attendanceApplied: false,
        },
      });
      await tx.leaveBalance.update({
        where: { id: balance.id },
        data: wasApproved ? { used: { decrement: days } } : { pending: { decrement: days } },
      });
    });

    if (wasApproved) {
      await this.applyToAttendance(id, employee.id, iso(found.fromDate), iso(found.toDate));
    }
    await this.audit.record({
      action: 'UPDATE',
      entityType: 'LeaveRequest',
      entityId: id,
      summary: `Cancelled ${wasApproved ? 'approved' : 'pending'} leave for ${employee.employeeCode} ${iso(found.fromDate)}–${iso(found.toDate)}${input.note ? `: ${input.note}` : ''}`,
      userId: user.userId,
    });
    if (!owner) {
      await this.notifyEmployee(employee.id, 'LEAVE_REJECTED', {
        title: `Your ${type.name} was cancelled`,
        body: input.note ?? undefined,
        entityId: id,
      });
    }
    return this.get(id, user);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private readonly requestInclude = {
    employee: {
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        office: { select: { shortCode: true, timezone: true } },
      },
    },
    leaveType: true,
  } satisfies Prisma.LeaveRequestInclude;

  private notFound() {
    return new NotFoundException({ code: 'NOT_FOUND', message: 'Leave request not found.' });
  }

  /** Whether the request's owner is someone the caller may look at. */
  private async canSee(employeeId: string, user: AuthenticatedUser): Promise<boolean> {
    if (employeeId === user.employeeId) return true;
    for (const key of ['leave.view', 'leave.approve']) {
      if (!user.permissions.has(key)) continue;
      const ids = await this.scope.visibleEmployeeIds(user, this.scope.scopeFor(user, key));
      if (ids === null || ids.includes(employeeId)) return true;
    }
    return false;
  }

  /** The employee a view is about: themselves, or someone in scope. */
  private async visibleEmployee(
    employeeId: string | null | undefined,
    user: AuthenticatedUser,
    key: string,
  ): Promise<EmployeeRow> {
    if (!employeeId) {
      throw new ForbiddenException({
        code: 'NO_EMPLOYEE_PROFILE',
        message: 'Your login is not linked to an employee record.',
      });
    }
    if (employeeId !== user.employeeId) {
      const ids = await this.scope.visibleEmployeeIds(user, this.scope.scopeFor(user, key));
      if (ids !== null && !ids.includes(employeeId)) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Employee not found.' });
      }
    }
    const employee = await this.prisma.scoped.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      include: { office: { select: { timezone: true, shortCode: true } } },
    });
    if (!employee) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Employee not found.' });
    }
    return employee as unknown as EmployeeRow;
  }

  /** Who the leave is for: the caller, or — where their scope allows — someone else. */
  private async applicant(
    employeeId: string | null | undefined,
    user: AuthenticatedUser,
  ): Promise<EmployeeRow> {
    return this.visibleEmployee(employeeId ?? user.employeeId, user, 'leave.create');
  }

  private async activeType(id: string): Promise<TypeRow> {
    const type = await this.prisma.scoped.leaveType.findFirst({
      where: { id, isActive: true, deletedAt: null },
    });
    if (!type) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'That leave type is not available.',
        details: [{ path: 'leaveTypeId', message: 'That leave type is not available.' }],
      });
    }
    return type as unknown as TypeRow;
  }

  private invalid(field: string, message: string) {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message,
      details: [{ path: field, message }],
    });
  }

  /** The dates, the office calendar and the type's rules, checked; and the days it will cost. */
  private async plan(
    employee: EmployeeRow,
    type: TypeRow,
    input: { fromDate: string; toDate: string; dayPart: 'FULL_DAY' | 'FIRST_HALF' | 'SECOND_HALF' },
  ) {
    const today = toOfficeDateString(this.clock.now(), employee.office.timezone);
    if (input.fromDate < addDays(today, -LEAVE_BACKDATE_DAYS)) {
      throw this.invalid(
        'fromDate',
        `Leave can be applied up to ${LEAVE_BACKDATE_DAYS} days back. Ask HR for older days.`,
      );
    }
    if (input.toDate > addDays(today, LEAVE_ADVANCE_DAYS)) {
      throw this.invalid('toDate', 'That is too far ahead.');
    }
    if (input.fromDate < iso(employee.joiningDate)) {
      throw this.invalid('fromDate', 'That is before you joined.');
    }
    if (employee.exitDate && input.toDate > iso(employee.exitDate)) {
      throw this.invalid('toDate', 'That is after the last working day.');
    }
    if (input.dayPart !== 'FULL_DAY' && !type.allowHalfDay) {
      throw this.invalid('dayPart', `${type.name} cannot be taken as a half day.`);
    }

    const ctx = await this.loader.load(
      [
        {
          id: employee.id,
          officeId: employee.officeId,
          departmentId: employee.departmentId,
          joiningDate: employee.joiningDate,
          exitDate: employee.exitDate,
        },
      ],
      input.fromDate,
      input.toDate,
    );
    const calendar = eachDate(input.fromDate, input.toDate).map((date) => {
      const day = ctx.resolve(employee.id, date);
      return { date, weeklyOff: day?.weeklyOff ?? false, holiday: day?.holiday?.name ?? null };
    });
    const plan = countLeaveDays(calendar, input.dayPart);
    if (plan.totalDays === 0) {
      throw this.invalid(
        'fromDate',
        'Those days are all weekly offs or holidays. There is nothing to take leave for.',
      );
    }
    return plan;
  }

  private async findOverlap(db: Db, employeeId: string, from: string, to: string) {
    return db.leaveRequest.findFirst({
      where: {
        employeeId,
        status: { in: ['PENDING', 'APPROVED'] },
        fromDate: { lte: d(to) },
        toDate: { gte: d(from) },
      },
    });
  }

  /**
   * Rewrites the attendance days a leave covers, so an approval (or a
   * cancellation) shows up in the register at once rather than at the next
   * nightly pass. Days still in the future are untouched: nothing is stored for
   * them until they happen.
   */
  private async applyToAttendance(id: string, employeeId: string, from: string, to: string) {
    await this.attendance.recomputeRange([employeeId], from, to, { force: true });
    const request = await this.prisma.scoped.leaveRequest.findFirst({ where: { id } });
    if (request) {
      await this.prisma.scoped.leaveRequest.update({
        where: { id },
        data: { attendanceApplied: request.status === 'APPROVED' },
      });
    }
  }

  // --- notifications -------------------------------------------------------

  private async notifyEmployee(
    employeeId: string,
    type: 'LEAVE_APPROVED' | 'LEAVE_REJECTED',
    note: { title: string; body?: string; entityId: string },
  ) {
    await this.notify.toEmployee(employeeId, type, {
      ...note,
      linkUrl: '/leave',
      entityType: 'LeaveRequest',
    });
  }

  /** Everyone who can decide this person's leave gets a bell item. */
  private async notifyApprovers(
    employee: EmployeeRow,
    note: { title: string; body?: string; entityId: string },
    options: { exceptEmployeeId?: string } = {},
  ) {
    await this.notify.toApprovers(
      'leave.approve',
      employee.id,
      'LEAVE_SUBMITTED',
      { ...note, linkUrl: '/leave?tab=approvals', entityType: 'LeaveRequest' },
      options,
    );
  }

  // --- shaping -------------------------------------------------------------

  private shapeEmployee(e: EmployeeRow) {
    return {
      id: e.id,
      employeeCode: e.employeeCode,
      fullName: `${e.firstName} ${e.lastName}`,
      office: e.office.shortCode,
    };
  }

  private async approverNames(
    rows: Array<{ level1ApproverId: string | null; level2ApproverId: string | null }>,
  ) {
    const ids = [
      ...new Set(rows.flatMap((r) => [r.level1ApproverId, r.level2ApproverId]).filter(Boolean)),
    ] as string[];
    if (ids.length === 0) return new Map<string, string>();
    const people = await this.prisma.scoped.employee.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
  }

  private shape(
    row: RequestRow,
    names: Map<string, string>,
    user: AuthenticatedUser,
    approvable: Set<string> | null,
  ) {
    const type = row.leaveType as unknown as TypeRow;
    const pending = row.status === 'PENDING';
    const stage = nextLeaveStage(type.approvalFlow, row.level1ApproverId !== null);
    const owner = row.employeeId === user.employeeId;
    const inScope =
      user.permissions.has('leave.approve') &&
      (approvable === null || approvable.has(row.employeeId));
    const today = toOfficeDateString(this.clock.now(), row.employee.office.timezone);

    const canDecide =
      pending &&
      inScope &&
      !owner &&
      !!user.employeeId &&
      !(stage === 2 && row.level1ApproverId === user.employeeId);
    const canCancel =
      (row.status === 'PENDING' && (owner || inScope)) ||
      (row.status === 'APPROVED' && ((owner && iso(row.fromDate) > today) || (inScope && !owner)));

    return {
      id: row.id,
      status: row.status,
      fromDate: iso(row.fromDate),
      toDate: iso(row.toDate),
      dayPart: row.dayPart,
      totalDays: num(row.totalDays),
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      attendanceApplied: row.attendanceApplied,
      leaveType: this.shapeType(type),
      employee: {
        id: row.employee.id,
        employeeCode: row.employee.employeeCode,
        fullName: `${row.employee.firstName} ${row.employee.lastName}`,
        office: row.employee.office.shortCode,
      },
      flow: type.approvalFlow,
      /** Which decision it is waiting on, when it is waiting. */
      awaitingLevel: pending ? stage : null,
      level1: row.level1ApproverId
        ? {
            approver: names.get(row.level1ApproverId) ?? null,
            decidedAt: row.level1DecidedAt?.toISOString() ?? null,
            note: row.level1Note,
          }
        : null,
      level2: row.level2ApproverId
        ? {
            approver: names.get(row.level2ApproverId) ?? null,
            decidedAt: row.level2DecidedAt?.toISOString() ?? null,
            note: row.level2Note,
          }
        : null,
      isMine: owner,
      canDecide,
      canCancel,
    };
  }
}

type RequestRow = {
  id: string;
  employeeId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  fromDate: Date;
  toDate: Date;
  dayPart: 'FULL_DAY' | 'FIRST_HALF' | 'SECOND_HALF';
  totalDays: Prisma.Decimal;
  reason: string;
  createdAt: Date;
  decidedAt: Date | null;
  cancelledAt: Date | null;
  attendanceApplied: boolean;
  level1ApproverId: string | null;
  level1DecidedAt: Date | null;
  level1Note: string | null;
  level2ApproverId: string | null;
  level2DecidedAt: Date | null;
  level2Note: string | null;
  leaveType: unknown;
  employee: {
    id: string;
    employeeCode: string;
    firstName: string;
    lastName: string;
    office: { shortCode: string; timezone: string };
  };
};
