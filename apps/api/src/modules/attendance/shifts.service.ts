import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  addDays,
  endsNextDay,
  startOfWeek,
  type RosterQuery,
  type ShiftAssignmentInput,
  type ShiftInput,
} from '@opsvera/shared';
import { Clock } from '../../common/clock';
import { DataScopeService } from '../../common/scope/data-scope.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AttendanceContextLoader, dateRange } from './attendance-context';
import { AttendanceService } from './attendance.service';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);

/** How far back a roster change re-judges attendance. */
const RECOMPUTE_DAYS_BACK = 62;

/**
 * Shift templates, who works them, and the weekly roster.
 *
 * Assignments are effective-dated with an *exclusive* end — the same convention
 * as cost-rate history — so "from 01 Nov" to "from 01 Dec" chain with no gap
 * and no overlap, and the UI shows the end as the day before.
 */
@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: DataScopeService,
    private readonly loader: AttendanceContextLoader,
    private readonly attendance: AttendanceService,
    private readonly clock: Clock,
  ) {}

  // -------------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------------

  async list() {
    const shifts = await this.prisma.scoped.shift.findMany({
      where: { deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { assignments: true } } },
    });

    // Who is on each shift today — the number people actually want.
    const today = iso(this.clock.now());
    const current = await this.prisma.scoped.shiftAssignment.findMany({
      where: {
        effectiveFrom: { lte: d(today) },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: d(today) } }],
      },
      select: { shiftId: true, employeeId: true, departmentId: true },
    });

    return shifts.map((shift) => ({
      ...shift,
      crossesMidnight: endsNextDay(shift.startTime, shift.endTime),
      assignmentCount: shift._count.assignments,
      currentAssignments: current.filter((a) => a.shiftId === shift.id).length,
    }));
  }

  async create(input: ShiftInput, user: AuthenticatedUser) {
    await this.assertNameFree(input.name);

    const shift = await this.prisma.scoped.$transaction(async (tx) => {
      // The first shift is the default by necessity: someone has to be the
      // fallback for people with no assignment.
      const existing = await tx.shift.count({ where: { deletedAt: null } });
      const isDefault = input.isDefault === true || existing === 0;
      if (isDefault)
        await tx.shift.updateMany({ where: { isDefault: true }, data: { isDefault: false } });

      return tx.shift.create({
        data: {
          name: input.name,
          startTime: input.startTime,
          endTime: input.endTime,
          crossesMidnight: endsNextDay(input.startTime, input.endTime),
          breakMinutes: input.breakMinutes,
          graceMinutes: input.graceMinutes,
          isDefault,
          isActive: input.isActive ?? true,
          createdById: user.userId,
        } as never,
      });
    });

    await this.audit.record({
      action: 'CREATE',
      entityType: 'Shift',
      entityId: shift.id,
      summary: `Created shift ${shift.name} (${shift.startTime}–${shift.endTime})`,
      userId: user.userId,
    });
    return shift;
  }

  async update(id: string, input: ShiftInput, user: AuthenticatedUser) {
    const before = await this.requireShift(id);
    if (input.name !== before.name) await this.assertNameFree(input.name, id);

    if (before.isDefault && input.isDefault === false) {
      throw new ConflictException({
        code: 'DEFAULT_SHIFT',
        message: 'This is the default shift. Make another shift the default first.',
      });
    }
    if (before.isDefault && input.isActive === false) {
      throw new ConflictException({
        code: 'DEFAULT_SHIFT',
        message: 'The default shift cannot be deactivated. Make another shift the default first.',
      });
    }

    const shift = await this.prisma.scoped.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.shift.updateMany({
          where: { isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.shift.update({
        where: { id },
        data: {
          name: input.name,
          startTime: input.startTime,
          endTime: input.endTime,
          crossesMidnight: endsNextDay(input.startTime, input.endTime),
          breakMinutes: input.breakMinutes,
          graceMinutes: input.graceMinutes,
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
    });

    await this.audit.recordChange({
      action: 'UPDATE',
      entityType: 'Shift',
      entityId: id,
      summary: `Updated shift ${shift.name}`,
      before: before as unknown as Record<string, unknown>,
      after: shift as unknown as Record<string, unknown>,
      fields: [
        'name',
        'startTime',
        'endTime',
        'breakMinutes',
        'graceMinutes',
        'isDefault',
        'isActive',
      ],
      userId: user.userId,
    });
    return shift;
  }

  /**
   * Shifts that days have been judged against are history; they are
   * deactivated, not deleted. Only a shift that nothing ever used can go.
   */
  async remove(id: string, user: AuthenticatedUser) {
    const shift = await this.requireShift(id);
    if (shift.isDefault) {
      throw new ConflictException({
        code: 'DEFAULT_SHIFT',
        message: 'The default shift cannot be deleted. Make another shift the default first.',
      });
    }
    const [assignments, records] = await Promise.all([
      this.prisma.scoped.shiftAssignment.count({ where: { shiftId: id } }),
      this.prisma.scoped.attendanceRecord.count({ where: { shiftId: id } }),
    ]);
    if (assignments > 0 || records > 0) {
      throw new ConflictException({
        code: 'IN_USE',
        message: `${shift.name} has ${assignments} assignment(s) and ${records} attendance day(s) against it. Deactivate it instead.`,
      });
    }
    await this.prisma.scoped.shift.update({
      where: { id },
      // The name is unique per company, deleted or not; free it for reuse.
      data: {
        deletedAt: new Date(),
        name: `${shift.name} (deleted ${id.slice(-6)})`.slice(0, 120),
      },
    });
    await this.audit.record({
      action: 'DELETE',
      entityType: 'Shift',
      entityId: id,
      summary: `Deleted shift ${shift.name}`,
      userId: user.userId,
    });
  }

  // -------------------------------------------------------------------------
  // Assignments
  // -------------------------------------------------------------------------

  async listAssignments(shiftId: string) {
    await this.requireShift(shiftId);
    const rows = await this.prisma.scoped.shiftAssignment.findMany({
      where: { shiftId },
      orderBy: [{ effectiveFrom: 'desc' }],
      include: {
        employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
        department: { select: { id: true, name: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      shiftId: row.shiftId,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo,
      weeklyOffDays: row.weeklyOffDays as number[] | null,
      employee: row.employee
        ? {
            id: row.employee.id,
            employeeCode: row.employee.employeeCode,
            fullName: `${row.employee.firstName} ${row.employee.lastName}`,
          }
        : null,
      department: row.department,
    }));
  }

  async assign(shiftId: string, input: ShiftAssignmentInput, user: AuthenticatedUser) {
    const shift = await this.requireShift(shiftId);
    if (!shift.isActive) {
      throw new BadRequestException({
        code: 'SHIFT_INACTIVE',
        message: 'That shift is switched off. Switch it on before assigning people to it.',
      });
    }

    const subject = input.employeeId
      ? { employeeId: input.employeeId }
      : { departmentId: input.departmentId! };

    if (input.employeeId) {
      const employee = await this.prisma.scoped.employee.findFirst({
        where: { id: input.employeeId, deletedAt: null },
      });
      if (!employee) throw this.invalid('employeeId', 'That employee does not exist.');
    } else {
      const department = await this.prisma.scoped.department.findFirst({
        where: { id: input.departmentId! },
      });
      if (!department) throw this.invalid('departmentId', 'That department does not exist.');
    }

    const created = await this.prisma.scoped.$transaction(async (tx) => {
      const same = await tx.shiftAssignment.findMany({ where: subject });

      // Something already starts on or after the new date: refusing is safer
      // than guessing which of the two the manager meant.
      const later = same.find((a) => iso(a.effectiveFrom) >= input.effectiveFrom);
      if (later) {
        throw new ConflictException({
          code: 'OVERLAP',
          message: `There is already an assignment starting ${iso(later.effectiveFrom)} or later. Remove it first, or choose a date after it.`,
          details: [{ path: 'effectiveFrom', message: 'Overlaps a later assignment' }],
        });
      }

      // The assignment now running ends the day the new one begins.
      for (const running of same.filter(
        (a) => !a.effectiveTo || iso(a.effectiveTo) > input.effectiveFrom,
      )) {
        await tx.shiftAssignment.update({
          where: { id: running.id },
          data: { effectiveTo: d(input.effectiveFrom) },
        });

        // A temporary change (it has an end) hands back to what was running,
        // rather than leaving a gap where the person falls to the default.
        const runsPastTheChange =
          input.effectiveTo &&
          (!running.effectiveTo || iso(running.effectiveTo) > input.effectiveTo);
        if (runsPastTheChange) {
          await tx.shiftAssignment.create({
            data: {
              shiftId: running.shiftId,
              ...subject,
              effectiveFrom: d(input.effectiveTo!),
              effectiveTo: running.effectiveTo,
              weeklyOffDays: (running.weeklyOffDays as number[] | null) ?? undefined,
              createdById: user.userId,
            } as never,
          });
        }
      }

      return tx.shiftAssignment.create({
        data: {
          shiftId,
          ...subject,
          effectiveFrom: d(input.effectiveFrom),
          effectiveTo: input.effectiveTo ? d(input.effectiveTo) : null,
          weeklyOffDays: input.weeklyOffDays ?? undefined,
          createdById: user.userId,
        } as never,
      });
    });

    await this.audit.record({
      action: 'CREATE',
      entityType: 'ShiftAssignment',
      entityId: created.id,
      summary: `Assigned ${shift.name} from ${input.effectiveFrom} to ${
        input.employeeId ? 'an employee' : 'a department'
      }`,
      after: input,
      userId: user.userId,
    });

    await this.rejudge(subject, input.effectiveFrom);
    return created;
  }

  async removeAssignment(id: string, user: AuthenticatedUser) {
    const assignment = await this.prisma.scoped.shiftAssignment.findFirst({ where: { id } });
    if (!assignment) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Assignment not found.' });
    }
    await this.prisma.scoped.shiftAssignment.delete({ where: { id } });

    // If this one ended a previous assignment, that one runs on again.
    const subject = assignment.employeeId
      ? { employeeId: assignment.employeeId }
      : { departmentId: assignment.departmentId! };
    const ended = await this.prisma.scoped.shiftAssignment.findFirst({
      where: { ...subject, effectiveTo: assignment.effectiveFrom },
    });
    if (ended) {
      await this.prisma.scoped.shiftAssignment.update({
        where: { id: ended.id },
        data: { effectiveTo: assignment.effectiveTo },
      });
    }

    await this.audit.record({
      action: 'DELETE',
      entityType: 'ShiftAssignment',
      entityId: id,
      summary: `Removed a shift assignment starting ${iso(assignment.effectiveFrom)}`,
      userId: user.userId,
    });
    await this.rejudge(subject, iso(assignment.effectiveFrom));
  }

  /** Days already worked under a changed roster are judged again, within reason. */
  private async rejudge(subject: { employeeId?: string; departmentId?: string }, from: string) {
    const today = iso(this.clock.now());
    const start =
      from > addDays(today, -RECOMPUTE_DAYS_BACK) ? from : addDays(today, -RECOMPUTE_DAYS_BACK);
    if (start > today) return;

    const people = subject.employeeId
      ? [subject.employeeId]
      : (
          await this.prisma.scoped.employee.findMany({
            where: { departmentId: subject.departmentId, deletedAt: null },
            select: { id: true },
          })
        ).map((e) => e.id);
    await this.attendance.recomputeRange(people, start, today, { force: true });
  }

  // -------------------------------------------------------------------------
  // Roster
  // -------------------------------------------------------------------------

  async roster(query: RosterQuery, user: AuthenticatedUser) {
    const weekStart = startOfWeek(query.weekOf ?? iso(this.clock.now()));
    const weekEnd = addDays(weekStart, 6);

    const visible = await this.scope.visibleEmployeeIds(
      user,
      this.scope.scopeFor(user, 'shift.view'),
    );

    const everyone = await this.prisma.scoped.employee.findMany({
      where: {
        deletedAt: null,
        status: { in: ['ACTIVE', 'NOTICE_PERIOD'] },
        ...(visible === null ? {} : { id: { in: visible } }),
        ...(query.officeId ? { officeId: query.officeId } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        joiningDate: { lte: d(weekEnd) },
        OR: [{ exitDate: null }, { exitDate: { gte: d(weekStart) } }],
        ...(query.q
          ? {
              AND: [
                {
                  OR: [
                    { firstName: { contains: query.q } },
                    { lastName: { contains: query.q } },
                    { employeeCode: { contains: query.q } },
                  ],
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        officeId: true,
        departmentId: true,
        joiningDate: true,
        exitDate: true,
        office: { select: { shortCode: true } },
        department: { select: { name: true } },
      },
      orderBy: [{ office: { shortCode: 'asc' } }, { firstName: 'asc' }],
    });

    const total = everyone.length;
    const people = everyone.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
    const ctx = await this.loader.load(people, weekStart, weekEnd);

    const days = dateRange(weekStart, weekEnd);
    const data = people.map((person) => ({
      employeeId: person.id,
      employeeCode: person.employeeCode,
      fullName: `${person.firstName} ${person.lastName}`,
      office: person.office.shortCode,
      department: person.department?.name ?? null,
      days: days.map((date) => {
        const day = ctx.resolve(person.id, date);
        if (!day || !day.eligible) return { date, kind: 'NONE' as const };
        if (day.weeklyOff) return { date, kind: 'OFF' as const };
        if (day.holiday) return { date, kind: 'HOLIDAY' as const, label: day.holiday.name };
        if (day.leave?.dayPart === 'FULL_DAY') return { date, kind: 'LEAVE' as const };
        return {
          date,
          kind: 'SHIFT' as const,
          shiftId: day.shift?.id ?? null,
          shift: day.shift?.name ?? null,
          start: day.shift?.startTime ?? null,
          end: day.shift?.endTime ?? null,
          halfLeave: day.leave ? day.leave.dayPart : null,
        };
      }),
    }));

    return {
      weekStart,
      weekEnd,
      days,
      data,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  /** People and departments for the assignment dialog, for anyone who can assign. */
  async lookups() {
    const [employees, departments] = await Promise.all([
      this.prisma.scoped.employee.findMany({
        where: { deletedAt: null, status: { in: ['ACTIVE', 'NOTICE_PERIOD'] } },
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          office: { select: { shortCode: true } },
        },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      this.prisma.scoped.department.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return {
      employees: employees.map((e) => ({
        id: e.id,
        employeeCode: e.employeeCode,
        fullName: `${e.firstName} ${e.lastName}`,
        office: e.office.shortCode,
      })),
      departments,
    };
  }

  // -------------------------------------------------------------------------

  private async requireShift(id: string) {
    const shift = await this.prisma.scoped.shift.findFirst({ where: { id, deletedAt: null } });
    if (!shift) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Shift not found.' });
    return shift;
  }

  private async assertNameFree(name: string, excludeId?: string) {
    const clash = await this.prisma.scoped.shift.findFirst({
      where: { name, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    if (clash) {
      throw new ConflictException({
        code: 'DUPLICATE',
        message: `A shift called "${name}" already exists.`,
        details: { field: 'name' },
      });
    }
  }

  private invalid(field: string, message: string) {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message,
      details: [{ path: field, message }],
    });
  }
}
