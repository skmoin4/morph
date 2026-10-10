import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import {
  eachDate,
  REPORT_KEYS,
  round2,
  toOfficeDateString,
  type ReportKey,
  type ReportQuery,
} from '@opsvera/shared';
import { Clock } from '../../common/clock';
import { DataScopeService } from '../../common/scope/data-scope.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkloadService } from '../dashboard/workload.service';
import { monthStartOf } from '../dashboard/executive.service';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);
const num = (value: { toString(): string } | number | null | undefined) => Number(value ?? 0);
const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

/** More rows than this and the report says so instead of quietly cutting. */
export const REPORT_ROW_LIMIT = 5000;
/** Day-by-day reports get slow over very long ranges. */
const MAX_RANGE_DAYS = 366;

export type ColumnType = 'text' | 'number' | 'money' | 'hours' | 'percent' | 'date' | 'status';
export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}
export type ReportCell = string | number | null;
export type ReportRow = Record<string, ReportCell>;

export interface ReportResult {
  key: ReportKey;
  title: string;
  description: string;
  from: string;
  to: string;
  generatedAt: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Same keys as the columns; only the ones that add up have a value. */
  totals: ReportRow | null;
  /** True when the row limit cut the report short. */
  truncated: boolean;
}

type Filter = 'range' | 'office' | 'project' | 'employee' | 'status';

interface Definition {
  key: ReportKey;
  title: string;
  description: string;
  /** The module permission that decides who may run it. */
  permission: string;
  filters: Filter[];
  /** Status values the `status` filter accepts. */
  statuses?: string[];
}

const DEFINITIONS: Definition[] = [
  {
    key: 'bookings',
    title: 'Bookings',
    description: 'Every booking in the period, with its client, office and status.',
    permission: 'booking.view',
    filters: ['range', 'office', 'status'],
    statuses: ['DRAFT', 'CONFIRMED', 'PROJECT_CREATED', 'CANCELLED'],
  },
  {
    key: 'attendance',
    title: 'Attendance summary',
    description: 'Days present, late, absent and on leave for each person, with hours worked.',
    permission: 'attendance.view',
    filters: ['range', 'office', 'employee'],
  },
  {
    key: 'leave',
    title: 'Leave',
    description: 'Leave requests that fall in the period, and where each one stands.',
    permission: 'leave.view',
    filters: ['range', 'office', 'employee', 'status'],
    statuses: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
  },
  {
    key: 'timesheets',
    title: 'Hours by person',
    description: 'Hours logged by each person, split billable and non-billable.',
    permission: 'timesheet.view',
    filters: ['range', 'office', 'project', 'employee'],
  },
  {
    key: 'utilization',
    title: 'Utilization',
    description: 'Billable hours against the hours each person could have worked.',
    permission: 'timesheet.view',
    filters: ['range', 'office', 'employee'],
  },
  {
    key: 'project-cost',
    title: 'Project cost',
    description: 'Cost posted to each project in the period, labour and expenses.',
    permission: 'cost.view',
    filters: ['range', 'office', 'project'],
  },
  {
    key: 'expenses',
    title: 'Expenses',
    description: 'Expense claims in the period, by person, category and status.',
    permission: 'expense.view',
    filters: ['range', 'office', 'project', 'employee', 'status'],
    statuses: ['DRAFT', 'PENDING_MANAGER', 'PENDING_FINANCE', 'APPROVED', 'REJECTED'],
  },
];

interface Ctx {
  user: AuthenticatedUser;
  from: string;
  to: string;
  query: ReportQuery;
  can: (key: string) => boolean;
}
interface Built {
  columns: ReportColumn[];
  rows: ReportRow[];
  totals?: ReportRow | null;
}

const col = (key: string, label: string, type: ColumnType = 'text'): ReportColumn => ({
  key,
  label,
  type,
});

/**
 * The Reports engine.
 *
 * A report is a set of columns and rows, produced once and rendered two ways:
 * as JSON for the on-screen preview and as an Excel workbook. Both come from
 * the same `run()`, so the file is always exactly what the screen showed.
 *
 * Every report runs under the permission of the module it reports on and the
 * caller's data scope for it, and a column the caller may not see (contract
 * value, cost) is left out of the result entirely — not blanked — so it is
 * also absent from the export.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: DataScopeService,
    private readonly clock: Clock,
    private readonly workload: WorkloadService,
  ) {}

  /** The reports this person may run, with the filters each understands. */
  async catalog(user: AuthenticatedUser) {
    const offices = await this.prisma.scoped.office.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true, shortCode: true },
      orderBy: { name: 'asc' },
    });
    const reports = DEFINITIONS.filter((def) => user.permissions.has(def.permission)).map((def) => ({
      key: def.key,
      title: def.title,
      description: def.description,
      filters: def.filters,
      statuses: def.statuses ?? null,
    }));
    return { reports, offices };
  }

  async run(key: string, query: ReportQuery, user: AuthenticatedUser): Promise<ReportResult> {
    const def = DEFINITIONS.find((x) => x.key === key);
    if (!def || !(REPORT_KEYS as readonly string[]).includes(key)) {
      throw new NotFoundException({
        code: 'REPORT_NOT_FOUND',
        message: 'There is no such report.',
      });
    }
    // Reports the person cannot run are not revealed to exist.
    if (!user.permissions.has(def.permission)) {
      throw new NotFoundException({
        code: 'REPORT_NOT_FOUND',
        message: 'There is no such report.',
      });
    }
    if (def.statuses && query.status && !def.statuses.includes(query.status)) {
      throw new BadRequestException({
        code: 'INVALID_STATUS',
        message: `Status must be one of ${def.statuses.join(', ')}.`,
      });
    }

    const tz = await this.timeZone(user);
    const today = toOfficeDateString(this.clock.now(), tz);
    const from = query.from ?? monthStartOf(today);
    const to = query.to ?? today;
    if (eachDate(from, to).length > MAX_RANGE_DAYS) {
      throw new BadRequestException({
        code: 'RANGE_TOO_LONG',
        message: `Choose a period of at most ${MAX_RANGE_DAYS} days.`,
      });
    }

    const ctx: Ctx = { user, from, to, query, can: (k) => user.permissions.has(k) };
    const built = await this.build(def.key, ctx);
    const truncated = built.rows.length > REPORT_ROW_LIMIT;
    return {
      key: def.key,
      title: def.title,
      description: def.description,
      from,
      to,
      generatedAt: this.clock.now().toISOString(),
      columns: built.columns,
      rows: truncated ? built.rows.slice(0, REPORT_ROW_LIMIT) : built.rows,
      totals: built.totals ?? null,
      truncated,
    };
  }

  async export(key: string, query: ReportQuery, user: AuthenticatedUser) {
    const report = await this.run(key, query, user);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'OPSVERA';
    workbook.created = this.clock.now();
    const sheet = workbook.addWorksheet(report.title.slice(0, 31), {
      views: [{ state: 'frozen', ySplit: 3 }],
    });

    sheet.addRow([report.title]).font = { bold: true, size: 14 };
    sheet.addRow([`Period ${report.from} to ${report.to}`]);
    const header = sheet.addRow(report.columns.map((c) => c.label));
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF3FF' } };
    });

    report.columns.forEach((c, i) => {
      const column = sheet.getColumn(i + 1);
      column.width = Math.max(12, Math.min(40, c.label.length + 6));
      if (c.type === 'money') column.numFmt = '#,##0.00';
      if (c.type === 'hours') column.numFmt = '#,##0.00';
      if (c.type === 'percent') column.numFmt = '0.0';
    });
    sheet.getColumn(1).width = 30;

    for (const row of report.rows) sheet.addRow(report.columns.map((c) => row[c.key] ?? null));
    if (report.totals) {
      const total = sheet.addRow(report.columns.map((c) => report.totals?.[c.key] ?? null));
      total.font = { bold: true };
    }
    if (report.truncated) {
      sheet.addRow([`Cut at ${REPORT_ROW_LIMIT} rows. Narrow the period or filters for the rest.`]);
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { buffer, fileName: `report-${key}-${report.from}-to-${report.to}.xlsx` };
  }

  // ---------------------------------------------------------------------------

  private async timeZone(user: AuthenticatedUser): Promise<string> {
    if (!user.officeId) return 'Asia/Kolkata';
    const office = await this.prisma.scoped.office.findFirst({
      where: { id: user.officeId },
      select: { timezone: true },
    });
    return office?.timezone ?? 'Asia/Kolkata';
  }

  private build(key: ReportKey, ctx: Ctx): Promise<Built> {
    switch (key) {
      case 'bookings':
        return this.bookings(ctx);
      case 'attendance':
        return this.attendanceReport(ctx);
      case 'leave':
        return this.leave(ctx);
      case 'timesheets':
        return this.hours(ctx);
      case 'utilization':
        return this.utilization(ctx);
      case 'project-cost':
        return this.projectCost(ctx);
      case 'expenses':
        return this.expenses(ctx);
    }
  }

  /** Employee ids the caller may see for a permission, narrowed by the filters. */
  private async people(ctx: Ctx, permission: string): Promise<{ id: string }[]> {
    const reach = await this.scope.visibleEmployeeIds(
      ctx.user,
      this.scope.scopeFor(ctx.user, permission),
    );
    return this.prisma.scoped.employee.findMany({
      where: {
        deletedAt: null,
        ...(reach === null ? {} : { id: { in: reach } }),
        ...(ctx.query.officeId ? { officeId: ctx.query.officeId } : {}),
        ...(ctx.query.employeeId ? { id: ctx.query.employeeId } : {}),
      },
      select: { id: true },
    });
  }

  private async bookings(ctx: Ctx): Promise<Built> {
    const canValue = ctx.can('project.value.view');
    const where: Prisma.BookingWhereInput = {
      deletedAt: null,
      bookingDate: { gte: d(ctx.from), lte: d(ctx.to) },
      ...(ctx.query.officeId ? { officeId: ctx.query.officeId } : {}),
      ...(ctx.query.status ? { status: ctx.query.status as never } : {}),
    };
    const rows = await this.prisma.scoped.booking.findMany({
      where,
      orderBy: [{ bookingDate: 'asc' }, { bookingNumber: 'asc' }],
      take: REPORT_ROW_LIMIT + 1,
      include: {
        client: { select: { name: true } },
        office: { select: { shortCode: true } },
        projectType: { select: { name: true } },
      },
    });
    const columns = [
      col('bookingNumber', 'Booking'),
      col('bookingDate', 'Date', 'date'),
      col('client', 'Client'),
      col('projectName', 'Project'),
      col('projectType', 'Type'),
      col('office', 'Office'),
      col('status', 'Status', 'status'),
      col('projectCode', 'Project code'),
      col('budgetHours', 'Budget hours', 'hours'),
      ...(canValue ? [col('projectValue', 'Contract value (INR)', 'money')] : []),
    ];
    const data = rows.map((b) => ({
      bookingNumber: b.bookingNumber,
      bookingDate: iso(b.bookingDate),
      client: b.client.name,
      projectName: b.projectName,
      projectType: b.projectType.name,
      office: b.office.shortCode,
      status: b.status,
      projectCode: b.generatedProjectCode,
      budgetHours: num(b.budgetHours),
      ...(canValue ? { projectValue: num(b.projectValue) } : {}),
    }));
    return {
      columns,
      rows: data,
      totals: {
        bookingNumber: `${data.length} booking${data.length === 1 ? '' : 's'}`,
        budgetHours: round2(data.reduce((n, r) => n + r.budgetHours, 0)),
        ...(canValue
          ? { projectValue: round2(data.reduce((n, r) => n + (r.projectValue ?? 0), 0)) }
          : {}),
      },
    };
  }

  private async attendanceReport(ctx: Ctx): Promise<Built> {
    const people = await this.people(ctx, 'attendance.view');
    const records = await this.prisma.scoped.attendanceRecord.findMany({
      where: {
        employeeId: { in: people.map((p) => p.id) },
        attendanceDate: { gte: d(ctx.from), lte: d(ctx.to) },
      },
      select: {
        employeeId: true,
        status: true,
        isLate: true,
        isFlagged: true,
        workedMinutes: true,
        overtimeMinutes: true,
        lateMinutes: true,
      },
    });
    const employees = await this.prisma.scoped.employee.findMany({
      where: { id: { in: people.map((p) => p.id) } },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        office: { select: { shortCode: true } },
      },
      orderBy: { employeeCode: 'asc' },
    });
    const by = new Map<string, typeof records>();
    for (const r of records) by.set(r.employeeId, [...(by.get(r.employeeId) ?? []), r]);

    const rows = employees.map((e) => {
      const mine = by.get(e.id) ?? [];
      const count = (s: string) => mine.filter((r) => r.status === s).length;
      return {
        employeeCode: e.employeeCode,
        employee: `${e.firstName} ${e.lastName}`,
        office: e.office.shortCode,
        present: count('PRESENT') + count('LATE'),
        late: mine.filter((r) => r.isLate).length,
        halfDay: count('HALF_DAY'),
        absent: count('ABSENT'),
        onLeave: count('ON_LEAVE'),
        lateMinutes: mine.reduce((n, r) => n + r.lateMinutes, 0),
        workedHours: round2(mine.reduce((n, r) => n + r.workedMinutes, 0) / 60),
        overtimeHours: round2(mine.reduce((n, r) => n + r.overtimeMinutes, 0) / 60),
        flagged: mine.filter((r) => r.isFlagged).length,
      };
    });
    const sum = (k: keyof (typeof rows)[number]) =>
      round2(rows.reduce((n, r) => n + (r[k] as number), 0));
    return {
      columns: [
        col('employeeCode', 'Code'),
        col('employee', 'Employee'),
        col('office', 'Office'),
        col('present', 'Present days', 'number'),
        col('late', 'Late days', 'number'),
        col('halfDay', 'Half days', 'number'),
        col('absent', 'Absent days', 'number'),
        col('onLeave', 'Leave days', 'number'),
        col('lateMinutes', 'Late minutes', 'number'),
        col('workedHours', 'Worked hours', 'hours'),
        col('overtimeHours', 'Overtime hours', 'hours'),
        col('flagged', 'Flagged punches', 'number'),
      ],
      rows,
      totals: {
        employee: `${rows.length} people`,
        present: sum('present'),
        late: sum('late'),
        halfDay: sum('halfDay'),
        absent: sum('absent'),
        onLeave: sum('onLeave'),
        lateMinutes: sum('lateMinutes'),
        workedHours: sum('workedHours'),
        overtimeHours: sum('overtimeHours'),
        flagged: sum('flagged'),
      },
    };
  }

  private async leave(ctx: Ctx): Promise<Built> {
    const people = await this.people(ctx, 'leave.view');
    const requests = await this.prisma.scoped.leaveRequest.findMany({
      where: {
        employeeId: { in: people.map((p) => p.id) },
        // Any request that overlaps the period.
        fromDate: { lte: d(ctx.to) },
        toDate: { gte: d(ctx.from) },
        ...(ctx.query.status ? { status: ctx.query.status as never } : {}),
      },
      orderBy: [{ fromDate: 'asc' }],
      take: REPORT_ROW_LIMIT + 1,
      include: {
        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
        leaveType: { select: { name: true } },
      },
    });
    const rows = requests.map((l) => ({
      employeeCode: l.employee.employeeCode,
      employee: `${l.employee.firstName} ${l.employee.lastName}`,
      leaveType: l.leaveType.name,
      fromDate: iso(l.fromDate),
      toDate: iso(l.toDate),
      days: num(l.totalDays),
      status: l.status,
      reason: l.reason,
    }));
    return {
      columns: [
        col('employeeCode', 'Code'),
        col('employee', 'Employee'),
        col('leaveType', 'Leave type'),
        col('fromDate', 'From', 'date'),
        col('toDate', 'To', 'date'),
        col('days', 'Days', 'number'),
        col('status', 'Status', 'status'),
        col('reason', 'Reason'),
      ],
      rows,
      totals: {
        employee: `${rows.length} request${rows.length === 1 ? '' : 's'}`,
        days: round2(rows.reduce((n, r) => n + r.days, 0)),
      },
    };
  }

  private async hoursByPerson(ctx: Ctx) {
    const people = await this.people(ctx, 'timesheet.view');
    const projectReach = await this.scope.visibleProjectIds(
      ctx.user,
      this.scope.scopeFor(ctx.user, 'timesheet.view'),
    );
    const grouped = await this.prisma.scoped.timeEntry.groupBy({
      by: ['employeeId', 'isBillable'],
      where: {
        deletedAt: null,
        employeeId: { in: people.map((p) => p.id) },
        workDate: { gte: d(ctx.from), lte: d(ctx.to) },
        // A timer still running has no hours yet.
        OR: [{ source: 'MANUAL' }, { endedAt: { not: null } }],
        ...(ctx.query.projectId ? { projectId: ctx.query.projectId } : {}),
        ...(projectReach === null ? {} : { projectId: { in: projectReach } }),
      },
      _sum: { hours: true },
      _count: true,
    });
    return { people, grouped };
  }

  private async hours(ctx: Ctx): Promise<Built> {
    const { people, grouped } = await this.hoursByPerson(ctx);
    const employees = await this.prisma.scoped.employee.findMany({
      where: { id: { in: people.map((p) => p.id) } },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        office: { select: { shortCode: true } },
      },
      orderBy: { employeeCode: 'asc' },
    });
    const rows = employees
      .map((e) => {
        const mine = grouped.filter((g) => g.employeeId === e.id);
        const billable = num(mine.find((g) => g.isBillable)?._sum.hours);
        const non = num(mine.find((g) => !g.isBillable)?._sum.hours);
        return {
          employeeCode: e.employeeCode,
          employee: `${e.firstName} ${e.lastName}`,
          office: e.office.shortCode,
          entries: mine.reduce((n, g) => n + g._count, 0),
          billable: round2(billable),
          nonBillable: round2(non),
          total: round2(billable + non),
          billablePercent: pct(billable, billable + non),
        };
      })
      .filter((r) => r.total > 0 || !ctx.query.projectId);
    const billable = round2(rows.reduce((n, r) => n + r.billable, 0));
    const total = round2(rows.reduce((n, r) => n + r.total, 0));
    return {
      columns: [
        col('employeeCode', 'Code'),
        col('employee', 'Employee'),
        col('office', 'Office'),
        col('entries', 'Entries', 'number'),
        col('billable', 'Billable hours', 'hours'),
        col('nonBillable', 'Non-billable hours', 'hours'),
        col('total', 'Total hours', 'hours'),
        col('billablePercent', 'Billable %', 'percent'),
      ],
      rows,
      totals: {
        employee: `${rows.length} people`,
        entries: rows.reduce((n, r) => n + r.entries, 0),
        billable,
        nonBillable: round2(total - billable),
        total,
        billablePercent: pct(billable, total),
      },
    };
  }

  private async utilization(ctx: Ctx): Promise<Built> {
    const people = await this.people(ctx, 'timesheet.view');
    const employees = await this.prisma.scoped.employee.findMany({
      where: {
        id: { in: people.map((p) => p.id) },
        status: { in: ['ACTIVE', 'NOTICE_PERIOD'] },
      },
      select: {
        id: true,
        officeId: true,
        departmentId: true,
        joiningDate: true,
        exitDate: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        office: { select: { shortCode: true } },
      },
      orderBy: { employeeCode: 'asc' },
    });
    const load = await this.workload.measure(employees, ctx.from, ctx.to);
    const rows = employees.map((e) => {
      const w = load.perEmployee.get(e.id)!;
      return {
        employeeCode: e.employeeCode,
        employee: `${e.firstName} ${e.lastName}`,
        office: e.office.shortCode,
        capacity: round2(w.capacity),
        logged: round2(w.logged),
        billable: round2(w.billable),
        utilization: pct(w.billable, w.capacity),
        logging: pct(w.logged, w.capacity),
      };
    });
    return {
      columns: [
        col('employeeCode', 'Code'),
        col('employee', 'Employee'),
        col('office', 'Office'),
        col('capacity', 'Available hours', 'hours'),
        col('logged', 'Logged hours', 'hours'),
        col('billable', 'Billable hours', 'hours'),
        col('utilization', 'Utilization %', 'percent'),
        col('logging', 'Logged %', 'percent'),
      ],
      rows,
      totals: {
        employee: `${rows.length} people`,
        capacity: round2(load.capacityHours),
        logged: round2(load.loggedHours),
        billable: round2(load.billableHours),
        utilization: load.utilizationPercent,
        logging: load.loggedPercent,
      },
    };
  }

  private async projectCost(ctx: Ctx): Promise<Built> {
    const canValue = ctx.can('project.value.view');
    const reach = await this.scope.visibleProjectIds(
      ctx.user,
      this.scope.scopeFor(ctx.user, 'cost.view'),
    );
    const projects = await this.prisma.scoped.project.findMany({
      where: {
        deletedAt: null,
        ...(reach === null ? {} : { id: { in: reach } }),
        ...(ctx.query.officeId ? { officeId: ctx.query.officeId } : {}),
        ...(ctx.query.projectId ? { id: ctx.query.projectId } : {}),
      },
      select: {
        id: true,
        projectCode: true,
        name: true,
        status: true,
        budgetHours: true,
        projectValue: true,
        client: { select: { name: true } },
        office: { select: { shortCode: true } },
      },
      orderBy: { projectCode: 'asc' },
    });
    const entries = await this.prisma.scoped.costLedgerEntry.groupBy({
      by: ['projectId', 'sourceType'],
      where: {
        projectId: { in: projects.map((p) => p.id) },
        postingDate: { gte: d(ctx.from), lte: d(ctx.to) },
      },
      _sum: { amount: true, hours: true },
    });
    const rows = projects
      .map((p) => {
        const mine = entries.filter((e) => e.projectId === p.id);
        const sumOf = (t: string, f: 'amount' | 'hours') =>
          num(mine.find((e) => e.sourceType === t)?._sum[f]);
        const labour = sumOf('TIMESHEET', 'amount');
        const expense = sumOf('EXPENSE', 'amount');
        const adjustment = sumOf('ADJUSTMENT', 'amount');
        const hours = sumOf('TIMESHEET', 'hours') + sumOf('ADJUSTMENT', 'hours');
        return {
          projectCode: p.projectCode,
          project: p.name,
          client: p.client.name,
          office: p.office.shortCode,
          status: p.status,
          hours: round2(hours),
          labour: round2(labour),
          expense: round2(expense),
          adjustment: round2(adjustment),
          total: round2(labour + expense + adjustment),
          ...(canValue ? { contractValue: num(p.projectValue) } : {}),
        };
      })
      .filter((r) => r.total !== 0 || r.hours !== 0);
    const sum = (k: 'hours' | 'labour' | 'expense' | 'adjustment' | 'total') =>
      round2(rows.reduce((n, r) => n + r[k], 0));
    return {
      columns: [
        col('projectCode', 'Project code'),
        col('project', 'Project'),
        col('client', 'Client'),
        col('office', 'Office'),
        col('status', 'Status', 'status'),
        col('hours', 'Hours', 'hours'),
        col('labour', 'Labour (INR)', 'money'),
        col('expense', 'Expenses (INR)', 'money'),
        col('adjustment', 'Adjustments (INR)', 'money'),
        col('total', 'Total cost (INR)', 'money'),
        ...(canValue ? [col('contractValue', 'Contract value (INR)', 'money')] : []),
      ],
      rows,
      totals: {
        project: `${rows.length} project${rows.length === 1 ? '' : 's'}`,
        hours: sum('hours'),
        labour: sum('labour'),
        expense: sum('expense'),
        adjustment: sum('adjustment'),
        total: sum('total'),
      },
    };
  }

  private async expenses(ctx: Ctx): Promise<Built> {
    const people = await this.people(ctx, 'expense.view');
    const rows = await this.prisma.scoped.expense.findMany({
      where: {
        deletedAt: null,
        employeeId: { in: people.map((p) => p.id) },
        expenseDate: { gte: d(ctx.from), lte: d(ctx.to) },
        ...(ctx.query.projectId ? { projectId: ctx.query.projectId } : {}),
        ...(ctx.query.status ? { status: ctx.query.status as never } : {}),
      },
      orderBy: [{ expenseDate: 'asc' }],
      take: REPORT_ROW_LIMIT + 1,
      include: {
        employee: { select: { employeeCode: true, firstName: true, lastName: true } },
        category: { select: { name: true } },
        project: { select: { projectCode: true } },
      },
    });
    const data = rows.map((e) => ({
      expenseDate: iso(e.expenseDate),
      employeeCode: e.employee.employeeCode,
      employee: `${e.employee.firstName} ${e.employee.lastName}`,
      category: e.category.name,
      project: e.project?.projectCode ?? null,
      amount: num(e.amount),
      billable: e.isBillable ? 'Yes' : 'No',
      status: e.status,
      reimbursement: e.status === 'APPROVED' ? e.reimbursementStatus : null,
      overLimit: e.exceededLimit ? 'Yes' : 'No',
      description: e.description,
    }));
    return {
      columns: [
        col('expenseDate', 'Date', 'date'),
        col('employeeCode', 'Code'),
        col('employee', 'Employee'),
        col('category', 'Category'),
        col('project', 'Project'),
        col('amount', 'Amount (INR)', 'money'),
        col('billable', 'Billable'),
        col('status', 'Status', 'status'),
        col('reimbursement', 'Reimbursement', 'status'),
        col('overLimit', 'Over limit'),
        col('description', 'Description'),
      ],
      rows: data,
      totals: {
        employee: `${data.length} claim${data.length === 1 ? '' : 's'}`,
        amount: round2(data.reduce((n, r) => n + r.amount, 0)),
      },
    };
  }
}
