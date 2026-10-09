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
  officeLocalToUtc,
  REGULARISATION_WINDOW_DAYS,
  toOfficeDateString,
  type RegularisationDecisionInput,
  type RegularisationInput,
  type RegularisationListQuery,
} from '@opsvera/shared';
import { Clock } from '../../common/clock';
import { DataScopeService } from '../../common/scope/data-scope.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AttendanceContextLoader } from './attendance-context';
import { AttendanceService } from './attendance.service';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);

/**
 * Asking for a day to be corrected, and deciding on it.
 *
 * Approval does not edit the day. It adds REGULARISED punches at the requested
 * times; the rule engine then prefers those over the raw punches they correct,
 * which stay on record. So a regularised day is always explainable: here is what
 * the system saw, here is what was approved, and by whom.
 */
@Injectable()
export class RegularisationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: DataScopeService,
    private readonly attendance: AttendanceService,
    private readonly loader: AttendanceContextLoader,
    private readonly clock: Clock,
  ) {}

  // -------------------------------------------------------------------------
  // Raise
  // -------------------------------------------------------------------------

  async create(input: RegularisationInput, user: AuthenticatedUser) {
    if (!user.employeeId) {
      throw new ForbiddenException({
        code: 'NO_EMPLOYEE_PROFILE',
        message: 'Your login is not linked to an employee record.',
      });
    }
    const employee = await this.prisma.scoped.employee.findFirstOrThrow({
      where: { id: user.employeeId, deletedAt: null },
      include: { office: { select: { timezone: true } } },
    });

    const today = toOfficeDateString(this.clock.now(), employee.office.timezone);
    if (input.attendanceDate > today) {
      throw this.invalid(
        'attendanceDate',
        'You cannot regularise a day that has not happened yet.',
      );
    }
    if (input.attendanceDate < addDays(today, -REGULARISATION_WINDOW_DAYS)) {
      throw this.invalid(
        'attendanceDate',
        `Only the last ${REGULARISATION_WINDOW_DAYS} days can be regularised. Ask HR to correct older days.`,
      );
    }
    if (input.attendanceDate < iso(employee.joiningDate)) {
      throw this.invalid('attendanceDate', 'That is before you joined.');
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
      input.attendanceDate,
      input.attendanceDate,
    );
    const day = ctx.resolve(employee.id, input.attendanceDate);
    if (day?.weeklyOff || day?.holiday) {
      throw this.invalid(
        'attendanceDate',
        `That day is ${day.weeklyOff ? 'a weekly off' : `a holiday (${day.holiday!.name})`}; there is nothing to regularise.`,
      );
    }

    // A day-shift clock-out earlier than the clock-in is a typo. On a shift
    // that crosses midnight it simply means the next morning.
    if (
      input.requestedInTime &&
      input.requestedOutTime &&
      input.requestedOutTime <= input.requestedInTime &&
      !day?.shift?.crossesMidnight
    ) {
      throw this.invalid('requestedOutTime', 'The clock-out has to be after the clock-in.');
    }

    const pending = await this.prisma.scoped.regularisationRequest.findFirst({
      where: {
        employeeId: employee.id,
        attendanceDate: d(input.attendanceDate),
        status: 'PENDING',
      },
    });
    if (pending) {
      throw new ConflictException({
        code: 'ALREADY_PENDING',
        message:
          'You already have a request waiting for that day. Cancel it first to send a new one.',
      });
    }

    const created = await this.prisma.scoped.regularisationRequest.create({
      data: {
        employeeId: employee.id,
        attendanceDate: d(input.attendanceDate),
        requestedInTime: input.requestedInTime ?? null,
        requestedOutTime: input.requestedOutTime ?? null,
        reason: input.reason,
        createdById: user.userId,
      } as never,
    });
    return this.shape(created);
  }

  async cancel(id: string, user: AuthenticatedUser) {
    const request = await this.prisma.scoped.regularisationRequest.findFirst({ where: { id } });
    if (!request || request.employeeId !== user.employeeId) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Request not found.' });
    }
    if (request.status !== 'PENDING') {
      throw new ConflictException({
        code: 'NOT_PENDING',
        message: 'Only a request that is still waiting can be cancelled.',
      });
    }
    const updated = await this.prisma.scoped.regularisationRequest.update({
      where: { id },
      data: { status: 'CANCELLED', decidedAt: this.clock.now() },
    });
    return this.shape(updated);
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  /** Your own requests, plus those of people you approve for. */
  async list(query: RegularisationListQuery, user: AuthenticatedUser) {
    const approvable = user.permissions.has('attendance.approve')
      ? await this.scope.visibleEmployeeIds(user, this.scope.scopeFor(user, 'attendance.approve'))
      : [];
    const mine = user.employeeId ? [user.employeeId] : [];

    const allowed = approvable === null ? null : [...new Set([...mine, ...approvable])];

    // `mine` / `employeeId` may only narrow what the caller can see, never widen it.
    const wanted = query.mine ? (user.employeeId ?? '__none__') : query.employeeId;
    const employeeFilter: Prisma.RegularisationRequestWhereInput['employeeId'] = wanted
      ? allowed === null || allowed.includes(wanted)
        ? wanted
        : '__none__'
      : allowed === null
        ? undefined
        : { in: allowed };

    const where: Prisma.RegularisationRequestWhereInput = {
      ...(employeeFilter === undefined ? {} : { employeeId: employeeFilter }),
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.scoped.regularisationRequest.findMany({
        where,
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
        },
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.scoped.regularisationRequest.count({ where }),
    ]);

    // null = may decide anyone's; otherwise only those in the set.
    const canDecide = !user.permissions.has('attendance.approve')
      ? new Set<string>()
      : approvable === null
        ? null
        : new Set(approvable);

    return {
      data: rows.map((row) => ({
        ...this.shape(row),
        employee: {
          id: row.employee.id,
          employeeCode: row.employee.employeeCode,
          fullName: `${row.employee.firstName} ${row.employee.lastName}`,
          office: row.employee.office.shortCode,
        },
        // The caller may decide it when they have the permission over this
        // person — and never when it is their own request.
        canDecide:
          row.status === 'PENDING' &&
          row.employeeId !== user.employeeId &&
          (canDecide === null || canDecide.has(row.employeeId)),
        isMine: row.employeeId === user.employeeId,
      })),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Decide
  // -------------------------------------------------------------------------

  async decide(id: string, input: RegularisationDecisionInput, user: AuthenticatedUser) {
    const request = await this.prisma.scoped.regularisationRequest.findFirst({
      where: { id },
      include: {
        employee: { include: { office: { select: { id: true, timezone: true } } } },
      },
    });
    if (!request) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Request not found.' });
    }

    // Outside your approval scope the request does not exist for you.
    const approvable = await this.scope.visibleEmployeeIds(
      user,
      this.scope.scopeFor(user, 'attendance.approve'),
    );
    if (approvable !== null && !approvable.includes(request.employeeId)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Request not found.' });
    }
    if (request.employeeId === user.employeeId) {
      throw new ForbiddenException({
        code: 'SELF_APPROVAL',
        message: 'You cannot decide your own request. Someone else has to.',
      });
    }
    if (request.status !== 'PENDING') {
      throw new ConflictException({
        code: 'NOT_PENDING',
        message: 'That request has already been decided or cancelled.',
      });
    }

    const now = this.clock.now();
    const date = iso(request.attendanceDate);
    const employee = request.employee;

    if (input.decision === 'REJECTED') {
      await this.prisma.scoped.regularisationRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          approverId: user.employeeId,
          decidedAt: now,
          decisionNote: input.note ?? null,
        },
      });
      await this.audit.record({
        action: 'REJECT',
        entityType: 'RegularisationRequest',
        entityId: id,
        summary: `Rejected the attendance correction for ${employee.employeeCode} on ${date}: ${input.note}`,
        userId: user.userId,
      });
      return this.get(id);
    }

    // Approve: add the corrected punches, then re-judge the day.
    const timeZone = employee.office.timezone;
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
      date,
      date,
    );
    const crossesMidnight = ctx.resolve(employee.id, date)?.shift?.crossesMidnight ?? false;

    const punchAt = (time: string, kind: 'IN' | 'OUT') => {
      let when = officeLocalToUtc(date, time, timeZone);
      // A night-shift clock-out at 06:00 is the next morning.
      if (kind === 'OUT' && crossesMidnight) {
        const inTime = request.requestedInTime;
        const startTime = ctx.resolve(employee.id, date)?.shift?.startTime ?? '00:00';
        if (time <= (inTime ?? startTime))
          when = officeLocalToUtc(addDays(date, 1), time, timeZone);
      }
      return when;
    };

    await this.prisma.scoped.$transaction(async (tx) => {
      const make = (kind: 'IN' | 'OUT', time: string) =>
        tx.punch.create({
          data: {
            employeeId: employee.id,
            officeId: employee.officeId,
            type: kind,
            source: 'REGULARISED',
            punchedAt: punchAt(time, kind),
            attendanceDate: d(date),
            isFlagged: false,
            note: `Regularised: ${request.reason}`.slice(0, 400),
            createdById: user.userId,
          } as never,
        });
      if (request.requestedInTime) await make('IN', request.requestedInTime);
      if (request.requestedOutTime) await make('OUT', request.requestedOutTime);

      await tx.regularisationRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approverId: user.employeeId,
          decidedAt: now,
          decisionNote: input.note ?? null,
        },
      });
    });

    const evals = await this.attendance.evaluate(
      [
        {
          id: employee.id,
          officeId: employee.officeId,
          departmentId: employee.departmentId,
          joiningDate: employee.joiningDate,
          exitDate: employee.exitDate,
        },
      ],
      date,
      date,
      now,
      { live: true },
    );
    await this.attendance.persist([...evals.values()], now);
    await this.prisma.scoped.attendanceRecord.updateMany({
      where: { employeeId: employee.id, attendanceDate: d(date) },
      data: { isRegularised: true },
    });

    await this.audit.record({
      action: 'APPROVE',
      entityType: 'RegularisationRequest',
      entityId: id,
      summary:
        `Approved the attendance correction for ${employee.employeeCode} on ${date}` +
        ` (in ${request.requestedInTime ?? '—'}, out ${request.requestedOutTime ?? '—'})`,
      after: { in: request.requestedInTime, out: request.requestedOutTime },
      userId: user.userId,
    });

    return this.get(id);
  }

  private async get(id: string) {
    return this.shape(
      await this.prisma.scoped.regularisationRequest.findFirstOrThrow({ where: { id } }),
    );
  }

  private shape(row: {
    id: string;
    employeeId: string;
    attendanceDate: Date;
    requestedInTime: string | null;
    requestedOutTime: string | null;
    reason: string;
    status: string;
    approverId: string | null;
    decidedAt: Date | null;
    decisionNote: string | null;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      employeeId: row.employeeId,
      attendanceDate: iso(row.attendanceDate),
      requestedInTime: row.requestedInTime,
      requestedOutTime: row.requestedOutTime,
      reason: row.reason,
      status: row.status,
      approverId: row.approverId,
      decidedAt: row.decidedAt,
      decisionNote: row.decisionNote,
      createdAt: row.createdAt,
    };
  }

  private invalid(field: string, message: string) {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message,
      details: [{ path: field, message }],
    });
  }
}
