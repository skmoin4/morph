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
  dayRoom,
  editableStatus,
  elapsedSeconds,
  round2,
  startOfWeek,
  timerHours,
  toOfficeDateString,
  TIME_BACKDATE_DAYS,
  weekDates,
  weekEndOf,
  type StartTimerInput,
  type StopTimerInput,
  type TimeCellInput,
  type TimeEntriesQuery,
  type TimeEntryInput,
  type TimesheetStatusValue,
  type UpdateTimeEntryInput,
  type WeekQuery,
} from '@opsvera/shared';
import { Clock } from '../../common/clock';
import { DataScopeService } from '../../common/scope/data-scope.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService, type ScopedDb } from '../../prisma/prisma.service';
import { AttendanceContextLoader } from '../attendance/attendance-context';

export const d = (value: string) => new Date(`${value}T00:00:00.000Z`);
export const iso = (value: Date) => value.toISOString().slice(0, 10);
export const num = (value: Prisma.Decimal | number | string | null | undefined) =>
  Number(value ?? 0);

type Db = ScopedDb;

interface MeRow {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  officeId: string;
  departmentId: string | null;
  joiningDate: Date;
  exitDate: Date | null;
  office: { timezone: string };
}

const ENTRY_INCLUDE = {
  project: { select: { id: true, projectCode: true, name: true } },
  task: { select: { id: true, title: true } },
} satisfies Prisma.TimeEntryInclude;

type EntryRow = Prisma.TimeEntryGetPayload<{ include: typeof ENTRY_INCLUDE }>;

export interface GridRow {
  key: string;
  project: EntryRow['project'];
  task: EntryRow['task'];
  isBillable: boolean;
  cells: Record<string, { hours: number; entryIds: string[]; hasTimer: boolean; locked: boolean }>;
  total: number;
}

/**
 * Time tracking: the one running timer, manual entries, and the weekly grid.
 *
 * Everything a person logs is theirs alone — the timer and the entry endpoints
 * always act on the caller's own employee record. Other people's time is only
 * ever *read* (the approver's review, Employee 360, Project 360), within scope.
 *
 * Mutations run in a transaction that first locks the employee row. That
 * serialises one person's writes, so the 24-hour day limit, the lazily created
 * weekly sheet and the "one timer" rule cannot be raced past by two requests.
 */
@Injectable()
export class TimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: DataScopeService,
    private readonly loader: AttendanceContextLoader,
    private readonly clock: Clock,
  ) {}

  // -------------------------------------------------------------------------
  // Shared helpers (also used by TimesheetsService)
  // -------------------------------------------------------------------------

  async me(user: AuthenticatedUser): Promise<MeRow> {
    if (!user.employeeId) {
      throw new ForbiddenException({
        code: 'NO_EMPLOYEE_PROFILE',
        message: 'Your login is not linked to an employee record, so there is no time to track.',
      });
    }
    const employee = await this.prisma.scoped.employee.findFirst({
      where: { id: user.employeeId, deletedAt: null },
      include: { office: { select: { timezone: true } } },
    });
    if (!employee) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Employee not found.' });
    }
    return employee as unknown as MeRow;
  }

  today(employee: Pick<MeRow, 'office'>): string {
    return toOfficeDateString(this.clock.now(), employee.office.timezone);
  }

  invalid(field: string, message: string) {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message,
      details: [{ path: field, message }],
    });
  }

  lock(tx: Db, employeeId: string) {
    return tx.$queryRaw`SELECT id FROM employees WHERE id = ${employeeId} FOR UPDATE`;
  }

  /** The week's sheet, created as a draft on first use. */
  async ensureSheet(tx: Db, employeeId: string, weekStart: string) {
    const where = { employeeId, weekStartDate: d(weekStart) };
    const found = await tx.timesheet.findFirst({ where });
    if (found) return found;
    try {
      return await tx.timesheet.create({
        data: { ...where, weekEndDate: d(weekEndOf(weekStart)), status: 'DRAFT' } as never,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return tx.timesheet.findFirstOrThrow({ where });
      }
      throw error;
    }
  }

  assertEditable(sheet: { status: string }) {
    if (!editableStatus(sheet.status as TimesheetStatusValue)) {
      throw new ConflictException({
        code: 'TIMESHEET_LOCKED',
        message:
          sheet.status === 'APPROVED'
            ? 'That week is approved and locked. Ask for it to be reopened to change it.'
            : 'That week is submitted. Withdraw it, or wait for a decision, to change it.',
      });
    }
  }

  /** Hours already on a date, finished entries only (a running timer is zero until it stops). */
  async dayTotal(tx: Db, employeeId: string, date: string, excludeId?: string): Promise<number> {
    const agg = await tx.timeEntry.aggregate({
      where: {
        employeeId,
        workDate: d(date),
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      _sum: { hours: true },
    });
    return num(agg._sum.hours);
  }

  /** Keeps the sheet's totals and each task's logged hours equal to the entries. */
  async syncTotals(tx: Db, sheetIds: string[], taskIds: Array<string | null>) {
    for (const id of new Set(sheetIds)) {
      const entries = await tx.timeEntry.findMany({
        where: { timesheetId: id, deletedAt: null },
        select: { hours: true, isBillable: true },
      });
      const total = entries.reduce((a, e) => a + num(e.hours), 0);
      const billable = entries.filter((e) => e.isBillable).reduce((a, e) => a + num(e.hours), 0);
      await tx.timesheet.update({
        where: { id },
        data: { totalHours: round2(total), billableHours: round2(billable) },
      });
    }
    for (const id of new Set(taskIds.filter((t): t is string => !!t))) {
      const agg = await tx.timeEntry.aggregate({
        where: { taskId: id, deletedAt: null },
        _sum: { hours: true },
      });
      await tx.task.update({ where: { id }, data: { loggedHours: round2(num(agg._sum.hours)) } });
    }
  }

  /**
   * May this person log time against that project and task on that date?
   * They must be on the team (or the PM), the project must be live, and a task
   * must belong to the project.
   */
  async assertCanLog(
    employee: MeRow,
    projectId: string,
    taskId: string | null | undefined,
    workDate: string,
  ) {
    const project = await this.prisma.scoped.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: {
        id: true,
        projectCode: true,
        name: true,
        status: true,
        projectManagerId: true,
        members: {
          where: { employeeId: employee.id },
          select: { joinedOn: true, leftOn: true },
        },
      },
    });
    if (!project) throw this.invalid('projectId', 'That project was not found.');
    if (project.status !== 'ACTIVE') {
      throw this.invalid(
        'projectId',
        `${project.projectCode} is ${project.status.toLowerCase().replace('_', ' ')} and is not taking time.`,
      );
    }
    const onTeam = project.members.some(
      (m) =>
        (!m.joinedOn || iso(m.joinedOn) <= workDate) && (!m.leftOn || iso(m.leftOn) >= workDate),
    );
    if (!onTeam && project.projectManagerId !== employee.id) {
      throw this.invalid('projectId', `You are not on the ${project.projectCode} team.`);
    }
    if (taskId) {
      const task = await this.prisma.scoped.task.findFirst({
        where: { id: taskId, projectId, deletedAt: null },
        select: { id: true },
      });
      if (!task) throw this.invalid('taskId', 'That task is not on this project.');
    }
    return project;
  }

  shapeEntry(e: EntryRow) {
    return {
      id: e.id,
      projectId: e.projectId,
      project: e.project,
      taskId: e.taskId,
      task: e.task,
      workDate: iso(e.workDate),
      hours: num(e.hours),
      isBillable: e.isBillable,
      source: e.source,
      description: e.description,
      isLocked: e.isLocked,
      startedAt: e.startedAt?.toISOString() ?? null,
      endedAt: e.endedAt?.toISOString() ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // Lookups
  // -------------------------------------------------------------------------

  /** Projects the caller can log time against: live, and on their team. */
  async projects(user: AuthenticatedUser) {
    const employee = await this.me(user);
    const rows = await this.prisma.scoped.project.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        OR: [
          { projectManagerId: employee.id },
          { members: { some: { employeeId: employee.id, leftOn: null } } },
        ],
      },
      select: { id: true, projectCode: true, name: true },
      orderBy: [{ projectCode: 'asc' }],
    });
    return rows;
  }

  async tasksFor(projectId: string, user: AuthenticatedUser) {
    const employee = await this.me(user);
    await this.assertCanLog(employee, projectId, null, this.today(employee));
    const rows = await this.prisma.scoped.task.findMany({
      where: { projectId, deletedAt: null, status: { not: 'DONE' } },
      select: { id: true, title: true, status: true, assigneeId: true },
      orderBy: [{ assigneeId: 'asc' }, { title: 'asc' }],
      take: 300,
    });
    return rows
      .map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        assignedToMe: t.assigneeId === employee.id,
      }))
      .sort((a, b) => Number(b.assignedToMe) - Number(a.assignedToMe));
  }

  // -------------------------------------------------------------------------
  // The timer
  // -------------------------------------------------------------------------

  async timer(user: AuthenticatedUser) {
    const employee = await this.me(user);
    const running = await this.prisma.scoped.timeEntry.findFirst({
      where: { employeeId: employee.id, source: 'TIMER', endedAt: null, deletedAt: null },
      include: ENTRY_INCLUDE,
    });
    const now = this.clock.now();
    return {
      now: now.toISOString(),
      running: running
        ? {
            ...this.shapeEntry(running),
            seconds: elapsedSeconds(running.startedAt!, now),
          }
        : null,
    };
  }

  async startTimer(input: StartTimerInput, user: AuthenticatedUser) {
    const employee = await this.me(user);
    const now = this.clock.now();
    const today = this.today(employee);
    await this.assertCanLog(employee, input.projectId, input.taskId, today);

    try {
      await this.prisma.scoped.$transaction(async (tx) => {
        await this.lock(tx, employee.id);

        const running = await tx.timeEntry.findFirst({
          where: { employeeId: employee.id, source: 'TIMER', endedAt: null, deletedAt: null },
        });
        if (running) throw this.alreadyRunning();

        // A submitted or approved week cannot take new time, and a timer would
        // only discover that when it stops. Say so now.
        const sheet = await tx.timesheet.findFirst({
          where: { employeeId: employee.id, weekStartDate: d(startOfWeek(today)) },
        });
        if (sheet) this.assertEditable(sheet);

        await tx.timeEntry.create({
          data: {
            employeeId: employee.id,
            projectId: input.projectId,
            taskId: input.taskId,
            workDate: d(today),
            startedAt: now,
            hours: 0,
            isBillable: input.isBillable,
            source: 'TIMER',
            description: input.description ?? null,
            createdById: user.userId,
          } as never,
        });
      });
    } catch (error) {
      // The unique index on the generated runningKey is the real guarantee.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.alreadyRunning();
      }
      throw error;
    }
    return this.timer(user);
  }

  private alreadyRunning() {
    return new ConflictException({
      code: 'TIMER_ALREADY_RUNNING',
      message: 'A timer is already running. Stop it before starting another.',
    });
  }

  async stopTimer(input: StopTimerInput, user: AuthenticatedUser) {
    const employee = await this.me(user);
    const now = this.clock.now();

    const result = await this.prisma.scoped.$transaction(async (tx) => {
      await this.lock(tx, employee.id);
      const running = await tx.timeEntry.findFirst({
        where: { employeeId: employee.id, source: 'TIMER', endedAt: null, deletedAt: null },
      });
      if (!running) {
        throw new NotFoundException({ code: 'NO_TIMER', message: 'There is no timer running.' });
      }

      const outcome = timerHours(running.startedAt!, now);
      if (outcome.discard) {
        await tx.timeEntry.delete({ where: { id: running.id } });
        return { entryId: null, discarded: true, capped: false, adjusted: false };
      }

      const workDate = iso(running.workDate);
      const sheet = await this.ensureSheet(tx, employee.id, startOfWeek(workDate));
      this.assertEditable(sheet);

      // However long it ran, the day cannot go past 24 hours.
      const room = dayRoom(await this.dayTotal(tx, employee.id, workDate, running.id));
      const hours = Math.min(outcome.hours, room);
      if (hours <= 0) {
        await tx.timeEntry.delete({ where: { id: running.id } });
        return { entryId: null, discarded: true, capped: false, adjusted: true };
      }

      await tx.timeEntry.update({
        where: { id: running.id },
        data: {
          endedAt: now,
          hours,
          timesheetId: sheet.id,
          ...(input.description !== undefined && input.description !== null
            ? { description: input.description }
            : {}),
        },
      });
      await this.syncTotals(tx, [sheet.id], [running.taskId]);
      return {
        entryId: running.id,
        discarded: false,
        capped: outcome.capped,
        adjusted: hours < outcome.hours,
      };
    });

    const entry = result.entryId
      ? this.shapeEntry(
          await this.prisma.scoped.timeEntry.findFirstOrThrow({
            where: { id: result.entryId },
            include: ENTRY_INCLUDE,
          }),
        )
      : null;
    return { ...result, entry };
  }

  /** Throws a running timer away without recording anything. */
  async discardTimer(user: AuthenticatedUser) {
    const employee = await this.me(user);
    const { count } = await this.prisma.scoped.timeEntry.deleteMany({
      where: { employeeId: employee.id, source: 'TIMER', endedAt: null },
    });
    if (count === 0) {
      throw new NotFoundException({ code: 'NO_TIMER', message: 'There is no timer running.' });
    }
    return { discarded: true };
  }

  // -------------------------------------------------------------------------
  // Manual entries and the grid cell
  // -------------------------------------------------------------------------

  private assertWorkDate(employee: MeRow, workDate: string) {
    const today = this.today(employee);
    if (workDate > today)
      throw this.invalid('workDate', 'You cannot log time for a day that has not happened yet.');
    if (workDate < addDays(today, -TIME_BACKDATE_DAYS)) {
      throw this.invalid(
        'workDate',
        `Time can be logged up to ${TIME_BACKDATE_DAYS} days back. Ask HR for older days.`,
      );
    }
    if (workDate < iso(employee.joiningDate)) {
      throw this.invalid('workDate', 'That is before you joined.');
    }
  }

  private dayLimit(already: number, adding: number) {
    if (already + adding > 24 + 1e-9) {
      return new ConflictException({
        code: 'DAY_LIMIT',
        message: `That would make ${round2(already + adding)} hours on one day. A day has 24; ${round2(
          Math.max(0, 24 - already),
        )} left.`,
      });
    }
    return null;
  }

  async createEntry(input: TimeEntryInput, user: AuthenticatedUser) {
    const employee = await this.me(user);
    this.assertWorkDate(employee, input.workDate);
    await this.assertCanLog(employee, input.projectId, input.taskId, input.workDate);

    const created = await this.prisma.scoped.$transaction(async (tx) => {
      await this.lock(tx, employee.id);
      const sheet = await this.ensureSheet(tx, employee.id, startOfWeek(input.workDate));
      this.assertEditable(sheet);
      const clash = this.dayLimit(
        await this.dayTotal(tx, employee.id, input.workDate),
        input.hours,
      );
      if (clash) throw clash;

      const entry = await tx.timeEntry.create({
        data: {
          employeeId: employee.id,
          projectId: input.projectId,
          taskId: input.taskId ?? null,
          timesheetId: sheet.id,
          workDate: d(input.workDate),
          hours: input.hours,
          isBillable: input.isBillable,
          source: 'MANUAL',
          description: input.description ?? null,
          createdById: user.userId,
        } as never,
        include: ENTRY_INCLUDE,
      });
      await this.syncTotals(tx, [sheet.id], [entry.taskId]);
      return entry;
    });
    return this.shapeEntry(created);
  }

  private async ownEntry(tx: Db, id: string, employee: MeRow) {
    const entry = await tx.timeEntry.findFirst({
      where: { id, deletedAt: null },
      include: { timesheet: { select: { id: true, status: true } } },
    });
    // Someone else's entry does not exist for you.
    if (!entry || entry.employeeId !== employee.id) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Time entry not found.' });
    }
    if (entry.source === 'TIMER' && entry.endedAt === null) {
      throw new ConflictException({
        code: 'TIMER_RUNNING',
        message: 'That timer is still running. Stop it first.',
      });
    }
    if (entry.isLocked) {
      throw new ConflictException({
        code: 'TIMESHEET_LOCKED',
        message: 'That time is approved and locked. Ask for the week to be reopened.',
      });
    }
    if (entry.timesheet) this.assertEditable(entry.timesheet);
    return entry;
  }

  async updateEntry(id: string, input: UpdateTimeEntryInput, user: AuthenticatedUser) {
    const employee = await this.me(user);

    const updated = await this.prisma.scoped.$transaction(async (tx) => {
      await this.lock(tx, employee.id);
      const entry = await this.ownEntry(tx, id, employee);

      const projectId = input.projectId ?? entry.projectId;
      // A project change drops the old task unless a task is named alongside it.
      const taskId =
        input.taskId !== undefined
          ? input.taskId
          : input.projectId && input.projectId !== entry.projectId
            ? null
            : entry.taskId;
      const workDate = input.workDate ?? iso(entry.workDate);
      const hours = input.hours ?? num(entry.hours);

      if (input.workDate) this.assertWorkDate(employee, workDate);
      if (input.projectId || input.taskId !== undefined || input.workDate) {
        await this.assertCanLog(employee, projectId, taskId, workDate);
      }

      const oldSheetId = entry.timesheetId;
      const sheet = await this.ensureSheet(tx, employee.id, startOfWeek(workDate));
      this.assertEditable(sheet);
      const clash = this.dayLimit(await this.dayTotal(tx, employee.id, workDate, id), hours);
      if (clash) throw clash;

      const row = await tx.timeEntry.update({
        where: { id },
        data: {
          projectId,
          taskId,
          workDate: d(workDate),
          hours,
          timesheetId: sheet.id,
          ...(input.isBillable !== undefined ? { isBillable: input.isBillable } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
        include: ENTRY_INCLUDE,
      });
      await this.syncTotals(
        tx,
        [sheet.id, ...(oldSheetId ? [oldSheetId] : [])],
        [row.taskId, entry.taskId],
      );
      return row;
    });
    return this.shapeEntry(updated);
  }

  async deleteEntry(id: string, user: AuthenticatedUser) {
    const employee = await this.me(user);
    await this.prisma.scoped.$transaction(async (tx) => {
      await this.lock(tx, employee.id);
      const entry = await this.ownEntry(tx, id, employee);
      await tx.timeEntry.delete({ where: { id } });
      await this.syncTotals(tx, entry.timesheetId ? [entry.timesheetId] : [], [entry.taskId]);
    });
    return { deleted: true };
  }

  /**
   * Sets one cell of the weekly grid. A cell that already holds timer entries
   * is edited entry by entry instead, so a timer's record is never silently
   * merged into a typed number.
   */
  async setCell(input: TimeCellInput, user: AuthenticatedUser) {
    const employee = await this.me(user);
    this.assertWorkDate(employee, input.workDate);
    const taskId = input.taskId ?? null;

    const result = await this.prisma.scoped.$transaction(async (tx) => {
      await this.lock(tx, employee.id);
      const sheet = await this.ensureSheet(tx, employee.id, startOfWeek(input.workDate));
      this.assertEditable(sheet);

      const cell = await tx.timeEntry.findMany({
        where: {
          employeeId: employee.id,
          projectId: input.projectId,
          taskId,
          workDate: d(input.workDate),
          isBillable: input.isBillable,
          deletedAt: null,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (cell.some((e) => e.source === 'TIMER')) {
        throw new ConflictException({
          code: 'CELL_HAS_TIMER_ENTRIES',
          message: 'That cell has timer entries. Edit those entries directly.',
        });
      }
      if (cell.some((e) => e.isLocked)) {
        throw new ConflictException({
          code: 'TIMESHEET_LOCKED',
          message: 'That time is approved and locked.',
        });
      }

      if (input.hours === 0) {
        if (cell.length)
          await tx.timeEntry.deleteMany({ where: { id: { in: cell.map((e) => e.id) } } });
        await this.syncTotals(tx, [sheet.id], [taskId]);
        return null;
      }

      await this.assertCanLog(employee, input.projectId, taskId, input.workDate);
      const others =
        (await this.dayTotal(tx, employee.id, input.workDate)) -
        cell.reduce((a, e) => a + num(e.hours), 0);
      const clash = this.dayLimit(others, input.hours);
      if (clash) throw clash;

      let entryId: string;
      if (cell.length) {
        // Keep the first entry, fold any extras into it.
        await tx.timeEntry.update({ where: { id: cell[0].id }, data: { hours: input.hours } });
        if (cell.length > 1) {
          await tx.timeEntry.deleteMany({ where: { id: { in: cell.slice(1).map((e) => e.id) } } });
        }
        entryId = cell[0].id;
      } else {
        entryId = (
          await tx.timeEntry.create({
            data: {
              employeeId: employee.id,
              projectId: input.projectId,
              taskId,
              timesheetId: sheet.id,
              workDate: d(input.workDate),
              hours: input.hours,
              isBillable: input.isBillable,
              source: 'MANUAL',
              createdById: user.userId,
            } as never,
          })
        ).id;
      }
      await this.syncTotals(tx, [sheet.id], [taskId]);
      return entryId;
    });

    return result
      ? this.shapeEntry(
          await this.prisma.scoped.timeEntry.findFirstOrThrow({
            where: { id: result },
            include: ENTRY_INCLUDE,
          }),
        )
      : null;
  }

  // -------------------------------------------------------------------------
  // The weekly grid
  // -------------------------------------------------------------------------

  /** Whose time the caller may look at: their own, or anyone in their view/approve scope. */
  async visibleEmployee(employeeId: string | undefined, user: AuthenticatedUser) {
    const target = employeeId ?? user.employeeId;
    if (!target) {
      throw new ForbiddenException({
        code: 'NO_EMPLOYEE_PROFILE',
        message: 'Your login is not linked to an employee record.',
      });
    }
    if (target !== user.employeeId) {
      let allowed = false;
      for (const key of ['timesheet.view', 'timesheet.approve']) {
        if (!user.permissions.has(key)) continue;
        const ids = await this.scope.visibleEmployeeIds(user, this.scope.scopeFor(user, key));
        if (ids === null || ids.includes(target)) allowed = true;
      }
      if (!allowed)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Employee not found.' });
    }
    const employee = await this.prisma.scoped.employee.findFirst({
      where: { id: target, deletedAt: null },
      include: { office: { select: { timezone: true } } },
    });
    if (!employee)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Employee not found.' });
    return employee as unknown as MeRow & {
      employeeCode: string;
      firstName: string;
      lastName: string;
    };
  }

  async week(query: WeekQuery, user: AuthenticatedUser) {
    const employee = await this.visibleEmployee(query.employeeId, user);
    const own = employee.id === user.employeeId;
    const now = this.clock.now();
    const today = this.today(employee);
    const weekStart = startOfWeek(query.weekStart ?? today);
    const weekEnd = weekEndOf(weekStart);
    const dates = weekDates(weekStart);

    const [sheet, entries, ctx] = await Promise.all([
      this.prisma.scoped.timesheet.findFirst({
        where: { employeeId: employee.id, weekStartDate: d(weekStart) },
        include: { approvals: { orderBy: { decidedAt: 'asc' } } },
      }),
      this.prisma.scoped.timeEntry.findMany({
        where: {
          employeeId: employee.id,
          workDate: { gte: d(weekStart), lte: d(weekEnd) },
          deletedAt: null,
        },
        include: ENTRY_INCLUDE,
        orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }],
      }),
      this.loader.load(
        [
          {
            id: employee.id,
            officeId: employee.officeId,
            departmentId: employee.departmentId,
            joiningDate: employee.joiningDate,
            exitDate: employee.exitDate,
          },
        ],
        weekStart,
        weekEnd,
      ),
    ]);

    const running = entries.find((e) => e.source === 'TIMER' && e.endedAt === null) ?? null;
    const done = entries.filter((e) => e !== running);

    const rows = new Map<string, GridRow>();
    const rowFor = (e: EntryRow) => {
      const key = `${e.projectId}|${e.taskId ?? ''}|${e.isBillable ? 'B' : 'N'}`;
      let row = rows.get(key);
      if (!row) {
        row = {
          key,
          project: e.project,
          task: e.task,
          isBillable: e.isBillable,
          cells: {},
          total: 0,
        };
        rows.set(key, row);
      }
      return row;
    };
    for (const e of done) {
      const row = rowFor(e);
      const date = iso(e.workDate);
      const cell = (row.cells[date] ??= { hours: 0, entryIds: [], hasTimer: false, locked: false });
      cell.hours = round2(cell.hours + num(e.hours));
      cell.entryIds.push(e.id);
      cell.hasTimer ||= e.source === 'TIMER';
      cell.locked ||= e.isLocked;
      row.total = round2(row.total + num(e.hours));
    }

    const status = (sheet?.status ?? 'DRAFT') as TimesheetStatusValue;
    const dayTotals = Object.fromEntries(
      dates.map((date) => [
        date,
        round2(done.filter((e) => iso(e.workDate) === date).reduce((a, e) => a + num(e.hours), 0)),
      ]),
    );
    const total = round2(done.reduce((a, e) => a + num(e.hours), 0));
    const billable = round2(done.filter((e) => e.isBillable).reduce((a, e) => a + num(e.hours), 0));

    const todayWeek = startOfWeek(today);
    const editableWeek = own && editableStatus(status) && weekStart <= todayWeek;

    // Offer last week's rows as a starting point for an empty week.
    let suggestions: Array<{
      project: EntryRow['project'];
      task: EntryRow['task'];
      isBillable: boolean;
    }> = [];
    if (editableWeek && rows.size === 0) {
      const prev = await this.prisma.scoped.timeEntry.findMany({
        where: {
          employeeId: employee.id,
          workDate: { gte: d(addDays(weekStart, -7)), lt: d(weekStart) },
          deletedAt: null,
          project: { status: 'ACTIVE' },
        },
        include: ENTRY_INCLUDE,
      });
      const seen = new Set<string>();
      suggestions = prev
        .filter((e) => {
          const key = `${e.projectId}|${e.taskId ?? ''}|${e.isBillable}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((e) => ({ project: e.project, task: e.task, isBillable: e.isBillable }));
    }

    const approverIds = [...new Set((sheet?.approvals ?? []).map((a) => a.approverId))];
    const approvers = approverIds.length
      ? await this.prisma.scoped.user.findMany({
          where: { id: { in: approverIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const approverName = new Map(approvers.map((a) => [a.id, a.fullName]));

    return {
      employee: {
        id: employee.id,
        employeeCode: employee.employeeCode,
        fullName: `${employee.firstName} ${employee.lastName}`,
        isMe: own,
      },
      weekStart,
      weekEnd,
      today,
      now: now.toISOString(),
      timesheet: sheet
        ? {
            id: sheet.id,
            status,
            submittedAt: sheet.submittedAt?.toISOString() ?? null,
            approvedAt: sheet.approvedAt?.toISOString() ?? null,
            reopenReason: sheet.reopenReason,
            approvals: sheet.approvals.map((a) => ({
              status: a.status,
              comment: a.comment,
              decidedAt: a.decidedAt.toISOString(),
              approver: approverName.get(a.approverId) ?? null,
            })),
          }
        : null,
      status,
      days: dates.map((date) => {
        const day = ctx.resolve(employee.id, date);
        return {
          date,
          isFuture: date > today,
          dayType: day?.leave
            ? 'LEAVE'
            : day?.holiday
              ? 'HOLIDAY'
              : day?.weeklyOff
                ? 'WEEKLY_OFF'
                : 'WORKING',
          label: day?.holiday?.name ?? null,
          total: dayTotals[date],
        };
      }),
      rows: [...rows.values()].sort((a, b) =>
        `${a.project.projectCode}${a.task?.title ?? ''}`.localeCompare(
          `${b.project.projectCode}${b.task?.title ?? ''}`,
        ),
      ),
      entries: done.map((e) => this.shapeEntry(e)),
      running: running
        ? { ...this.shapeEntry(running), seconds: elapsedSeconds(running.startedAt!, now) }
        : null,
      totals: { total, billable, nonBillable: round2(total - billable) },
      suggestions,
      canEdit: editableWeek,
      canSubmit: editableWeek && total > 0 && !running,
      canRecall: own && status === 'SUBMITTED',
    };
  }

  // -------------------------------------------------------------------------
  // Reading entries (Project 360, Employee 360)
  // -------------------------------------------------------------------------

  async listEntries(query: TimeEntriesQuery, user: AuthenticatedUser) {
    const ids = await this.scope.visibleEmployeeIds(
      user,
      this.scope.scopeFor(user, 'timesheet.view'),
    );
    const mine = user.employeeId ? [user.employeeId] : [];
    const allowed = ids === null ? null : [...new Set([...mine, ...ids])];
    const wanted = query.employeeId;
    const employeeFilter: Prisma.TimeEntryWhereInput =
      allowed === null
        ? wanted
          ? { employeeId: wanted }
          : {}
        : {
            employeeId: wanted ? (allowed.includes(wanted) ? wanted : '__none__') : { in: allowed },
          };
    const where: Prisma.TimeEntryWhereInput = {
      deletedAt: null,
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.from || query.to
        ? {
            workDate: {
              ...(query.from ? { gte: d(query.from) } : {}),
              ...(query.to ? { lte: d(query.to) } : {}),
            },
          }
        : {}),
      ...employeeFilter,
    };
    const [rows, total] = await Promise.all([
      this.prisma.scoped.timeEntry.findMany({
        where,
        include: {
          ...ENTRY_INCLUDE,
          employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
          timesheet: { select: { status: true } },
        },
        orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.scoped.timeEntry.count({ where }),
    ]);
    return {
      data: rows.map((r) => ({
        ...this.shapeEntry(r),
        employee: {
          id: r.employee.id,
          employeeCode: r.employee.employeeCode,
          fullName: `${r.employee.firstName} ${r.employee.lastName}`,
        },
        sheetStatus: r.timesheet?.status ?? null,
      })),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  /** Hours on a project by person and by task, within what the caller may see. */
  async projectSummary(projectId: string, user: AuthenticatedUser) {
    const projectIds = await this.scope.visibleProjectIds(
      user,
      this.scope.scopeFor(user, 'project.view'),
    );
    if (projectIds !== null && !projectIds.includes(projectId)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Project not found.' });
    }
    const ids = await this.scope.visibleEmployeeIds(
      user,
      this.scope.scopeFor(user, 'timesheet.view'),
    );
    const mine = user.employeeId ? [user.employeeId] : [];
    const allowed = ids === null ? null : [...new Set([...mine, ...ids])];

    // Finished work only: manual entries, and timers that have been stopped.
    const all = await this.prisma.scoped.timeEntry.findMany({
      where: {
        projectId,
        deletedAt: null,
        OR: [{ source: 'MANUAL' }, { source: 'TIMER', endedAt: { not: null } }],
        ...(allowed === null ? {} : { employeeId: { in: allowed } }),
      },
      include: {
        task: { select: { id: true, title: true } },
        employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
        timesheet: { select: { status: true } },
      },
    });

    const byEmployee = new Map<
      string,
      {
        employee: { id: string; employeeCode: string; fullName: string };
        hours: number;
        billable: number;
        approved: number;
      }
    >();
    const byTask = new Map<string, { taskId: string | null; title: string; hours: number }>();
    for (const e of all) {
      const h = num(e.hours);
      const person = byEmployee.get(e.employeeId) ?? {
        employee: {
          id: e.employee.id,
          employeeCode: e.employee.employeeCode,
          fullName: `${e.employee.firstName} ${e.employee.lastName}`,
        },
        hours: 0,
        billable: 0,
        approved: 0,
      };
      person.hours = round2(person.hours + h);
      if (e.isBillable) person.billable = round2(person.billable + h);
      if (e.timesheet?.status === 'APPROVED') person.approved = round2(person.approved + h);
      byEmployee.set(e.employeeId, person);

      const key = e.taskId ?? '';
      const task = byTask.get(key) ?? {
        taskId: e.taskId,
        title: e.task?.title ?? 'No task',
        hours: 0,
      };
      task.hours = round2(task.hours + h);
      byTask.set(key, task);
    }
    const people = [...byEmployee.values()].sort((a, b) => b.hours - a.hours);
    return {
      totalHours: round2(people.reduce((a, p) => a + p.hours, 0)),
      approvedHours: round2(people.reduce((a, p) => a + p.approved, 0)),
      byEmployee: people,
      byTask: [...byTask.values()].sort((a, b) => b.hours - a.hours),
      /** True when the caller can see only part of the team's time. */
      partial: allowed !== null,
    };
  }
}
