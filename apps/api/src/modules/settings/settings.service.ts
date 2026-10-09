import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AttendancePolicyInput,
  DepartmentInput,
  DesignationInput,
  ExpenseCategoryInput,
  HolidayInput,
  LeaveTypeInput,
  ProjectTypeInput,
  SettingsListQuery,
  UpdateCompanyInput,
} from '@opsvera/shared';
import { PrismaService, type ScopedTx } from '../../prisma/prisma.service';
import { runUnscoped } from '../../prisma/tenant-context';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';

/**
 * Company setup: the reference data every other module depends on.
 *
 * Deletes here are deliberately conservative. A department with employees or a
 * project type with projects is not removed — it is deactivated, because the
 * history that points at it has to keep resolving.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Company
  // -------------------------------------------------------------------------

  async getCompany(user: AuthenticatedUser) {
    // The Company table is global to the extension, so it is read unscoped and
    // filtered by the id on the token.
    return runUnscoped(() =>
      this.prisma.company.findUniqueOrThrow({ where: { id: user.companyId } }),
    );
  }

  async updateCompany(input: UpdateCompanyInput, user: AuthenticatedUser) {
    const before = await this.getCompany(user);

    if (input.codePrefix !== before.codePrefix) {
      const clash = await runUnscoped(() =>
        this.prisma.company.findFirst({
          where: { codePrefix: input.codePrefix, id: { not: user.companyId } },
        }),
      );
      if (clash) {
        throw new ConflictException({
          code: 'DUPLICATE',
          message: `The prefix "${input.codePrefix}" is already taken.`,
        });
      }

      // Codes already issued keep the old prefix, so this only affects codes
      // minted from now on. Worth saying out loud rather than silently.
      const issued = await this.prisma.scoped.project.count();
      if (issued > 0) {
        await this.audit.record({
          action: 'UPDATE',
          entityType: 'Company',
          entityId: user.companyId,
          summary: `Code prefix changed from ${before.codePrefix} to ${input.codePrefix}; ${issued} existing project codes keep the old prefix`,
          userId: user.userId,
        });
      }
    }

    const updated = await runUnscoped(() =>
      this.prisma.company.update({
        where: { id: user.companyId },
        data: {
          ...input,
          email: input.email === '' ? null : input.email,
        },
      }),
    );

    await this.audit.recordChange({
      action: 'UPDATE',
      entityType: 'Company',
      entityId: user.companyId,
      summary: `Updated company profile`,
      before: before as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
      fields: [
        'name',
        'legalName',
        'codePrefix',
        'projectCodePattern',
        'fyStartMonth',
        'currency',
        'currencySymbol',
        'gstin',
        'city',
        'state',
        'country',
        'phone',
        'email',
      ],
      userId: user.userId,
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // Offices
  // -------------------------------------------------------------------------

  async listOffices(query: SettingsListQuery) {
    return this.paginate('office', query, {
      include: { _count: { select: { employees: true, projects: true } } },
      searchField: 'name',
    });
  }

  async getOffice(id: string) {
    const office = await this.prisma.scoped.office.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { employees: true, projects: true } } },
    });
    if (!office) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Office not found.' });
    return office;
  }

  async createOffice(input: Record<string, unknown>, user: AuthenticatedUser) {
    await this.assertUnique('office', 'shortCode', input.shortCode as string);

    const office = await this.prisma.scoped.office.create({
      data: { ...this.officeData(input), createdById: user.userId } as never,
    });

    await this.audit.record({
      action: 'CREATE',
      entityType: 'Office',
      entityId: office.id,
      summary: `Created office ${office.name} (${office.shortCode})`,
      after: input,
      userId: user.userId,
    });
    return office;
  }

  async updateOffice(id: string, input: Record<string, unknown>, user: AuthenticatedUser) {
    const before = await this.getOffice(id);

    if (input.shortCode && input.shortCode !== before.shortCode) {
      await this.assertUnique('office', 'shortCode', input.shortCode as string, id);
    }

    const after = await this.prisma.scoped.office.update({
      where: { id },
      data: this.officeData(input) as never,
    });

    await this.audit.recordChange({
      action: 'UPDATE',
      entityType: 'Office',
      entityId: id,
      summary: `Updated office ${after.name}`,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      // Time zone and weekly offs change how every attendance day is judged,
      // so they matter more than the address fields.
      fields: [
        'name',
        'shortCode',
        'timezone',
        'weeklyOffDays',
        'allowedIPs',
        'geofenceRadiusM',
        'requiresGps',
        'latitude',
        'longitude',
        'isActive',
      ],
      userId: user.userId,
    });
    return after;
  }

  async deleteOffice(id: string, user: AuthenticatedUser) {
    const office = await this.getOffice(id);

    if (office._count.employees > 0 || office._count.projects > 0) {
      throw new ConflictException({
        code: 'IN_USE',
        message: `${office.name} still has ${office._count.employees} employees and ${office._count.projects} projects. Deactivate it instead.`,
      });
    }

    await this.prisma.scoped.office.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.record({
      action: 'DELETE',
      entityType: 'Office',
      entityId: id,
      summary: `Deleted office ${office.name}`,
      before: { name: office.name, shortCode: office.shortCode },
      userId: user.userId,
    });
  }

  /** Normalises the JSON columns, which Prisma will not coerce for us. */
  private officeData(input: Record<string, unknown>) {
    const data: Record<string, unknown> = { ...input };
    if (input.weeklyOffDays !== undefined) {
      data.weeklyOffDays = [...new Set(input.weeklyOffDays as number[])].sort();
    }
    if (input.allowedIPs !== undefined) {
      data.allowedIPs = [...new Set(input.allowedIPs as string[])];
    }
    if (input.latitude !== undefined) {
      data.latitude = input.latitude === null ? null : String(input.latitude);
    }
    if (input.longitude !== undefined) {
      data.longitude = input.longitude === null ? null : String(input.longitude);
    }
    return data;
  }

  // -------------------------------------------------------------------------
  // Departments & designations
  // -------------------------------------------------------------------------

  async listDepartments(query: SettingsListQuery) {
    return this.paginate('department', query, {
      include: { _count: { select: { employees: true, designations: true } } },
      searchField: 'name',
    });
  }

  async createDepartment(input: DepartmentInput, user: AuthenticatedUser) {
    await this.assertUnique('department', 'name', input.name);
    const row = await this.prisma.scoped.department.create({
      data: { ...input, createdById: user.userId } as never,
    });
    await this.audit.record({
      action: 'CREATE',
      entityType: 'Department',
      entityId: row.id,
      summary: `Created department ${row.name}`,
      userId: user.userId,
    });
    return row;
  }

  async updateDepartment(id: string, input: Partial<DepartmentInput>, user: AuthenticatedUser) {
    const before = await this.requireRow('department', id);
    if (input.name && input.name !== before.name) {
      await this.assertUnique('department', 'name', input.name, id);
    }
    const after = await this.prisma.scoped.department.update({
      where: { id },
      data: input as never,
    });
    await this.audit.recordChange({
      action: 'UPDATE',
      entityType: 'Department',
      entityId: id,
      summary: `Updated department ${after.name}`,
      before: before as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      fields: ['name', 'shortCode', 'headEmployeeId', 'isActive'],
      userId: user.userId,
    });
    return after;
  }

  async deleteDepartment(id: string, user: AuthenticatedUser) {
    const row = await this.prisma.scoped.department.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { employees: true } } },
    });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Department not found.' });
    if (row._count.employees > 0) {
      throw new ConflictException({
        code: 'IN_USE',
        message: `${row._count.employees} employees are in ${row.name}. Move them first, or deactivate it.`,
      });
    }
    await this.prisma.scoped.department.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.record({
      action: 'DELETE',
      entityType: 'Department',
      entityId: id,
      summary: `Deleted department ${row.name}`,
      userId: user.userId,
    });
  }

  async listDesignations(query: SettingsListQuery) {
    return this.paginate('designation', query, {
      include: {
        department: { select: { id: true, name: true } },
        _count: { select: { employees: true } },
      },
      searchField: 'name',
    });
  }

  async createDesignation(input: DesignationInput, user: AuthenticatedUser) {
    await this.assertUnique('designation', 'name', input.name);
    const row = await this.prisma.scoped.designation.create({
      data: { ...input, createdById: user.userId } as never,
    });
    await this.audit.record({
      action: 'CREATE',
      entityType: 'Designation',
      entityId: row.id,
      summary: `Created designation ${row.name}`,
      userId: user.userId,
    });
    return row;
  }

  async updateDesignation(id: string, input: Partial<DesignationInput>, user: AuthenticatedUser) {
    const before = await this.requireRow('designation', id);
    if (input.name && input.name !== before.name) {
      await this.assertUnique('designation', 'name', input.name, id);
    }
    const after = await this.prisma.scoped.designation.update({
      where: { id },
      data: input as never,
    });
    await this.audit.recordChange({
      action: 'UPDATE',
      entityType: 'Designation',
      entityId: id,
      summary: `Updated designation ${after.name}`,
      before: before as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      fields: ['name', 'departmentId', 'level', 'isActive'],
      userId: user.userId,
    });
    return after;
  }

  async deleteDesignation(id: string, user: AuthenticatedUser) {
    const row = await this.prisma.scoped.designation.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { employees: true } } },
    });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Designation not found.' });
    if (row._count.employees > 0) {
      throw new ConflictException({
        code: 'IN_USE',
        message: `${row._count.employees} employees hold ${row.name}. Deactivate it instead.`,
      });
    }
    await this.prisma.scoped.designation.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.record({
      action: 'DELETE',
      entityType: 'Designation',
      entityId: id,
      summary: `Deleted designation ${row.name}`,
      userId: user.userId,
    });
  }

  // -------------------------------------------------------------------------
  // Project types
  // -------------------------------------------------------------------------

  async listProjectTypes(query: SettingsListQuery) {
    return this.paginate('projectType', query, {
      include: { _count: { select: { projects: true, bookings: true } } },
      searchField: 'name',
    });
  }

  async createProjectType(input: ProjectTypeInput, user: AuthenticatedUser) {
    await this.assertUnique('projectType', 'shortCode', input.shortCode);
    await this.assertUnique('projectType', 'name', input.name);
    const row = await this.prisma.scoped.projectType.create({
      data: { ...input, createdById: user.userId } as never,
    });
    await this.audit.record({
      action: 'CREATE',
      entityType: 'ProjectType',
      entityId: row.id,
      summary: `Created project type ${row.name} (${row.shortCode})`,
      userId: user.userId,
    });
    return row;
  }

  async updateProjectType(id: string, input: Partial<ProjectTypeInput>, user: AuthenticatedUser) {
    const before = await this.prisma.scoped.projectType.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { projects: true } } },
    });
    if (!before)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Project type not found.' });

    // The short code is baked into every code already issued, so changing it
    // would make existing codes unexplainable.
    if (input.shortCode && input.shortCode !== before.shortCode && before._count.projects > 0) {
      throw new BadRequestException({
        code: 'SHORT_CODE_LOCKED',
        message: `${before._count.projects} project codes already contain "${before.shortCode}". Create a new type instead of changing this one.`,
      });
    }
    if (input.shortCode && input.shortCode !== before.shortCode) {
      await this.assertUnique('projectType', 'shortCode', input.shortCode, id);
    }
    if (input.name && input.name !== before.name) {
      await this.assertUnique('projectType', 'name', input.name, id);
    }

    const after = await this.prisma.scoped.projectType.update({
      where: { id },
      data: input as never,
    });
    await this.audit.recordChange({
      action: 'UPDATE',
      entityType: 'ProjectType',
      entityId: id,
      summary: `Updated project type ${after.name}`,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      fields: ['name', 'shortCode', 'colorToken', 'isActive'],
      userId: user.userId,
    });
    return after;
  }

  async deleteProjectType(id: string, user: AuthenticatedUser) {
    const row = await this.prisma.scoped.projectType.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { projects: true, bookings: true } } },
    });
    if (!row)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Project type not found.' });
    if (row._count.projects > 0 || row._count.bookings > 0) {
      throw new ConflictException({
        code: 'IN_USE',
        message: `${row.name} is used by ${row._count.bookings} bookings and ${row._count.projects} projects. Deactivate it instead.`,
      });
    }
    await this.prisma.scoped.projectType.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.record({
      action: 'DELETE',
      entityType: 'ProjectType',
      entityId: id,
      summary: `Deleted project type ${row.name}`,
      userId: user.userId,
    });
  }

  // -------------------------------------------------------------------------
  // Holidays
  // -------------------------------------------------------------------------

  async listHolidays(query: { page: number; pageSize: number; officeId?: string; year?: number }) {
    const where: Prisma.HolidayWhereInput = {
      ...(query.officeId ? { officeId: query.officeId } : {}),
      ...(query.year
        ? {
            date: {
              gte: new Date(`${query.year}-01-01T00:00:00.000Z`),
              lte: new Date(`${query.year}-12-31T00:00:00.000Z`),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.scoped.holiday.findMany({
        where,
        include: { office: { select: { id: true, name: true, shortCode: true } } },
        orderBy: { date: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.scoped.holiday.count({ where }),
    ]);

    return { data, meta: this.meta(query.page, query.pageSize, total) };
  }

  /** One holiday across several offices becomes one row per office. */
  async createHoliday(input: HolidayInput, user: AuthenticatedUser) {
    const date = new Date(`${input.date}T00:00:00.000Z`);

    const existing = await this.prisma.scoped.holiday.findMany({
      where: { date, name: input.name, officeId: { in: input.officeIds } },
      select: { officeId: true },
    });
    const already = new Set(existing.map((e) => e.officeId));
    const toCreate = input.officeIds.filter((id) => !already.has(id));

    if (toCreate.length === 0) {
      throw new ConflictException({
        code: 'DUPLICATE',
        message: `"${input.name}" is already set for those offices on that date.`,
      });
    }

    await this.prisma.scoped.holiday.createMany({
      data: toCreate.map((officeId) => ({
        officeId,
        name: input.name,
        date,
        isOptional: input.isOptional ?? false,
        createdById: user.userId,
      })) as never,
    });

    await this.audit.record({
      action: 'CREATE',
      entityType: 'Holiday',
      summary: `Added holiday ${input.name} on ${input.date} for ${toCreate.length} office(s)`,
      after: input,
      userId: user.userId,
    });

    return { created: toCreate.length, skipped: already.size };
  }

  async deleteHoliday(id: string, user: AuthenticatedUser) {
    const row = await this.prisma.scoped.holiday.findFirst({ where: { id } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Holiday not found.' });

    await this.prisma.scoped.holiday.delete({ where: { id } });
    await this.audit.record({
      action: 'DELETE',
      entityType: 'Holiday',
      entityId: id,
      summary: `Removed holiday ${row.name} on ${row.date.toISOString().slice(0, 10)}`,
      userId: user.userId,
    });
  }

  // -------------------------------------------------------------------------
  // Attendance policies
  // -------------------------------------------------------------------------

  async listAttendancePolicies() {
    return this.prisma.scoped.attendancePolicy.findMany({
      include: {
        office: { select: { id: true, name: true } },
        shift: { select: { id: true, name: true } },
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async createAttendancePolicy(input: AttendancePolicyInput, user: AuthenticatedUser) {
    const row = await this.prisma.scoped.$transaction(async (tx) => {
      if (input.isDefault) await this.clearDefaultPolicy(tx);
      return tx.attendancePolicy.create({
        data: { ...this.policyData(input), createdById: user.userId } as never,
      });
    });

    await this.audit.record({
      action: 'CREATE',
      entityType: 'AttendancePolicy',
      entityId: row.id,
      summary: `Created attendance policy ${row.name}`,
      after: input,
      userId: user.userId,
    });
    return row;
  }

  async updateAttendancePolicy(id: string, input: AttendancePolicyInput, user: AuthenticatedUser) {
    const before = await this.prisma.scoped.attendancePolicy.findFirst({ where: { id } });
    if (!before) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Attendance policy not found.' });
    }

    const after = await this.prisma.scoped.$transaction(async (tx) => {
      if (input.isDefault && !before.isDefault) await this.clearDefaultPolicy(tx);
      return tx.attendancePolicy.update({ where: { id }, data: this.policyData(input) as never });
    });

    await this.audit.recordChange({
      action: 'UPDATE',
      entityType: 'AttendancePolicy',
      entityId: id,
      // Changing these re-judges every future attendance day, so the whole
      // numeric set is audited.
      summary: `Updated attendance policy ${after.name}`,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      fields: [
        'name',
        'officeId',
        'shiftId',
        'graceMinutes',
        'lateMarkAfterMinutes',
        'halfDayBelowHours',
        'fullDayMinimumHours',
        'overtimeAfterHours',
        'earlyExitBeforeMinutes',
        'lateMarksPerHalfDay',
        'isDefault',
        'isActive',
      ],
      userId: user.userId,
    });
    return after;
  }

  async deleteAttendancePolicy(id: string, user: AuthenticatedUser) {
    const row = await this.prisma.scoped.attendancePolicy.findFirst({ where: { id } });
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Attendance policy not found.' });
    }
    if (row.isDefault) {
      throw new BadRequestException({
        code: 'POLICY_IS_DEFAULT',
        message: 'Make another policy the default before deleting this one.',
      });
    }
    await this.prisma.scoped.attendancePolicy.delete({ where: { id } });
    await this.audit.record({
      action: 'DELETE',
      entityType: 'AttendancePolicy',
      entityId: id,
      summary: `Deleted attendance policy ${row.name}`,
      userId: user.userId,
    });
  }

  private policyData(input: AttendancePolicyInput) {
    return {
      ...input,
      halfDayBelowHours: input.halfDayBelowHours.toFixed(2),
      fullDayMinimumHours: input.fullDayMinimumHours.toFixed(2),
      overtimeAfterHours: input.overtimeAfterHours.toFixed(2),
    };
  }

  /** Only one policy may be the default, so the previous one is cleared first. */
  private async clearDefaultPolicy(tx: ScopedTx) {
    await tx.attendancePolicy.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
  }

  // -------------------------------------------------------------------------
  // Leave types
  // -------------------------------------------------------------------------

  async listLeaveTypes(query: SettingsListQuery) {
    return this.paginate('leaveType', query, {
      include: { _count: { select: { requests: true } } },
      searchField: 'name',
    });
  }

  async createLeaveType(input: LeaveTypeInput, user: AuthenticatedUser) {
    await this.assertUnique('leaveType', 'shortCode', input.shortCode);
    await this.assertUnique('leaveType', 'name', input.name);

    const row = await this.prisma.scoped.leaveType.create({
      data: { ...this.leaveTypeData(input), createdById: user.userId } as never,
    });
    await this.audit.record({
      action: 'CREATE',
      entityType: 'LeaveType',
      entityId: row.id,
      summary: `Created leave type ${row.name} (${row.shortCode})`,
      after: input,
      userId: user.userId,
    });
    return row;
  }

  async updateLeaveType(id: string, input: LeaveTypeInput, user: AuthenticatedUser) {
    const before = await this.requireRow('leaveType', id);
    if (input.shortCode !== before.shortCode) {
      await this.assertUnique('leaveType', 'shortCode', input.shortCode, id);
    }
    if (input.name !== before.name) {
      await this.assertUnique('leaveType', 'name', input.name, id);
    }

    const after = await this.prisma.scoped.leaveType.update({
      where: { id },
      data: this.leaveTypeData(input) as never,
    });
    await this.audit.recordChange({
      action: 'UPDATE',
      entityType: 'LeaveType',
      entityId: id,
      summary: `Updated leave type ${after.name}`,
      before: before as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      fields: [
        'name',
        'shortCode',
        'yearlyQuota',
        'carryForward',
        'maxCarryForward',
        'allowHalfDay',
        'isPaid',
        'approvalFlow',
        'isActive',
      ],
      userId: user.userId,
    });
    return after;
  }

  async deleteLeaveType(id: string, user: AuthenticatedUser) {
    const row = await this.prisma.scoped.leaveType.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { requests: true, balances: true } } },
    });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Leave type not found.' });
    if (row._count.requests > 0 || row._count.balances > 0) {
      throw new ConflictException({
        code: 'IN_USE',
        message: `${row.name} has ${row._count.requests} requests and ${row._count.balances} balances against it. Deactivate it instead.`,
      });
    }
    await this.prisma.scoped.leaveType.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.record({
      action: 'DELETE',
      entityType: 'LeaveType',
      entityId: id,
      summary: `Deleted leave type ${row.name}`,
      userId: user.userId,
    });
  }

  private leaveTypeData(input: LeaveTypeInput) {
    return {
      ...input,
      yearlyQuota: input.yearlyQuota.toFixed(2),
      maxCarryForward:
        input.maxCarryForward === null || input.maxCarryForward === undefined
          ? null
          : input.maxCarryForward.toFixed(2),
    };
  }

  // -------------------------------------------------------------------------
  // Expense categories
  // -------------------------------------------------------------------------

  async listExpenseCategories(query: SettingsListQuery) {
    return this.paginate('expenseCategory', query, {
      include: { _count: { select: { expenses: true } } },
      searchField: 'name',
    });
  }

  async createExpenseCategory(input: ExpenseCategoryInput, user: AuthenticatedUser) {
    await this.assertUnique('expenseCategory', 'name', input.name);
    const row = await this.prisma.scoped.expenseCategory.create({
      data: { ...input, createdById: user.userId } as never,
    });
    await this.audit.record({
      action: 'CREATE',
      entityType: 'ExpenseCategory',
      entityId: row.id,
      summary: `Created expense category ${row.name}`,
      userId: user.userId,
    });
    return row;
  }

  async updateExpenseCategory(
    id: string,
    input: Partial<ExpenseCategoryInput>,
    user: AuthenticatedUser,
  ) {
    const before = await this.requireRow('expenseCategory', id);
    if (input.name && input.name !== before.name) {
      await this.assertUnique('expenseCategory', 'name', input.name, id);
    }
    const after = await this.prisma.scoped.expenseCategory.update({
      where: { id },
      data: input as never,
    });
    await this.audit.recordChange({
      action: 'UPDATE',
      entityType: 'ExpenseCategory',
      entityId: id,
      summary: `Updated expense category ${after.name}`,
      before: before as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      fields: [
        'name',
        'shortCode',
        'perClaimLimit',
        'perMonthLimit',
        'requiresReceipt',
        'isActive',
      ],
      userId: user.userId,
    });
    return after;
  }

  async deleteExpenseCategory(id: string, user: AuthenticatedUser) {
    const row = await this.prisma.scoped.expenseCategory.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { expenses: true } } },
    });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Category not found.' });
    if (row._count.expenses > 0) {
      throw new ConflictException({
        code: 'IN_USE',
        message: `${row._count.expenses} expenses use ${row.name}. Deactivate it instead.`,
      });
    }
    await this.prisma.scoped.expenseCategory.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.record({
      action: 'DELETE',
      entityType: 'ExpenseCategory',
      entityId: id,
      summary: `Deleted expense category ${row.name}`,
      userId: user.userId,
    });
  }

  // -------------------------------------------------------------------------
  // Shared helpers
  // -------------------------------------------------------------------------

  private meta(page: number, pageSize: number, total: number) {
    return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  /** One paginated list implementation for the simple reference tables. */
  private async paginate(
    model:
      'office' | 'department' | 'designation' | 'projectType' | 'leaveType' | 'expenseCategory',
    query: SettingsListQuery,
    options: { include?: Record<string, unknown>; searchField: string },
  ) {
    const where: Record<string, unknown> = {
      deletedAt: null,
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.q ? { [options.searchField]: { contains: query.q } } : {}),
    };
    const [sortField, sortDirection] = (query.sort ?? `${options.searchField}:asc`).split(':');

    const delegate = this.prisma.scoped[model] as unknown as {
      findMany: (args: unknown) => Promise<unknown[]>;
      count: (args: unknown) => Promise<number>;
    };

    const [data, total] = await Promise.all([
      delegate.findMany({
        where,
        include: options.include,
        orderBy: { [sortField]: sortDirection as 'asc' | 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      delegate.count({ where }),
    ]);

    return { data, meta: this.meta(query.page, query.pageSize, total) };
  }

  private async requireRow(
    model: 'department' | 'designation' | 'leaveType' | 'expenseCategory',
    id: string,
  ): Promise<Record<string, unknown> & { name: string; shortCode?: string | null }> {
    const delegate = this.prisma.scoped[model] as unknown as {
      findFirst: (args: unknown) => Promise<(Record<string, unknown> & { name: string }) | null>;
    };
    const row = await delegate.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found.' });
    return row;
  }

  /**
   * Checks a per-company unique field before writing, so the user gets a clear
   * message instead of a raw constraint violation.
   */
  private async assertUnique(
    model:
      'office' | 'department' | 'designation' | 'projectType' | 'leaveType' | 'expenseCategory',
    field: string,
    value: string,
    excludeId?: string,
  ) {
    const delegate = this.prisma.scoped[model] as unknown as {
      findFirst: (args: unknown) => Promise<unknown | null>;
    };
    const clash = await delegate.findFirst({
      where: {
        [field]: value,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (clash) {
      throw new ConflictException({
        code: 'DUPLICATE',
        message: `"${value}" is already used by another record.`,
        details: { field },
      });
    }
  }
}
