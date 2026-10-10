import { Injectable } from '@nestjs/common';
import { eachDate, round2, shiftLengthMinutes } from '@opsvera/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AttendanceContextLoader, type ContextEmployee } from '../attendance/attendance-context';

const num = (value: { toString(): string } | number | null | undefined) => Number(value ?? 0);

/** Hours a person is expected to work on a day when no shift says otherwise. */
const DEFAULT_DAY_HOURS = 8;

export interface Workload {
  /** Hours people could have worked: working days (minus leave) times the shift's paid length. */
  capacityHours: number;
  loggedHours: number;
  billableHours: number;
  /** Billable hours over capacity, as a percentage; null when nobody had any capacity. */
  utilizationPercent: number | null;
  /** All logged hours over capacity. */
  loggedPercent: number | null;
  perEmployee: Map<string, { capacity: number; logged: number; billable: number }>;
}

/**
 * Capacity against logged time — the arithmetic behind "billable utilization".
 *
 * Capacity is built from the same calendar the attendance engine uses: a day
 * counts only if the person had joined, it is neither their weekly off nor a
 * holiday, and any approved leave takes it away (half a day for a half-day
 * leave). A day's hours are the shift's length minus its break. Logged time is
 * everything on the person's timesheets for the dates, finished timers included,
 * whatever its approval state — utilization measures how time is being spent,
 * not what has been signed off.
 */
@Injectable()
export class WorkloadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loader: AttendanceContextLoader,
  ) {}

  async measure(employees: ContextEmployee[], from: string, to: string): Promise<Workload> {
    const perEmployee = new Map<string, { capacity: number; logged: number; billable: number }>();
    for (const e of employees) perEmployee.set(e.id, { capacity: 0, logged: 0, billable: 0 });
    if (employees.length === 0 || to < from) {
      return {
        capacityHours: 0,
        loggedHours: 0,
        billableHours: 0,
        utilizationPercent: null,
        loggedPercent: null,
        perEmployee,
      };
    }

    const ctx = await this.loader.load(employees, from, to);
    const dates = eachDate(from, to);
    for (const e of employees) {
      const row = perEmployee.get(e.id)!;
      for (const date of dates) {
        const day = ctx.resolve(e.id, date);
        if (!day || !day.eligible || day.weeklyOff || day.holiday) continue;
        const shiftHours = day.shift
          ? Math.max(
              0,
              shiftLengthMinutes(day.shift.startTime, day.shift.endTime) - day.shift.breakMinutes,
            ) / 60
          : DEFAULT_DAY_HOURS;
        const factor = day.leave ? (day.leave.dayPart === 'FULL_DAY' ? 0 : 0.5) : 1;
        row.capacity += shiftHours * factor;
      }
    }

    const logged = await this.prisma.scoped.timeEntry.groupBy({
      by: ['employeeId', 'isBillable'],
      where: {
        employeeId: { in: employees.map((e) => e.id) },
        workDate: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
        deletedAt: null,
        // A timer still running has no hours yet.
        OR: [{ source: 'MANUAL' }, { endedAt: { not: null } }],
      },
      _sum: { hours: true },
    });
    for (const g of logged) {
      const row = perEmployee.get(g.employeeId);
      if (!row) continue;
      const h = num(g._sum.hours);
      row.logged += h;
      if (g.isBillable) row.billable += h;
    }

    let capacity = 0;
    let loggedHours = 0;
    let billable = 0;
    for (const row of perEmployee.values()) {
      row.capacity = round2(row.capacity);
      row.logged = round2(row.logged);
      row.billable = round2(row.billable);
      capacity += row.capacity;
      loggedHours += row.logged;
      billable += row.billable;
    }
    return {
      capacityHours: round2(capacity),
      loggedHours: round2(loggedHours),
      billableHours: round2(billable),
      utilizationPercent: capacity > 0 ? Math.round((billable / capacity) * 1000) / 10 : null,
      loggedPercent: capacity > 0 ? Math.round((loggedHours / capacity) * 1000) / 10 : null,
      perEmployee,
    };
  }
}
