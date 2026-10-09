import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import {
  DataScope,
  type CostRateInput,
  type CreateEmployeeInput,
  type EmployeeListQuery,
  type SalaryInput,
  type UpdateEmployeeInput,
} from '@opsvera/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { runUnscoped } from '../../prisma/tenant-context';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { DataScopeService } from '../../common/scope/data-scope.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly scope: DataScopeService,
  ) {}

  // -------------------------------------------------------------------------
  // List & read
  // -------------------------------------------------------------------------

  async list(query: EmployeeListQuery, user: AuthenticatedUser) {
    // Data scope decides which employees are visible at all; the filters below
    // only narrow that further.
    const visible = await this.scope.visibleEmployeeIds(
      user,
      this.scope.scopeFor(user, 'employee.view'),
    );

    const where: Prisma.EmployeeWhereInput = {
      deletedAt: null,
      ...(visible === null ? {} : { id: { in: visible } }),
      ...(query.officeId ? { officeId: query.officeId } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(query.designationId ? { designationId: query.designationId } : {}),
      ...(query.managerId ? { managerId: query.managerId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.attendanceMethod ? { attendanceMethod: query.attendanceMethod } : {}),
      ...(query.withoutLogin ? { userId: null } : {}),
      ...(query.q
        ? {
            OR: [
              { firstName: { contains: query.q } },
              { lastName: { contains: query.q } },
              { employeeCode: { contains: query.q } },
              { workEmail: { contains: query.q } },
            ],
          }
        : {}),
    };

    const [sortField, sortDirection] = (query.sort ?? 'employeeCode:asc').split(':');

    const [rows, total] = await Promise.all([
      this.prisma.scoped.employee.findMany({
        where,
        include: {
          office: { select: { id: true, name: true, shortCode: true, timezone: true } },
          department: { select: { id: true, name: true } },
          designation: { select: { id: true, name: true } },
          manager: { select: { id: true, firstName: true, lastName: true } },
          user: { select: { id: true, email: true, status: true, lastLoginAt: true } },
        },
        orderBy: { [sortField]: sortDirection as 'asc' | 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.scoped.employee.count({ where }),
    ]);

    // Current rate and salary are attached separately so the field-masking
    // interceptor can strip them for callers without cost.view / salary.view.
    const rates = await this.currentRatesFor(rows.map((r) => r.id));

    return {
      data: rows.map((row) => ({
        ...row,
        fullName: `${row.firstName} ${row.lastName}`,
        hourlyRate: rates.get(row.id)?.hourlyRate ?? null,
        monthlyAmount: rates.get(row.id)?.monthlyAmount ?? null,
      })),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  /** The Employee 360 payload. */
  async findOne(id: string, user: AuthenticatedUser) {
    await this.assertVisible(id, user);

    const employee = await this.prisma.scoped.employee.findFirst({
      where: { id, deletedAt: null },
      include: {
        office: { select: { id: true, name: true, shortCode: true, timezone: true } },
        department: { select: { id: true, name: true } },
        designation: { select: { id: true, name: true } },
        manager: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        directReports: {
          where: { deletedAt: null },
          select: { id: true, firstName: true, lastName: true, employeeCode: true },
        },
        user: { select: { id: true, email: true, status: true, lastLoginAt: true } },
        costRates: { orderBy: { effectiveFrom: 'desc' } },
        salaries: { orderBy: { effectiveFrom: 'desc' } },
      },
    });

    if (!employee) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Employee not found.' });
    }

    const [projects, leaveBalances, attendance, hours] = await Promise.all([
      this.prisma.scoped.projectMember.findMany({
        where: { employeeId: id, project: { deletedAt: null, status: 'ACTIVE' } },
        select: {
          roleOnProject: true,
          project: {
            select: { id: true, projectCode: true, name: true, status: true, health: true },
          },
        },
      }),
      this.prisma.scoped.leaveBalance.findMany({
        where: { employeeId: id, year: new Date().getUTCFullYear() },
        include: { leaveType: { select: { id: true, name: true, shortCode: true } } },
      }),
      this.attendanceSummary(id),
      this.hoursSummary(id),
    ]);

    return {
      ...employee,
      fullName: `${employee.firstName} ${employee.lastName}`,
      hourlyRate: employee.costRates[0]?.hourlyRate ?? null,
      monthlyAmount: employee.salaries[0]?.monthlyAmount ?? null,
      projects: projects.map((p) => ({ ...p.project, roleOnProject: p.roleOnProject })),
      leaveBalances: leaveBalances.map((b) => ({
        leaveType: b.leaveType,
        // What is actually left to take, not the raw accrual.
        available: new Decimal(b.opening.toString())
          .plus(b.accrued.toString())
          .plus(b.carriedForward.toString())
          .minus(b.used.toString())
          .minus(b.pending.toString())
          .toFixed(2),
        used: b.used.toString(),
        pending: b.pending.toString(),
      })),
      attendanceSummary: attendance,
      hoursSummary: hours,
    };
  }

  /** Last 30 office-local days, grouped by status. */
  private async attendanceSummary(employeeId: string) {
    const from = new Date(Date.now() - 30 * 86_400_000);
    const rows = await this.prisma.scoped.attendanceRecord.groupBy({
      by: ['status'],
      where: { employeeId, attendanceDate: { gte: from } },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }

  private async hoursSummary(employeeId: string) {
    const [all, billable] = await Promise.all([
      this.prisma.scoped.timeEntry.aggregate({
        where: { employeeId, deletedAt: null },
        _sum: { hours: true },
      }),
      this.prisma.scoped.timeEntry.aggregate({
        where: { employeeId, deletedAt: null, isBillable: true },
        _sum: { hours: true },
      }),
    ]);
    return {
      totalHours: (all._sum.hours ?? new Decimal(0)).toString(),
      billableHours: (billable._sum.hours ?? new Decimal(0)).toString(),
    };
  }

  // -------------------------------------------------------------------------
  // Create & update
  // -------------------------------------------------------------------------

  async create(input: CreateEmployeeInput, user: AuthenticatedUser) {
    await this.assertCodeFree(input.employeeCode);
    await this.assertManagerIsNotSelfOrCycle(null, input.managerId ?? null);

    const { hourlyRate, monthlySalary, sendInvite, ...employeeData } = input;

    const employee = await this.prisma.scoped.$transaction(async (tx) => {
      const created = await tx.employee.create({
        data: {
          ...employeeData,
          personalEmail: employeeData.personalEmail || null,
          workEmail: employeeData.workEmail || null,
          joiningDate: d(input.joiningDate),
          exitDate: input.exitDate ? d(input.exitDate) : null,
          dateOfBirth: input.dateOfBirth ? d(input.dateOfBirth) : null,
          createdById: user.userId,
        } as never,
      });

      // An opening rate dated from the joining date, so any time logged from
      // day one is costable.
      if (hourlyRate) {
        await tx.employeeCostRate.create({
          data: {
            employeeId: created.id,
            hourlyRate,
            effectiveFrom: d(input.joiningDate),
            note: 'Initial rate',
            createdById: user.userId,
          } as never,
        });
      }
      if (monthlySalary) {
        await tx.employeeSalary.create({
          data: {
            employeeId: created.id,
            monthlyAmount: monthlySalary,
            effectiveFrom: d(input.joiningDate),
            note: 'On joining',
            createdById: user.userId,
          } as never,
        });
      }

      await this.audit.record(
        {
          action: 'CREATE',
          entityType: 'Employee',
          entityId: created.id,
          summary: `Added ${created.firstName} ${created.lastName} (${created.employeeCode})`,
          after: { ...employeeData, hourlyRate, monthlySalary },
          userId: user.userId,
        },
        tx,
      );

      return created;
    });

    if (sendInvite && input.workEmail) {
      await this.inviteEmployee(employee.id, user);
    }

    return this.findOne(employee.id, user);
  }

  async update(id: string, input: UpdateEmployeeInput, user: AuthenticatedUser) {
    const before = await this.requireEmployee(id);

    if (input.employeeCode && input.employeeCode !== before.employeeCode) {
      await this.assertCodeFree(input.employeeCode, id);
    }
    if (input.managerId !== undefined) {
      await this.assertManagerIsNotSelfOrCycle(id, input.managerId);
    }

    const after = await this.prisma.scoped.employee.update({
      where: { id },
      data: {
        ...input,
        ...(input.personalEmail !== undefined
          ? { personalEmail: input.personalEmail || null }
          : {}),
        ...(input.workEmail !== undefined ? { workEmail: input.workEmail || null } : {}),
        ...(input.joiningDate ? { joiningDate: d(input.joiningDate) } : {}),
        ...(input.exitDate !== undefined
          ? { exitDate: input.exitDate ? d(input.exitDate) : null }
          : {}),
        ...(input.dateOfBirth !== undefined
          ? { dateOfBirth: input.dateOfBirth ? d(input.dateOfBirth) : null }
          : {}),
      } as never,
    });

    await this.audit.recordChange({
      action: 'UPDATE',
      entityType: 'Employee',
      entityId: id,
      summary: `Updated ${after.firstName} ${after.lastName} (${after.employeeCode})`,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      fields: [
        'employeeCode',
        'firstName',
        'lastName',
        'workEmail',
        'phone',
        'joiningDate',
        'exitDate',
        'officeId',
        'departmentId',
        'designationId',
        'managerId',
        'attendanceMethod',
        'status',
      ],
      userId: user.userId,
    });

    return this.findOne(id, user);
  }

  /** Deactivate rather than delete: history must keep resolving. */
  async setStatus(id: string, status: string, user: AuthenticatedUser) {
    const before = await this.requireEmployee(id);

    const after = await this.prisma.scoped.employee.update({
      where: { id },
      data: {
        status: status as never,
        ...(status === 'EXITED' && !before.exitDate ? { exitDate: new Date() } : {}),
      },
    });

    // An exited employee must not keep a working login.
    if (status === 'EXITED' || status === 'INACTIVE') {
      if (before.userId) {
        await this.prisma.scoped.user.update({
          where: { id: before.userId },
          data: { status: 'SUSPENDED' },
        });
      }
    } else if (status === 'ACTIVE' && before.userId) {
      await this.prisma.scoped.user.updateMany({
        where: { id: before.userId, status: 'SUSPENDED' },
        data: { status: 'ACTIVE' },
      });
    }

    await this.audit.record({
      action: 'UPDATE',
      entityType: 'Employee',
      entityId: id,
      summary: `${after.firstName} ${after.lastName} set to ${status}`,
      before: { status: before.status },
      after: { status },
      userId: user.userId,
    });

    return after;
  }

  /** Creates the login if needed, then emails the invitation. */
  async inviteEmployee(id: string, actor: AuthenticatedUser) {
    const employee = await this.requireEmployee(id);

    if (!employee.workEmail) {
      throw new BadRequestException({
        code: 'NO_WORK_EMAIL',
        message: 'Add a work email before sending an invitation.',
      });
    }

    let userId = employee.userId;

    if (!userId) {
      // Email is globally unique, so a clash has to be reported clearly.
      const taken = await runUnscoped(() =>
        this.prisma.user.findFirst({ where: { email: employee.workEmail! } }),
      );
      if (taken) {
        throw new ConflictException({
          code: 'EMAIL_TAKEN',
          message: `${employee.workEmail} already has an account.`,
        });
      }

      const employeeRole = await this.prisma.scoped.role.findFirst({
        where: { systemKey: 'EMPLOYEE', deletedAt: null },
      });
      if (!employeeRole) {
        throw new BadRequestException({
          code: 'NO_DEFAULT_ROLE',
          message: 'No Employee role exists to assign. Create one in Roles & Permissions.',
        });
      }

      const created = await this.prisma.scoped.user.create({
        data: {
          email: employee.workEmail,
          fullName: `${employee.firstName} ${employee.lastName}`,
          roleId: employeeRole.id,
          status: 'INVITED',
          createdById: actor.userId,
        } as never,
      });
      userId = created.id;

      await this.prisma.scoped.employee.update({
        where: { id },
        data: { userId },
      });
    }

    await this.auth.sendInvite(userId, actor);
    return { userId, email: employee.workEmail };
  }

  // -------------------------------------------------------------------------
  // Cost rate & salary history
  // -------------------------------------------------------------------------

  async listCostRates(employeeId: string, user: AuthenticatedUser) {
    await this.assertVisible(employeeId, user);
    return this.prisma.scoped.employeeCostRate.findMany({
      where: { employeeId },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /**
   * Adds a rate effective from a date.
   *
   * Never an in-place edit: the cost ledger looks up the rate effective on the
   * work date, so overwriting history would silently restate posted cost. The
   * previous row is closed off at the new effective date instead.
   */
  async addCostRate(employeeId: string, input: CostRateInput, user: AuthenticatedUser) {
    const employee = await this.requireEmployee(employeeId);
    const effectiveFrom = d(input.effectiveFrom);

    const clash = await this.prisma.scoped.employeeCostRate.findFirst({
      where: { employeeId, effectiveFrom },
    });
    if (clash) {
      throw new ConflictException({
        code: 'DUPLICATE',
        message: `A rate already starts on ${input.effectiveFrom}. Edit that row instead.`,
      });
    }

    const created = await this.prisma.scoped.$transaction(async (tx) => {
      // Close the row immediately before this one, if any.
      const previous = await tx.employeeCostRate.findFirst({
        where: { employeeId, effectiveFrom: { lt: effectiveFrom } },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (previous) {
        await tx.employeeCostRate.update({
          where: { id: previous.id },
          data: { effectiveTo: effectiveFrom },
        });
      }

      // A rate inserted *between* two existing rows ends at the next one.
      const next = await tx.employeeCostRate.findFirst({
        where: { employeeId, effectiveFrom: { gt: effectiveFrom } },
        orderBy: { effectiveFrom: 'asc' },
      });

      const row = await tx.employeeCostRate.create({
        data: {
          employeeId,
          hourlyRate: input.hourlyRate,
          effectiveFrom,
          effectiveTo: next ? next.effectiveFrom : null,
          note: input.note ?? null,
          createdById: user.userId,
        } as never,
      });

      await this.audit.record(
        {
          action: 'UPDATE',
          entityType: 'EmployeeCostRate',
          entityId: row.id,
          summary: `Cost rate for ${employee.firstName} ${employee.lastName} set to ${input.hourlyRate} from ${input.effectiveFrom}`,
          before: previous
            ? { hourlyRate: previous.hourlyRate.toString(), effectiveFrom: previous.effectiveFrom }
            : null,
          after: { hourlyRate: input.hourlyRate, effectiveFrom: input.effectiveFrom },
          userId: user.userId,
        },
        tx,
      );

      return row;
    });

    // Cost already posted used the rate in force at the time; a backdated rate
    // does not retro-correct it. Say so rather than leaving it implicit.
    const postedAfter = await this.prisma.scoped.costLedgerEntry.count({
      where: { employeeId, postingDate: { gte: effectiveFrom }, isReversal: false },
    });

    return {
      ...created,
      warning:
        postedAfter > 0
          ? `${postedAfter} cost ledger entries already exist on or after ${input.effectiveFrom}. They keep the rate used at the time; reopen and re-approve those timesheets to restate them.`
          : null,
    };
  }

  async listSalaries(employeeId: string, user: AuthenticatedUser) {
    await this.assertVisible(employeeId, user);
    return this.prisma.scoped.employeeSalary.findMany({
      where: { employeeId },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async addSalary(employeeId: string, input: SalaryInput, user: AuthenticatedUser) {
    const employee = await this.requireEmployee(employeeId);
    const effectiveFrom = d(input.effectiveFrom);

    const clash = await this.prisma.scoped.employeeSalary.findFirst({
      where: { employeeId, effectiveFrom },
    });
    if (clash) {
      throw new ConflictException({
        code: 'DUPLICATE',
        message: `A salary already starts on ${input.effectiveFrom}.`,
      });
    }

    return this.prisma.scoped.$transaction(async (tx) => {
      const previous = await tx.employeeSalary.findFirst({
        where: { employeeId, effectiveFrom: { lt: effectiveFrom } },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (previous) {
        await tx.employeeSalary.update({
          where: { id: previous.id },
          data: { effectiveTo: effectiveFrom },
        });
      }
      const next = await tx.employeeSalary.findFirst({
        where: { employeeId, effectiveFrom: { gt: effectiveFrom } },
        orderBy: { effectiveFrom: 'asc' },
      });

      const row = await tx.employeeSalary.create({
        data: {
          employeeId,
          monthlyAmount: input.monthlyAmount,
          effectiveFrom,
          effectiveTo: next ? next.effectiveFrom : null,
          note: input.note ?? null,
          createdById: user.userId,
        } as never,
      });

      await this.audit.record(
        {
          action: 'UPDATE',
          entityType: 'EmployeeSalary',
          entityId: row.id,
          summary: `Salary for ${employee.firstName} ${employee.lastName} set from ${input.effectiveFrom}`,
          before: previous ? { monthlyAmount: previous.monthlyAmount.toString() } : null,
          after: { monthlyAmount: input.monthlyAmount, effectiveFrom: input.effectiveFrom },
          userId: user.userId,
        },
        tx,
      );

      return row;
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async currentRatesFor(employeeIds: string[]) {
    if (employeeIds.length === 0)
      return new Map<string, { hourlyRate: string; monthlyAmount: string | null }>();

    const today = new Date();
    const [rates, salaries] = await Promise.all([
      this.prisma.scoped.employeeCostRate.findMany({
        where: { employeeId: { in: employeeIds }, effectiveFrom: { lte: today } },
        orderBy: { effectiveFrom: 'desc' },
      }),
      this.prisma.scoped.employeeSalary.findMany({
        where: { employeeId: { in: employeeIds }, effectiveFrom: { lte: today } },
        orderBy: { effectiveFrom: 'desc' },
      }),
    ]);

    const map = new Map<string, { hourlyRate: string; monthlyAmount: string | null }>();
    for (const rate of rates) {
      // Ordered newest first, so the first one seen per employee is current.
      if (!map.has(rate.employeeId)) {
        map.set(rate.employeeId, { hourlyRate: rate.hourlyRate.toString(), monthlyAmount: null });
      }
    }
    for (const salary of salaries) {
      const entry = map.get(salary.employeeId);
      if (entry && entry.monthlyAmount === null) {
        entry.monthlyAmount = salary.monthlyAmount.toString();
      } else if (!entry) {
        map.set(salary.employeeId, {
          hourlyRate: '',
          monthlyAmount: salary.monthlyAmount.toString(),
        });
      }
    }
    return map;
  }

  private async requireEmployee(id: string) {
    const employee = await this.prisma.scoped.employee.findFirst({
      where: { id, deletedAt: null },
    });
    if (!employee) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Employee not found.' });
    }
    return employee;
  }

  /** Enforces the caller's data scope on a single record. */
  private async assertVisible(employeeId: string, user: AuthenticatedUser) {
    const scope = this.scope.scopeFor(user, 'employee.view');
    if (scope === DataScope.ALL) return;

    const visible = await this.scope.visibleEmployeeIds(user, scope);
    if (visible !== null && !visible.includes(employeeId)) {
      // Not "forbidden": a record outside your scope should not be shown to
      // exist at all.
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Employee not found.' });
    }
  }

  private async assertCodeFree(employeeCode: string, excludeId?: string) {
    const clash = await this.prisma.scoped.employee.findFirst({
      where: {
        employeeCode,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (clash) {
      throw new ConflictException({
        code: 'DUPLICATE',
        message: `Employee code ${employeeCode} is already used.`,
        details: { field: 'employeeCode' },
      });
    }
  }

  /**
   * Reporting lines must stay a tree. A cycle would make TEAM scope recurse
   * forever and the org chart meaningless.
   */
  private async assertManagerIsNotSelfOrCycle(employeeId: string | null, managerId: string | null) {
    if (!managerId) return;
    if (employeeId && managerId === employeeId) {
      throw new BadRequestException({
        code: 'INVALID_MANAGER',
        message: 'An employee cannot report to themselves.',
        details: { field: 'managerId' },
      });
    }
    if (!employeeId) return;

    let cursor: string | null = managerId;
    for (let depth = 0; cursor && depth < 20; depth += 1) {
      if (cursor === employeeId) {
        throw new BadRequestException({
          code: 'INVALID_MANAGER',
          message: 'That would create a loop in the reporting line.',
          details: { field: 'managerId' },
        });
      }
      const next: { managerId: string | null } | null = await this.prisma.scoped.employee.findFirst(
        {
          where: { id: cursor },
          select: { managerId: true },
        },
      );
      cursor = next?.managerId ?? null;
    }
  }
}
