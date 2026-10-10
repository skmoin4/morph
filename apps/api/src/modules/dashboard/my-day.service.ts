import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  addDays,
  eachDate,
  round2,
  toOfficeDateString,
  weekDates,
  weekStartOf,
} from '@opsvera/shared';
import { Clock } from '../../common/clock';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { LeaveService } from '../leave/leave.service';
import { WorkloadService } from './workload.service';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);
const num = (value: { toString(): string } | number | null | undefined) => Number(value ?? 0);

/**
 * "My Day": what one person needs to know and do today. It is always about the
 * caller's own record — it never reads anyone else's.
 */
@Injectable()
export class MyDayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly workload: WorkloadService,
    private readonly leave: LeaveService,
  ) {}

  async myDay(user: AuthenticatedUser) {
    if (!user.employeeId) {
      throw new ForbiddenException({
        code: 'NO_EMPLOYEE_PROFILE',
        message: 'Your login is not linked to an employee record, so there is no day to show.',
      });
    }
    const can = (key: string) => user.permissions.has(key);
    const now = this.clock.now();
    const employee = await this.prisma.scoped.employee.findFirstOrThrow({
      where: { id: user.employeeId },
      select: {
        id: true,
        officeId: true,
        departmentId: true,
        joiningDate: true,
        exitDate: true,
        firstName: true,
        office: { select: { timezone: true, name: true, shortCode: true } },
      },
    });
    const today = toOfficeDateString(now, employee.office.timezone);
    const weekStart = weekStartOf(today);
    const weekEnd = addDays(weekStart, 6);
    const ctxEmployee = {
      id: employee.id,
      officeId: employee.officeId,
      departmentId: employee.departmentId,
      joiningDate: employee.joiningDate,
      exitDate: employee.exitDate,
    };

    const [
      tasks,
      weekLoad,
      entries,
      records,
      holidays,
      myLeave,
      balances,
      sheets,
      expenses,
      regs,
      myProjects,
    ] = await Promise.all([
      this.prisma.scoped.task.findMany({
        where: {
          assigneeId: employee.id,
          deletedAt: null,
          status: { not: 'DONE' },
          project: { status: 'ACTIVE', deletedAt: null },
        },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
          estimatedHours: true,
          loggedHours: true,
          project: { select: { id: true, projectCode: true, name: true } },
        },
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { priority: 'desc' }],
        take: 12,
      }),
      can('timesheet.view') ? this.workload.measure([ctxEmployee], weekStart, weekEnd) : null,
      can('timesheet.view')
        ? this.prisma.scoped.timeEntry.findMany({
            where: {
              employeeId: employee.id,
              deletedAt: null,
              workDate: { gte: d(weekStart), lte: d(weekEnd) },
              OR: [{ source: 'MANUAL' }, { endedAt: { not: null } }],
            },
            select: { workDate: true, hours: true, isBillable: true },
          })
        : [],
      this.prisma.scoped.attendanceRecord.findMany({
        where: { employeeId: employee.id, attendanceDate: { gte: d(weekStart), lte: d(weekEnd) } },
        select: { attendanceDate: true, status: true },
      }),
      this.prisma.scoped.holiday.findMany({
        where: {
          date: { gte: d(today), lte: d(addDays(today, 45)) },
          isOptional: false,
          OR: [{ officeId: null }, { officeId: employee.officeId }],
        },
        orderBy: { date: 'asc' },
        take: 3,
      }),
      can('leave.view')
        ? this.prisma.scoped.leaveRequest.findMany({
            where: {
              employeeId: employee.id,
              status: { in: ['PENDING', 'APPROVED'] },
              toDate: { gte: d(today) },
              fromDate: { lte: d(addDays(today, 45)) },
            },
            select: {
              id: true,
              fromDate: true,
              toDate: true,
              status: true,
              totalDays: true,
              leaveType: { select: { name: true, shortCode: true } },
            },
            orderBy: { fromDate: 'asc' },
            take: 4,
          })
        : [],
      can('leave.view') ? this.leave.balances({}, user) : null,
      can('timesheet.view')
        ? this.prisma.scoped.timesheet.findMany({
            where: {
              employeeId: employee.id,
              weekStartDate: { in: [d(weekStart), d(addDays(weekStart, -7))] },
            },
            select: { weekStartDate: true, status: true, totalHours: true },
          })
        : [],
      can('expense.view')
        ? this.prisma.scoped.expense.groupBy({
            by: ['status', 'reimbursementStatus'],
            where: {
              employeeId: employee.id,
              deletedAt: null,
              status: {
                in: ['DRAFT', 'REJECTED', 'PENDING_MANAGER', 'PENDING_FINANCE', 'APPROVED'],
              },
            },
            _count: true,
            _sum: { amount: true },
          })
        : [],
      can('attendance.view')
        ? this.prisma.scoped.regularisationRequest.groupBy({
            by: ['status'],
            where: {
              employeeId: employee.id,
              createdAt: { gte: new Date(now.getTime() - 14 * 86_400_000) },
            },
            _count: true,
          })
        : [],
      this.prisma.scoped.project.count({
        where: {
          deletedAt: null,
          status: 'ACTIVE',
          OR: [
            { projectManagerId: employee.id },
            { members: { some: { employeeId: employee.id, leftOn: null } } },
          ],
        },
      }),
    ]);

    // The week, day by day: what was logged and how the day was recorded.
    const byDay = new Map<string, { hours: number; billable: number }>();
    for (const e of entries) {
      const key = iso(e.workDate);
      const row = byDay.get(key) ?? { hours: 0, billable: 0 };
      row.hours += num(e.hours);
      if (e.isBillable) row.billable += num(e.hours);
      byDay.set(key, row);
    }
    const status = new Map(records.map((r) => [iso(r.attendanceDate), r.status]));
    const week = weekDates(weekStart).map((date) => ({
      date,
      isToday: date === today,
      isFuture: date > today,
      hours: round2(byDay.get(date)?.hours ?? 0),
      attendance: status.get(date) ?? null,
    }));

    // Things that are waiting on this person to do something.
    const lastWeek = addDays(weekStart, -7);
    const sheetOf = (start: string) => sheets.find((s) => iso(s.weekStartDate) === start);
    const lastSheet = sheetOf(lastWeek);
    const expenseBy = (status: string) =>
      expenses.filter((e) => e.status === status).reduce((a, e) => a + e._count, 0);
    const todo: Array<{
      id: string;
      tone: 'red' | 'amber' | 'blue';
      title: string;
      detail: string;
      linkUrl: string;
    }> = [];

    if (can('timesheet.view')) {
      const lastHours = (
        await this.prisma.scoped.timeEntry.aggregate({
          where: {
            employeeId: employee.id,
            deletedAt: null,
            workDate: { gte: d(lastWeek), lte: d(addDays(lastWeek, 6)) },
          },
          _sum: { hours: true },
        })
      )._sum.hours;
      if (
        num(lastHours) > 0 &&
        (!lastSheet || ['DRAFT', 'REJECTED', 'REOPENED'].includes(lastSheet.status))
      ) {
        todo.push({
          id: 'timesheet:last',
          tone: lastSheet && ['REJECTED', 'REOPENED'].includes(lastSheet.status) ? 'red' : 'amber',
          title:
            lastSheet?.status === 'REJECTED'
              ? 'Last week’s timesheet was sent back'
              : 'Submit last week’s timesheet',
          detail: `${round2(num(lastHours))} h logged for the week of ${lastWeek}. Approval is what turns hours into project cost.`,
          linkUrl: `/timesheets?week=${lastWeek}`,
        });
      }
      const thisSheet = sheetOf(weekStart);
      if (thisSheet && ['REJECTED', 'REOPENED'].includes(thisSheet.status)) {
        todo.push({
          id: 'timesheet:this',
          tone: 'red',
          title: 'This week’s timesheet needs your correction',
          detail: 'It was sent back to you.',
          linkUrl: `/timesheets?week=${weekStart}`,
        });
      }
    }
    if (expenseBy('REJECTED') > 0) {
      todo.push({
        id: 'expense:rejected',
        tone: 'red',
        title: `${expenseBy('REJECTED')} expense claim${expenseBy('REJECTED') === 1 ? ' was' : 's were'} sent back`,
        detail: 'Correct and send again.',
        linkUrl: '/expenses',
      });
    }
    if (expenseBy('DRAFT') > 0) {
      todo.push({
        id: 'expense:draft',
        tone: 'amber',
        title: `${expenseBy('DRAFT')} expense draft${expenseBy('DRAFT') === 1 ? '' : 's'} not yet submitted`,
        detail: 'A claim is not seen by anyone until you submit it.',
        linkUrl: '/expenses',
      });
    }
    const regRejected = regs.find((r) => r.status === 'REJECTED')?._count ?? 0;
    if (regRejected > 0) {
      todo.push({
        id: 'reg:rejected',
        tone: 'amber',
        title: `${regRejected} attendance correction${regRejected === 1 ? ' was' : 's were'} declined`,
        detail: 'Check the reason in Attendance → Corrections.',
        linkUrl: '/attendance?tab=requests',
      });
    }

    const waiting = {
      leave: myLeave.filter((l) => l.status === 'PENDING').length,
      expenses: expenseBy('PENDING_MANAGER') + expenseBy('PENDING_FINANCE'),
      expensesToReceive: expenses
        .filter((e) => e.status === 'APPROVED' && e.reimbursementStatus === 'PENDING')
        .reduce((a, e) => a + num(e._sum.amount), 0),
      corrections: regs.find((r) => r.status === 'PENDING')?._count ?? 0,
      timesheet: sheetOf(weekStart)?.status === 'SUBMITTED' || lastSheet?.status === 'SUBMITTED',
    };

    return {
      today,
      weekStart,
      weekEnd,
      employee: {
        id: employee.id,
        firstName: employee.firstName,
        office: employee.office.shortCode,
        officeName: employee.office.name,
      },
      projects: myProjects,
      tasks: tasks.map((t) => {
        const due = t.dueDate ? iso(t.dueDate) : null;
        return {
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          dueDate: due,
          overdue: !!due && due < today,
          dueSoon: !!due && due >= today && due <= addDays(today, 3),
          estimatedHours: t.estimatedHours === null ? null : num(t.estimatedHours),
          loggedHours: round2(num(t.loggedHours)),
          project: t.project,
        };
      }),
      hours: weekLoad
        ? {
            week: round2(weekLoad.loggedHours),
            billable: round2(weekLoad.billableHours),
            capacity: weekLoad.capacityHours,
            // Capacity up to today, so "behind" means behind where you should be now.
            expectedSoFar: (await this.workload.measure([ctxEmployee], weekStart, today))
              .capacityHours,
          }
        : null,
      week,
      leaveBalances: balances
        ? balances.balances
            .filter((b) => b.leaveType.isPaid)
            .map((b) => ({
              type: b.leaveType.name,
              code: b.leaveType.shortCode,
              colorToken: b.leaveType.colorToken,
              available: b.available,
              used: b.used,
              pending: b.pending,
              total: round2(b.opening + b.accrued + b.carriedForward),
            }))
        : null,
      upcoming: {
        holidays: holidays.map((h) => ({
          id: h.id,
          name: h.name,
          date: iso(h.date),
          daysAway: eachDate(today, iso(h.date)).length - 1,
        })),
        leave: myLeave.map((l) => ({
          id: l.id,
          type: l.leaveType.name,
          code: l.leaveType.shortCode,
          from: iso(l.fromDate),
          to: iso(l.toDate),
          days: num(l.totalDays),
          status: l.status,
        })),
      },
      todo,
      waiting,
    };
  }
}
