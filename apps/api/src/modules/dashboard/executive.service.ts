import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  addDays,
  alertLevelFor,
  burnPercent,
  round2,
  toOfficeDateString,
  weekStartOf,
  type DashboardQuery,
} from '@opsvera/shared';
import { Clock } from '../../common/clock';
import { DataScopeService } from '../../common/scope/data-scope.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { runUnscoped } from '../../prisma/tenant-context';
import { AttendanceService } from '../attendance/attendance.service';
import { WorkloadService } from './workload.service';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);
const num = (value: { toString(): string } | number | null | undefined) => Number(value ?? 0);
const fixed = (value: number) => round2(value).toFixed(2);
const pct = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

export interface ActionItem {
  id: string;
  /** high: needs a decision now; medium: needs attention soon; info: worth knowing. */
  severity: 'high' | 'medium' | 'info';
  kind: 'BUDGET' | 'BOOKING' | 'APPROVAL' | 'MILESTONE' | 'TIMESHEET' | 'PROJECT';
  title: string;
  detail: string;
  linkUrl: string;
  /** Days the thing has been waiting, when that is what makes it urgent. */
  ageDays: number | null;
}

/** First day of the month `offset` months from the one `date` is in. */
export function monthStartOf(date: string, offset = 0): string {
  const [y, m] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + offset, 1));
  return t.toISOString().slice(0, 10);
}

function monthLabel(start: string): string {
  return new Date(`${start}T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

/**
 * The Executive Command Center.
 *
 * One read of the whole business, built from the data every earlier step
 * writes: bookings, projects and their budgets, people and their time, the
 * approval queues, and the cost ledger. Nothing here is stored separately — it
 * is computed from the records, so it can never disagree with them.
 *
 * Each section appears only if the caller may see what it counts (a Finance
 * user gets the money sections but not attendance, and so on), and every count
 * is within the caller's data scope. Money fields carry the names the field
 * masking knows, so cost, margin and contract value disappear without the
 * matching permission even if a section slips through.
 */
@Injectable()
export class ExecutiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: DataScopeService,
    private readonly clock: Clock,
    private readonly workload: WorkloadService,
    private readonly attendance: AttendanceService,
  ) {}

  private async officeTimeZone(user: AuthenticatedUser, officeId?: string): Promise<string> {
    const id = officeId ?? user.officeId;
    if (!id) return 'Asia/Kolkata';
    const office = await this.prisma.scoped.office.findFirst({
      where: { id },
      select: { timezone: true },
    });
    return office?.timezone ?? 'Asia/Kolkata';
  }

  async executive(query: DashboardQuery, user: AuthenticatedUser) {
    const can = (key: string) => user.permissions.has(key);
    const now = this.clock.now();
    const tz = await this.officeTimeZone(user, query.officeId);
    const today = toOfficeDateString(now, tz);
    const monthStart = monthStartOf(today);
    const prevStart = monthStartOf(today, -1);
    const prevEnd = addDays(monthStart, -1);

    // What the caller's dashboard scope reaches.
    const dashScope = this.scope.scopeFor(user, 'dashboard.view');
    const employeeReach = await this.scope.visibleEmployeeIds(user, dashScope);
    const projectReach = await this.scope.visibleProjectIds(user, dashScope);

    const officeFilter = query.officeId ? { officeId: query.officeId } : {};
    const employeeWhere: Prisma.EmployeeWhereInput = {
      deletedAt: null,
      status: { in: ['ACTIVE', 'NOTICE_PERIOD'] },
      ...(employeeReach === null ? {} : { id: { in: employeeReach } }),
      ...officeFilter,
    };
    const projectWhere: Prisma.ProjectWhereInput = {
      deletedAt: null,
      ...(projectReach === null ? {} : { id: { in: projectReach } }),
      ...officeFilter,
    };
    const people = (employeeReach === null ? {} : { employeeId: { in: employeeReach } }) as Record<
      string,
      unknown
    >;
    const peopleInOffice = query.officeId ? { employee: { officeId: query.officeId } } : {};

    const [office, offices] = await Promise.all([
      query.officeId
        ? this.prisma.scoped.office.findFirst({
            where: { id: query.officeId },
            select: { id: true, name: true, shortCode: true },
          })
        : null,
      this.prisma.scoped.office.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, name: true, shortCode: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const [bookingBlock, projectBlock, peopleBlock, approvals, money, charts] = await Promise.all([
      can('booking.view') ? this.bookings(user, today, monthStart, query.officeId) : null,
      can('project.view') ? this.projects(projectWhere, today) : null,
      can('employee.view') || can('attendance.view') || can('timesheet.view')
        ? this.peopleAndWork(user, query, employeeWhere, today, monthStart, prevStart, prevEnd)
        : null,
      this.approvalCounts(user, people, peopleInOffice),
      can('expense.view') || can('cost.view')
        ? this.money(user, people, peopleInOffice, projectWhere, monthStart, prevStart, prevEnd)
        : null,
      this.charts(user, projectWhere, today, query.officeId),
    ]);

    const actions = await this.actions(user, {
      today,
      projects: projectBlock?.watch ?? [],
      bookings: bookingBlock,
      approvals,
      projectWhere,
      employeeWhere,
      people,
      peopleInOffice,
    });

    const marginBlock =
      projectBlock && can('cost.view') && can('margin.view')
        ? {
            amount: projectBlock.marginAmount,
            value: projectBlock.contractValue,
            cost: projectBlock.activeCost,
            percent: projectBlock.marginPercent,
          }
        : null;

    return {
      asOf: now.toISOString(),
      today,
      monthStart,
      monthLabel: monthLabel(monthStart),
      office,
      offices,
      kpis: {
        booked: bookingBlock?.booked ?? null,
        activeProjects: projectBlock
          ? { count: projectBlock.activeCount, attention: projectBlock.attentionCount }
          : null,
        utilization: peopleBlock?.utilization ?? null,
        approvals,
        budget: projectBlock ? { over: projectBlock.over, near: projectBlock.near } : null,
        margin: marginBlock,
      },
      lifecycle:
        bookingBlock && projectBlock
          ? { ...bookingBlock.lifecycle, scheduled: projectBlock.scheduled }
          : null,
      portfolio: projectBlock?.portfolio ?? null,
      actions,
      work: peopleBlock ? { attendance: peopleBlock.attendance, hours: peopleBlock.hours } : null,
      money,
      charts,
    };
  }

  // -------------------------------------------------------------------------
  // Bookings
  // -------------------------------------------------------------------------

  private async companyRow(companyId: string) {
    return runUnscoped(() =>
      this.prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { fyStartMonth: true, verbalEmailGraceDays: true },
      }),
    );
  }

  private async bookings(
    user: AuthenticatedUser,
    today: string,
    monthStart: string,
    officeId?: string,
  ) {
    const company = await this.companyRow(user.companyId);
    const live: Prisma.BookingWhereInput = { deletedAt: null, ...(officeId ? { officeId } : {}) };
    const fyStart = this.financialYearStart(today, company.fyStartMonth);

    const [monthAgg, draft, awaitingApproval, confirmedMonth, codesFy, verbal] = await Promise.all([
      this.prisma.scoped.booking.aggregate({
        where: {
          ...live,
          status: { in: ['CONFIRMED', 'PROJECT_CREATED'] },
          bookingDate: { gte: d(monthStart), lte: d(today) },
        },
        _count: true,
        _sum: { projectValue: true },
      }),
      this.prisma.scoped.booking.count({ where: { ...live, status: 'DRAFT' } }),
      this.prisma.scoped.booking.count({
        where: { ...live, status: 'CONFIRMED', approvalStatus: 'PENDING' },
      }),
      this.prisma.scoped.booking.count({
        where: {
          ...live,
          status: { in: ['CONFIRMED', 'PROJECT_CREATED'] },
          bookingDate: { gte: d(monthStart), lte: d(today) },
        },
      }),
      this.prisma.scoped.booking.count({
        where: {
          ...live,
          status: 'PROJECT_CREATED',
          bookingDate: { gte: d(fyStart), lte: d(today) },
        },
      }),
      this.prisma.scoped.booking.findMany({
        where: {
          ...live,
          status: { not: 'CANCELLED' },
          confirmation: { type: 'VERBAL', emailDocumentId: null },
        },
        select: {
          id: true,
          projectName: true,
          bookingNumber: true,
          confirmation: { select: { confirmedOn: true } },
        },
      }),
    ]);

    const grace = company.verbalEmailGraceDays;
    const overdue =
      grace > 0
        ? verbal.filter((v) => {
            const on = v.confirmation?.confirmedOn;
            return on && (Date.parse(`${today}T00:00:00Z`) - on.getTime()) / 86_400_000 > grace;
          })
        : [];

    return {
      booked: {
        count: monthAgg._count,
        // Masked unless the caller holds project.value.view.
        projectValue: fixed(num(monthAgg._sum.projectValue)),
      },
      lifecycle: {
        draft,
        awaitingApproval,
        confirmedThisMonth: confirmedMonth,
        verbalEmailPending: verbal.length,
        verbalEmailOverdue: overdue.length,
        codesThisYear: codesFy,
      },
      overdueVerbal: overdue.map((v) => ({
        id: v.id,
        name: v.projectName,
        number: v.bookingNumber,
      })),
    };
  }

  /** Start of the company's current financial year, as a date. */
  private financialYearStart(today: string, startMonth: number): string {
    const [y, m] = today.split('-').map(Number);
    const year = m >= startMonth ? y : y - 1;
    return `${year}-${String(startMonth).padStart(2, '0')}-01`;
  }

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  private async projects(where: Prisma.ProjectWhereInput, today: string) {
    const rows = await this.prisma.scoped.project.findMany({
      where: { ...where, status: 'ACTIVE' },
      include: {
        client: { select: { name: true } },
        projectManager: { select: { firstName: true, lastName: true } },
        members: { where: { leftOn: null }, select: { id: true } },
        _count: { select: { milestones: true, tasks: true } },
      },
    });
    const ids = rows.map((r) => r.id);
    const taskStats = ids.length
      ? await this.prisma.scoped.task.groupBy({
          by: ['projectId', 'status'],
          where: { projectId: { in: ids }, deletedAt: null },
          _count: true,
        })
      : [];
    const tasks = new Map<string, { total: number; done: number }>();
    for (const t of taskStats) {
      const row = tasks.get(t.projectId) ?? { total: 0, done: 0 };
      row.total += t._count;
      if (t.status === 'DONE') row.done += t._count;
      tasks.set(t.projectId, row);
    }

    let over = 0;
    let near = 0;
    let attention = 0;
    let contractValue = 0;
    let activeCost = 0;
    let scheduled = 0;
    const portfolio = rows.map((p) => {
      const burn = burnPercent(num(p.actualHours), num(p.budgetHours));
      const level = alertLevelFor(burn);
      if (level === 100) over += 1;
      else if (level === 80) near += 1;
      if (p.health !== 'HEALTHY') attention += 1;
      const value = num(p.projectValue);
      const cost = num(p.actualTotalCost);
      contractValue += value;
      activeCost += cost;
      if (p.members.length > 0 && (p._count.milestones > 0 || p._count.tasks > 0)) scheduled += 1;
      const t = tasks.get(p.id) ?? { total: 0, done: 0 };
      return {
        id: p.id,
        projectCode: p.projectCode,
        name: p.name,
        client: p.client.name,
        manager: p.projectManager
          ? `${p.projectManager.firstName} ${p.projectManager.lastName}`
          : null,
        health: p.health,
        alertLevel: level,
        burnPercent: burn,
        budgetHours: num(p.budgetHours),
        actualHours: round2(num(p.actualHours)),
        taskProgress: t.total > 0 ? Math.round((t.done / t.total) * 100) : null,
        taskCount: t.total,
        endDate: p.endDate ? iso(p.endDate) : null,
        daysToEnd: p.endDate
          ? Math.round((p.endDate.getTime() - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
          : null,
        actualTotalCost: fixed(cost),
        marginAmount: fixed(value - cost),
        marginPercent: value > 0 ? Math.round(((value - cost) / value) * 1000) / 10 : null,
      };
    });

    // The ones needing a look first: furthest over budget, then least healthy.
    const severity = (h: string) => (h === 'CRITICAL' ? 2 : h === 'AT_RISK' ? 1 : 0);
    portfolio.sort(
      (a, b) =>
        b.alertLevel - a.alertLevel ||
        severity(b.health) - severity(a.health) ||
        (b.burnPercent ?? -1) - (a.burnPercent ?? -1) ||
        a.projectCode.localeCompare(b.projectCode),
    );

    return {
      activeCount: rows.length,
      attentionCount: attention,
      over,
      near,
      scheduled: { scheduled, active: rows.length, unscheduled: rows.length - scheduled },
      contractValue,
      activeCost,
      marginAmount: fixed(contractValue - activeCost),
      marginPercent:
        contractValue > 0
          ? Math.round(((contractValue - activeCost) / contractValue) * 1000) / 10
          : null,
      portfolio: portfolio.slice(0, 8),
      watch: portfolio.filter((p) => p.alertLevel > 0),
    };
  }

  // -------------------------------------------------------------------------
  // People and work
  // -------------------------------------------------------------------------

  private async peopleAndWork(
    user: AuthenticatedUser,
    query: DashboardQuery,
    employeeWhere: Prisma.EmployeeWhereInput,
    today: string,
    monthStart: string,
    prevStart: string,
    prevEnd: string,
  ) {
    const can = (key: string) => user.permissions.has(key);
    const employees = await this.prisma.scoped.employee.findMany({
      where: employeeWhere,
      select: { id: true, officeId: true, departmentId: true, joiningDate: true, exitDate: true },
    });

    const weekStart = weekStartOf(today);
    const [mtd, previous, week, todayLogged] = can('timesheet.view')
      ? await Promise.all([
          this.workload.measure(employees, monthStart, today),
          this.workload.measure(employees, prevStart, prevEnd),
          this.workload.measure(employees, weekStart, today),
          this.prisma.scoped.timeEntry.aggregate({
            where: {
              employeeId: { in: employees.map((e) => e.id) },
              workDate: d(today),
              deletedAt: null,
              OR: [{ source: 'MANUAL' }, { endedAt: { not: null } }],
            },
            _sum: { hours: true },
          }),
        ])
      : [null, null, null, null];

    const utilization = mtd
      ? {
          percent: mtd.utilizationPercent,
          previousPercent: previous?.utilizationPercent ?? null,
          deltaPoints:
            mtd.utilizationPercent !== null && previous?.utilizationPercent != null
              ? Math.round((mtd.utilizationPercent - previous.utilizationPercent) * 10) / 10
              : null,
          capacityHours: mtd.capacityHours,
          billableHours: mtd.billableHours,
          loggedHours: mtd.loggedHours,
          people: employees.length,
        }
      : null;

    let attendance: {
      date: string;
      expected: number;
      present: number;
      presentPercent: number | null;
      late: number;
      onLeave: number;
      absent: number;
      notIn: number;
      flagged: number;
      clockedIn: number;
    } | null = null;
    if (can('attendance.view')) {
      const board = await this.attendance.board(
        { page: 1, pageSize: 1, officeId: query.officeId } as never,
        user,
      );
      const s = board.summary;
      const expected = s.total - s.holiday - s.weeklyOff;
      const present = s.present + s.late + s.halfDay;
      attendance = {
        date: board.date,
        expected,
        present,
        presentPercent: pct(present, expected),
        late: s.late,
        onLeave: s.onLeave,
        absent: s.absent,
        notIn: s.notIn,
        flagged: s.flagged,
        clockedIn: s.clockedIn,
      };
    }

    const hours =
      week && todayLogged
        ? {
            todayLogged: round2(num(todayLogged._sum.hours)),
            weekLogged: week.loggedHours,
            weekBillable: week.billableHours,
            weekCapacity: week.capacityHours,
            weekBillablePercent: pct(week.billableHours, week.loggedHours),
            // Capacity that nobody logged against, so far this week.
            weekUnlogged: round2(Math.max(0, week.capacityHours - week.loggedHours)),
          }
        : null;

    return { utilization, attendance, hours };
  }

  // -------------------------------------------------------------------------
  // Approvals
  // -------------------------------------------------------------------------

  private async approvalCounts(
    user: AuthenticatedUser,
    people: Record<string, unknown>,
    peopleInOffice: Record<string, unknown>,
  ) {
    const can = (key: string) => user.permissions.has(key);
    const [timesheets, leave, expenses, regularisations] = await Promise.all([
      can('timesheet.view')
        ? this.prisma.scoped.timesheet.count({
            where: { status: 'SUBMITTED', ...people, ...peopleInOffice },
          })
        : 0,
      can('leave.view')
        ? this.prisma.scoped.leaveRequest.count({
            where: { status: 'PENDING', ...people, ...peopleInOffice },
          })
        : 0,
      can('expense.view')
        ? this.prisma.scoped.expense.groupBy({
            by: ['status'],
            where: {
              status: { in: ['PENDING_MANAGER', 'PENDING_FINANCE'] },
              deletedAt: null,
              ...people,
              ...peopleInOffice,
            },
            _count: true,
            _sum: { amount: true },
          })
        : [],
      can('attendance.view')
        ? this.prisma.scoped.regularisationRequest.count({
            where: { status: 'PENDING', ...people, ...peopleInOffice },
          })
        : 0,
    ]);
    const expenseCount = expenses.reduce((a, g) => a + g._count, 0);
    return {
      total: timesheets + leave + expenseCount + regularisations,
      timesheets,
      leave,
      expenses: expenseCount,
      expensesAmount: fixed(expenses.reduce((a, g) => a + num(g._sum.amount), 0)),
      regularisations,
    };
  }

  // -------------------------------------------------------------------------
  // Money
  // -------------------------------------------------------------------------

  private async money(
    user: AuthenticatedUser,
    people: Record<string, unknown>,
    peopleInOffice: Record<string, unknown>,
    projectWhere: Prisma.ProjectWhereInput,
    monthStart: string,
    prevStart: string,
    prevEnd: string,
  ) {
    const can = (key: string) => user.permissions.has(key);
    const expenseWhere = { deletedAt: null, ...people, ...peopleInOffice };

    const expenses = can('expense.view')
      ? await (async () => {
          const [mgr, fin, unpaid] = await Promise.all([
            this.prisma.scoped.expense.aggregate({
              where: { ...expenseWhere, status: 'PENDING_MANAGER' },
              _count: true,
              _sum: { amount: true },
            }),
            this.prisma.scoped.expense.aggregate({
              where: { ...expenseWhere, status: 'PENDING_FINANCE' },
              _count: true,
              _sum: { amount: true },
            }),
            this.prisma.scoped.expense.aggregate({
              where: { ...expenseWhere, status: 'APPROVED', reimbursementStatus: 'PENDING' },
              _count: true,
              _sum: { amount: true },
            }),
          ]);
          return {
            awaitingManager: { count: mgr._count, amount: fixed(num(mgr._sum.amount)) },
            awaitingFinance: { count: fin._count, amount: fixed(num(fin._sum.amount)) },
            toReimburse: { count: unpaid._count, amount: fixed(num(unpaid._sum.amount)) },
          };
        })()
      : null;

    const cost = can('cost.view')
      ? await (async () => {
          const projectIds = (
            await this.prisma.scoped.project.findMany({ where: projectWhere, select: { id: true } })
          ).map((p) => p.id);
          const rows = await this.prisma.scoped.costLedgerEntry.findMany({
            where: { projectId: { in: projectIds }, postingDate: { gte: d(prevStart) } },
            select: { postingDate: true, amount: true, sourceType: true, hours: true },
          });
          const sum = (from: string, to: string) => {
            let labour = 0;
            let expense = 0;
            for (const r of rows) {
              const date = iso(r.postingDate);
              if (date < from || date > to) continue;
              const labourRow =
                r.sourceType === 'TIMESHEET' || (r.sourceType === 'ADJUSTMENT' && r.hours !== null);
              if (labourRow) labour += num(r.amount);
              else expense += num(r.amount);
            }
            return { labour, expense, total: labour + expense };
          };
          const now = sum(monthStart, '9999-12-31');
          const before = sum(prevStart, prevEnd);
          return {
            thisMonth: {
              labour: fixed(now.labour),
              expense: fixed(now.expense),
              total: fixed(now.total),
            },
            lastMonth: { total: fixed(before.total) },
          };
        })()
      : null;

    return { expenses, cost };
  }

  // -------------------------------------------------------------------------
  // Charts
  // -------------------------------------------------------------------------

  private async charts(
    user: AuthenticatedUser,
    projectWhere: Prisma.ProjectWhereInput,
    today: string,
    officeId?: string,
  ) {
    const can = (key: string) => user.permissions.has(key);
    const months = Array.from({ length: 6 }, (_, i) => monthStartOf(today, i - 5));
    const rangeStart = months[0];

    const projects = can('cost.view')
      ? await this.prisma.scoped.project.findMany({
          where: { ...projectWhere, status: { in: ['ACTIVE', 'ON_HOLD'] } },
          select: {
            id: true,
            projectCode: true,
            name: true,
            actualLabourCost: true,
            actualExpenseCost: true,
            actualTotalCost: true,
          },
          orderBy: { actualTotalCost: 'desc' },
          take: 8,
        })
      : [];

    const costByMonth = can('cost.view')
      ? await (async () => {
          const ids = (
            await this.prisma.scoped.project.findMany({ where: projectWhere, select: { id: true } })
          ).map((p) => p.id);
          const rows = await this.prisma.scoped.costLedgerEntry.findMany({
            where: { projectId: { in: ids }, postingDate: { gte: d(rangeStart) } },
            select: { postingDate: true, amount: true, sourceType: true, hours: true },
          });
          return months.map((m) => {
            let labour = 0;
            let expense = 0;
            for (const r of rows) {
              if (monthStartOf(iso(r.postingDate)) !== m) continue;
              const labourRow =
                r.sourceType === 'TIMESHEET' || (r.sourceType === 'ADJUSTMENT' && r.hours !== null);
              if (labourRow) labour += num(r.amount);
              else expense += num(r.amount);
            }
            return {
              month: m,
              label: monthLabel(m),
              actualLabourCost: fixed(labour),
              actualExpenseCost: fixed(expense),
            };
          });
        })()
      : null;

    const bookingsByMonth = can('booking.view')
      ? await (async () => {
          const rows = await this.prisma.scoped.booking.findMany({
            where: {
              deletedAt: null,
              status: { in: ['CONFIRMED', 'PROJECT_CREATED'] },
              bookingDate: { gte: d(rangeStart), lte: d(today) },
              ...(officeId ? { officeId } : {}),
            },
            select: { bookingDate: true, projectValue: true },
          });
          return months.map((m) => {
            const inMonth = rows.filter((r) => monthStartOf(iso(r.bookingDate)) === m);
            return {
              month: m,
              label: monthLabel(m),
              count: inMonth.length,
              projectValue: fixed(inMonth.reduce((a, r) => a + num(r.projectValue), 0)),
            };
          });
        })()
      : null;

    return {
      costByProject: can('cost.view')
        ? projects.map((p) => ({
            id: p.id,
            projectCode: p.projectCode,
            name: p.name,
            actualLabourCost: fixed(num(p.actualLabourCost)),
            actualExpenseCost: fixed(num(p.actualExpenseCost)),
            actualTotalCost: fixed(num(p.actualTotalCost)),
          }))
        : null,
      costByMonth,
      bookingsByMonth,
    };
  }

  // -------------------------------------------------------------------------
  // Action Center: only what needs a management decision
  // -------------------------------------------------------------------------

  private async actions(
    user: AuthenticatedUser,
    ctx: {
      today: string;
      projects: Array<{
        id: string;
        projectCode: string;
        alertLevel: number;
        burnPercent: number | null;
        actualHours: number;
        budgetHours: number;
      }>;
      bookings: Awaited<ReturnType<ExecutiveService['bookings']>> | null;
      approvals: Awaited<ReturnType<ExecutiveService['approvalCounts']>>;
      projectWhere: Prisma.ProjectWhereInput;
      employeeWhere: Prisma.EmployeeWhereInput;
      people: Record<string, unknown>;
      peopleInOffice: Record<string, unknown>;
    },
  ): Promise<ActionItem[]> {
    const can = (key: string) => user.permissions.has(key);
    const items: ActionItem[] = [];
    const todayMs = Date.parse(`${ctx.today}T00:00:00Z`);
    const ageOf = (date: Date | null) =>
      date ? Math.max(0, Math.floor((todayMs - date.getTime()) / 86_400_000)) : null;

    // Budgets
    if (can('cost.view') || can('project.view')) {
      for (const p of ctx.projects) {
        items.push({
          id: `budget:${p.id}`,
          severity: p.alertLevel === 100 ? 'high' : 'medium',
          kind: 'BUDGET',
          title:
            p.alertLevel === 100
              ? `${p.projectCode} is over its hours budget`
              : `${p.projectCode} is nearing its hours budget`,
          detail: `${p.actualHours.toLocaleString('en-IN')} of ${p.budgetHours.toLocaleString('en-IN')} budgeted hours used (${p.burnPercent}%). ${p.alertLevel === 100 ? 'Consider a change request or re-planning.' : 'Plan the remaining work now.'}`,
          linkUrl: `/projects/${p.id}?tab=${can('cost.view') ? 'cost' : 'overview'}`,
          ageDays: null,
        });
      }
    }

    // Verbal bookings with no email after the grace period
    if (ctx.bookings && ctx.bookings.overdueVerbal.length > 0) {
      const n = ctx.bookings.overdueVerbal.length;
      items.push({
        id: 'bookings:email-overdue',
        severity: 'high',
        kind: 'BOOKING',
        title: `${n} verbal booking${n === 1 ? '' : 's'} still without a confirmation email`,
        detail: `${ctx.bookings.overdueVerbal
          .slice(0, 2)
          .map((b) => b.name)
          .join(', ')}${n > 2 ? ` and ${n - 2} more` : ''} passed the email reminder window.`,
        linkUrl: '/bookings?filter=email-pending',
        ageDays: null,
      });
    }

    // Approvals that have sat too long
    const oldest = async <T extends { submittedAt: Date | null }>(rows: T[]) =>
      rows[0]?.submittedAt ?? null;
    if (can('timesheet.view') && ctx.approvals.timesheets > 0) {
      const rows = await this.prisma.scoped.timesheet.findMany({
        where: { status: 'SUBMITTED', ...ctx.people, ...ctx.peopleInOffice },
        select: { submittedAt: true },
        orderBy: { submittedAt: 'asc' },
        take: 1,
      });
      const age = ageOf(await oldest(rows));
      if ((age ?? 0) >= 2 || ctx.approvals.timesheets >= 5) {
        items.push({
          id: 'approvals:timesheets',
          severity: (age ?? 0) >= 5 ? 'high' : 'medium',
          kind: 'APPROVAL',
          title: `${ctx.approvals.timesheets} timesheet${ctx.approvals.timesheets === 1 ? '' : 's'} waiting for approval`,
          detail:
            age !== null
              ? `The oldest was submitted ${age} day${age === 1 ? '' : 's'} ago. Cost posts only once they are approved.`
              : 'Cost posts to projects only once they are approved.',
          linkUrl: '/timesheets?tab=approvals',
          ageDays: age,
        });
      }
    }
    if (can('expense.view') && ctx.approvals.expenses > 0) {
      const rows = await this.prisma.scoped.expense.findMany({
        where: {
          status: { in: ['PENDING_MANAGER', 'PENDING_FINANCE'] },
          deletedAt: null,
          ...ctx.people,
          ...ctx.peopleInOffice,
        },
        select: { submittedAt: true },
        orderBy: { submittedAt: 'asc' },
        take: 1,
      });
      const age = ageOf(await oldest(rows));
      if ((age ?? 0) >= 3) {
        items.push({
          id: 'approvals:expenses',
          severity: (age ?? 0) >= 7 ? 'high' : 'medium',
          kind: 'APPROVAL',
          title: `${ctx.approvals.expenses} expense claim${ctx.approvals.expenses === 1 ? '' : 's'} waiting`,
          detail: `₹${Number(ctx.approvals.expensesAmount).toLocaleString('en-IN')} in total; the oldest has waited ${age} days.`,
          linkUrl: '/expenses?tab=approvals',
          ageDays: age,
        });
      }
    }
    if (can('leave.view') && ctx.approvals.leave > 0) {
      const soon = await this.prisma.scoped.leaveRequest.count({
        where: {
          status: 'PENDING',
          fromDate: { lte: d(addDays(ctx.today, 3)) },
          ...ctx.people,
          ...ctx.peopleInOffice,
        },
      });
      if (soon > 0) {
        items.push({
          id: 'approvals:leave',
          severity: 'high',
          kind: 'APPROVAL',
          title: `${soon} leave request${soon === 1 ? ' starts' : 's start'} within three days and ${soon === 1 ? 'is' : 'are'} undecided`,
          detail: 'The people asking are planning around your answer.',
          linkUrl: '/leave?tab=approvals',
          ageDays: null,
        });
      }
    }

    // Milestones that slipped
    if (can('project.view')) {
      const late = await this.prisma.scoped.milestone.findMany({
        where: {
          deletedAt: null,
          status: { not: 'COMPLETED' },
          dueDate: { lt: d(ctx.today) },
          project: { ...ctx.projectWhere, status: 'ACTIVE' },
        },
        select: { name: true, dueDate: true, project: { select: { id: true, projectCode: true } } },
        orderBy: { dueDate: 'asc' },
        take: 10,
      });
      if (late.length > 0) {
        const first = late[0];
        const age = ageOf(first.dueDate);
        items.push({
          id: 'milestones:late',
          severity: (age ?? 0) >= 7 ? 'high' : 'medium',
          kind: 'MILESTONE',
          title: `${late.length} milestone${late.length === 1 ? ' is' : 's are'} past ${late.length === 1 ? 'its' : 'their'} due date`,
          detail: `${first.project.projectCode} — “${first.name}” was due ${age} day${age === 1 ? '' : 's'} ago.`,
          linkUrl: `/projects/${first.project.id}?tab=schedule`,
          ageDays: age,
        });
      }
    }

    // Time that was never submitted for the week just gone
    if (can('timesheet.view')) {
      const lastWeek = addDays(weekStartOf(ctx.today), -7);
      const withTime = await this.prisma.scoped.timeEntry.groupBy({
        by: ['employeeId'],
        where: {
          deletedAt: null,
          workDate: { gte: d(lastWeek), lte: d(addDays(lastWeek, 6)) },
          ...(ctx.employeeWhere.id ? { employeeId: ctx.employeeWhere.id as never } : {}),
          ...(ctx.peopleInOffice as object),
        },
      });
      if (withTime.length > 0) {
        const submitted = await this.prisma.scoped.timesheet.findMany({
          where: {
            weekStartDate: d(lastWeek),
            employeeId: { in: withTime.map((w) => w.employeeId) },
            status: { in: ['SUBMITTED', 'APPROVED'] },
          },
          select: { employeeId: true },
        });
        const missing = withTime.length - submitted.length;
        if (missing > 0) {
          items.push({
            id: 'timesheets:unsubmitted',
            severity: 'info',
            kind: 'TIMESHEET',
            title: `${missing} ${missing === 1 ? 'person has' : 'people have'} not submitted last week’s timesheet`,
            detail:
              'Their hours cannot be costed to projects until the week is submitted and approved.',
            linkUrl: '/timesheets?tab=approvals',
            ageDays: null,
          });
        }
      }
    }

    const rank = { high: 0, medium: 1, info: 2 } as const;
    return items
      .sort((a, b) => rank[a.severity] - rank[b.severity] || (b.ageDays ?? -1) - (a.ageDays ?? -1))
      .slice(0, 8);
  }
}
