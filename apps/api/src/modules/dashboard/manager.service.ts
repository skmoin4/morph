import { Injectable } from '@nestjs/common';
import {
  addDays,
  alertLevelFor,
  burnPercent,
  round2,
  toOfficeDateString,
  weekStartOf,
} from '@opsvera/shared';
import { Clock } from '../../common/clock';
import { DataScopeService } from '../../common/scope/data-scope.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceService } from '../attendance/attendance.service';
import { RegularisationService } from '../attendance/regularisation.service';
import { ExpensesService } from '../expenses/expenses.service';
import { LeaveService } from '../leave/leave.service';
import { TimesheetsService } from '../time/timesheets.service';
import { WorkloadService } from './workload.service';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);
const num = (value: { toString(): string } | number | null | undefined) => Number(value ?? 0);

export interface WaitingItem {
  id: string;
  type: 'TIMESHEET' | 'LEAVE' | 'EXPENSE' | 'CORRECTION';
  person: string;
  title: string;
  detail: string;
  linkUrl: string;
  /** Days since it was submitted. */
  ageDays: number;
  amount?: string;
}

/**
 * The manager's view: my team today, what is waiting on me, my projects.
 *
 * "Waiting on me" is exactly what the approval screens would list for this
 * person — it asks the same services, so the two can never disagree.
 */
@Injectable()
export class ManagerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: DataScopeService,
    private readonly clock: Clock,
    private readonly workload: WorkloadService,
    private readonly attendance: AttendanceService,
    private readonly timesheets: TimesheetsService,
    private readonly leave: LeaveService,
    private readonly expenses: ExpensesService,
    private readonly regularisations: RegularisationService,
  ) {}

  async manager(user: AuthenticatedUser) {
    const can = (key: string) => user.permissions.has(key);
    const now = this.clock.now();
    const me = user.employeeId
      ? await this.prisma.scoped.employee.findFirst({
          where: { id: user.employeeId },
          select: { office: { select: { timezone: true } } },
        })
      : null;
    const today = toOfficeDateString(now, me?.office.timezone ?? 'Asia/Kolkata');
    const weekStart = weekStartOf(today);
    const age = (date: Date | string | null) =>
      date ? Math.max(0, Math.floor((now.getTime() - new Date(date).getTime()) / 86_400_000)) : 0;

    const dashScope = this.scope.scopeFor(user, 'dashboard.view');
    const reach = await this.scope.visibleEmployeeIds(user, dashScope);
    const projectReach = await this.scope.visibleProjectIds(user, dashScope);
    const teamIds = (reach ?? []).filter((id) => id !== user.employeeId);

    // --- Waiting on me -----------------------------------------------------
    const waiting: WaitingItem[] = [];
    const counts = { timesheets: 0, leave: 0, expenses: 0, corrections: 0 };

    if (can('timesheet.approve')) {
      const r = await this.timesheets.list({ toDecide: true, page: 1, pageSize: 6 } as never, user);
      counts.timesheets = r.meta.total;
      for (const t of r.data) {
        waiting.push({
          id: `ts:${t.id}`,
          type: 'TIMESHEET',
          person: t.employee.fullName,
          title: `Timesheet, week of ${t.weekStart}`,
          detail: `${t.totalHours} h · ${t.billableHours} h billable`,
          linkUrl: '/timesheets?tab=approvals',
          ageDays: age(t.submittedAt),
        });
      }
    }
    if (can('leave.approve')) {
      const r = await this.leave.list({ toDecide: true, page: 1, pageSize: 6 } as never, user);
      counts.leave = r.meta.total;
      for (const l of r.data) {
        waiting.push({
          id: `lv:${l.id}`,
          type: 'LEAVE',
          person: l.employee.fullName,
          title: `${l.leaveType.name}, ${l.fromDate === l.toDate ? l.fromDate : `${l.fromDate} to ${l.toDate}`}`,
          detail: `${l.totalDays} day${l.totalDays === 1 ? '' : 's'} · ${l.reason}`,
          linkUrl: '/leave?tab=approvals',
          ageDays: age(l.createdAt),
        });
      }
    }
    if (can('expense.approve')) {
      const r = await this.expenses.list({ toDecide: true, page: 1, pageSize: 6 } as never, user);
      counts.expenses = r.meta.total;
      for (const e of r.data) {
        waiting.push({
          id: `ex:${e.id}`,
          type: 'EXPENSE',
          person: e.employee.fullName,
          title: `${e.category.name} claim`,
          detail:
            `${e.description ?? ''}${e.exceededLimit ? ' · over a category limit' : ''}`.replace(
              /^ · /,
              '',
            ),
          linkUrl: '/expenses?tab=approvals',
          ageDays: age(e.submittedAt),
          amount: e.amount,
        });
      }
    }
    if (can('attendance.approve')) {
      const r = await this.regularisations.list(
        { status: 'PENDING', page: 1, pageSize: 20 } as never,
        user,
      );
      const mine = r.data.filter((x) => x.canDecide);
      counts.corrections = mine.length;
      for (const c of mine.slice(0, 6)) {
        waiting.push({
          id: `rg:${c.id}`,
          type: 'CORRECTION',
          person: c.employee.fullName,
          title: `Attendance correction for ${c.attendanceDate}`,
          detail: c.reason,
          linkUrl: '/attendance?tab=requests',
          ageDays: age(c.createdAt),
        });
      }
    }
    waiting.sort((a, b) => b.ageDays - a.ageDays);

    // --- My team today -----------------------------------------------------
    const teamToday = can('attendance.view')
      ? await (async () => {
          const board = await this.attendance.board({ page: 1, pageSize: 100 } as never, user);
          const rows = board.data.filter((r) => r.employeeId !== user.employeeId);
          const s = rows.reduce(
            (a, r) => {
              if (r.status === 'PRESENT' || r.status === 'LATE' || r.status === 'HALF_DAY')
                a.present += 1;
              if (r.status === 'LATE') a.late += 1;
              if (r.status === 'ON_LEAVE') a.onLeave += 1;
              if (r.status === 'ABSENT') a.absent += 1;
              if (r.status === 'NOT_IN') a.notIn += 1;
              if (r.status !== 'HOLIDAY' && r.status !== 'WEEKLY_OFF') a.expected += 1;
              return a;
            },
            { expected: 0, present: 0, late: 0, onLeave: 0, absent: 0, notIn: 0 },
          );
          return { date: board.date, ...s, rows: rows.slice(0, 12) };
        })()
      : null;

    // --- Team workload this week ------------------------------------------
    const members = teamIds.length
      ? await this.prisma.scoped.employee.findMany({
          where: {
            id: { in: teamIds },
            deletedAt: null,
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
          },
        })
      : [];
    const load =
      can('timesheet.view') && members.length
        ? await this.workload.measure(members, weekStart, today)
        : null;
    const workloadRows = load
      ? members
          .map((m) => {
            const w = load.perEmployee.get(m.id)!;
            return {
              id: m.id,
              fullName: `${m.firstName} ${m.lastName}`,
              employeeCode: m.employeeCode,
              logged: w.logged,
              billable: w.billable,
              expected: w.capacity,
              behind: w.capacity > 0 ? round2(Math.max(0, w.capacity - w.logged)) : 0,
            };
          })
          .sort((a, b) => b.behind - a.behind)
      : null;

    // --- My projects -------------------------------------------------------
    const projectRows = can('project.view')
      ? await this.prisma.scoped.project.findMany({
          where: {
            deletedAt: null,
            status: 'ACTIVE',
            ...(projectReach === null ? {} : { id: { in: projectReach } }),
          },
          include: { client: { select: { name: true } } },
        })
      : [];
    const taskStats = projectRows.length
      ? await this.prisma.scoped.task.groupBy({
          by: ['projectId', 'status'],
          where: { projectId: { in: projectRows.map((p) => p.id) }, deletedAt: null },
          _count: true,
        })
      : [];
    const tasks = new Map<string, { total: number; done: number; overdue: number }>();
    for (const t of taskStats) {
      const row = tasks.get(t.projectId) ?? { total: 0, done: 0, overdue: 0 };
      row.total += t._count;
      if (t.status === 'DONE') row.done += t._count;
      tasks.set(t.projectId, row);
    }
    const overdueTasks = projectRows.length
      ? await this.prisma.scoped.task.groupBy({
          by: ['projectId'],
          where: {
            projectId: { in: projectRows.map((p) => p.id) },
            deletedAt: null,
            status: { not: 'DONE' },
            dueDate: { lt: d(today) },
          },
          _count: true,
        })
      : [];
    for (const o of overdueTasks) {
      const row = tasks.get(o.projectId);
      if (row) row.overdue = o._count;
    }
    const projects = projectRows
      .map((p) => {
        const burn = burnPercent(num(p.actualHours), num(p.budgetHours));
        const t = tasks.get(p.id) ?? { total: 0, done: 0, overdue: 0 };
        const value = num(p.projectValue);
        const cost = num(p.actualTotalCost);
        return {
          id: p.id,
          projectCode: p.projectCode,
          name: p.name,
          client: p.client.name,
          health: p.health,
          alertLevel: alertLevelFor(burn),
          burnPercent: burn,
          actualHours: round2(num(p.actualHours)),
          budgetHours: num(p.budgetHours),
          taskProgress: t.total > 0 ? Math.round((t.done / t.total) * 100) : null,
          taskCount: t.total,
          overdueTasks: t.overdue,
          endDate: p.endDate ? iso(p.endDate) : null,
          actualTotalCost: cost.toFixed(2),
          marginPercent: value > 0 ? Math.round(((value - cost) / value) * 1000) / 10 : null,
        };
      })
      .sort((a, b) => b.alertLevel - a.alertLevel || (b.burnPercent ?? -1) - (a.burnPercent ?? -1));

    // --- Coming up ---------------------------------------------------------
    const milestones = projectRows.length
      ? await this.prisma.scoped.milestone.findMany({
          where: {
            deletedAt: null,
            status: { not: 'COMPLETED' },
            dueDate: { lte: d(addDays(today, 14)) },
            projectId: { in: projectRows.map((p) => p.id) },
          },
          select: {
            id: true,
            name: true,
            dueDate: true,
            project: { select: { id: true, projectCode: true } },
          },
          orderBy: { dueDate: 'asc' },
          take: 6,
        })
      : [];
    const teamLeave =
      can('leave.view') && teamIds.length
        ? await this.prisma.scoped.leaveRequest.findMany({
            where: {
              employeeId: { in: teamIds },
              status: 'APPROVED',
              toDate: { gte: d(today) },
              fromDate: { lte: d(addDays(today, 10)) },
            },
            select: {
              id: true,
              fromDate: true,
              toDate: true,
              totalDays: true,
              employee: { select: { firstName: true, lastName: true } },
              leaveType: { select: { shortCode: true } },
            },
            orderBy: { fromDate: 'asc' },
            take: 6,
          })
        : [];

    const unsubmitted =
      can('timesheet.view') && teamIds.length
        ? await (async () => {
            const lastWeek = addDays(weekStart, -7);
            const withTime = await this.prisma.scoped.timeEntry.groupBy({
              by: ['employeeId'],
              where: {
                employeeId: { in: teamIds },
                deletedAt: null,
                workDate: { gte: d(lastWeek), lte: d(addDays(lastWeek, 6)) },
              },
            });
            const done = await this.prisma.scoped.timesheet.count({
              where: {
                weekStartDate: d(lastWeek),
                employeeId: { in: withTime.map((w) => w.employeeId) },
                status: { in: ['SUBMITTED', 'APPROVED'] },
              },
            });
            return Math.max(0, withTime.length - done);
          })()
        : 0;

    return {
      today,
      weekStart,
      counts: {
        ...counts,
        total: counts.timesheets + counts.leave + counts.expenses + counts.corrections,
      },
      waiting: waiting.slice(0, 10),
      team: {
        size: members.length,
        today: teamToday,
        workload: workloadRows,
        unsubmittedLastWeek: unsubmitted,
      },
      projects,
      upcoming: {
        milestones: milestones.map((m) => ({
          id: m.id,
          name: m.name,
          dueDate: iso(m.dueDate),
          daysAway: Math.round((m.dueDate.getTime() - d(today).getTime()) / 86_400_000),
          project: m.project,
        })),
        leave: teamLeave.map((l) => ({
          id: l.id,
          person: `${l.employee.firstName} ${l.employee.lastName}`,
          code: l.leaveType.shortCode,
          from: iso(l.fromDate),
          to: iso(l.toDate),
          days: num(l.totalDays),
        })),
      },
    };
  }
}
