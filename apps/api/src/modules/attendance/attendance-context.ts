import { Injectable } from '@nestjs/common';
import {
  addDays,
  dayOfWeek,
  type DayLeave,
  type PolicyRule,
  type ShiftRule,
} from '@opsvera/shared';
import { PrismaService } from '../../prisma/prisma.service';

const iso = (date: Date) => date.toISOString().slice(0, 10);

export interface ContextEmployee {
  id: string;
  officeId: string;
  departmentId: string | null;
  joiningDate: Date;
  exitDate: Date | null;
}

export interface ShiftRow {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  breakMinutes: number;
  graceMinutes: number;
  isDefault: boolean;
}

export interface PolicyRow {
  id: string;
  name: string;
  officeId: string | null;
  shiftId: string | null;
  isDefault: boolean;
  graceMinutes: number;
  lateMarkAfterMinutes: number;
  halfDayBelowHours: { toString(): string };
  fullDayMinimumHours: { toString(): string };
  overtimeAfterHours: { toString(): string };
  earlyExitBeforeMinutes: number;
  lateMarksPerHalfDay: number;
}

export interface OfficeRow {
  id: string;
  name: string;
  shortCode: string;
  timezone: string;
  weeklyOffDays: unknown;
  latitude: { toString(): string } | null;
  longitude: { toString(): string } | null;
  geofenceRadiusM: number;
  allowedIPs: unknown;
  requiresGps: boolean;
  geofenceMode: 'FLAG' | 'REJECT';
}

export interface ResolvedDay {
  office: OfficeRow;
  /** False before joining, after leaving, or when the person has no office. */
  eligible: boolean;
  shift: ShiftRow | null;
  shiftRule: ShiftRule | null;
  policyRow: PolicyRow | null;
  policy: PolicyRule;
  weeklyOff: boolean;
  weeklyOffDays: number[];
  holiday: { id: string; name: string } | null;
  leave: (DayLeave & { id: string }) | null;
}

const asDays = (value: unknown, fallback: number[]): number[] =>
  Array.isArray(value) ? value.filter((v): v is number => Number.isInteger(v)) : fallback;

/** The policy numbers a shift implies when no policy row applies at all. */
function fallbackPolicy(shift: ShiftRow | null): PolicyRule {
  return {
    graceMinutes: shift?.graceMinutes ?? 10,
    lateMarkAfterMinutes: 0,
    halfDayFromHours: 4,
    fullDayMinimumHours: 8,
    overtimeAfterHours: 9,
    earlyExitBeforeMinutes: 15,
    lateMarksPerHalfDay: 0,
  };
}

export function toPolicyRule(row: PolicyRow): PolicyRule {
  return {
    graceMinutes: row.graceMinutes,
    lateMarkAfterMinutes: row.lateMarkAfterMinutes,
    halfDayFromHours: Number(row.halfDayBelowHours),
    fullDayMinimumHours: Number(row.fullDayMinimumHours),
    overtimeAfterHours: Number(row.overtimeAfterHours),
    earlyExitBeforeMinutes: row.earlyExitBeforeMinutes,
    lateMarksPerHalfDay: row.lateMarksPerHalfDay,
  };
}

/**
 * Everything that decides what a given person's given day *should* look like —
 * their shift, the office calendar, the policy and any approved leave —
 * loaded once for a batch of people and dates.
 *
 * Reading these per day would be an N+1 across a month-long register; loading
 * them once and resolving in memory keeps the board and the register to a
 * handful of queries however many people are on screen.
 */
export class AttendanceContext {
  constructor(
    private readonly offices: Map<string, OfficeRow>,
    private readonly shifts: ShiftRow[],
    private readonly assignments: Array<{
      shiftId: string;
      employeeId: string | null;
      departmentId: string | null;
      effectiveFrom: Date;
      effectiveTo: Date | null;
      weeklyOffDays: unknown;
    }>,
    private readonly policies: PolicyRow[],
    private readonly holidays: Array<{
      id: string;
      name: string;
      date: Date;
      officeId: string | null;
      isOptional: boolean;
    }>,
    private readonly leaves: Array<{
      id: string;
      employeeId: string;
      fromDate: Date;
      toDate: Date;
      dayPart: 'FULL_DAY' | 'FIRST_HALF' | 'SECOND_HALF';
      leaveType: { isPaid: boolean };
    }>,
    private readonly employees: Map<string, ContextEmployee>,
  ) {}

  office(officeId: string): OfficeRow | undefined {
    return this.offices.get(officeId);
  }

  resolve(employeeId: string, date: string): ResolvedDay | null {
    const employee = this.employees.get(employeeId);
    const office = employee && this.offices.get(employee.officeId);
    if (!employee || !office) return null;

    const eligible =
      iso(employee.joiningDate) <= date && (!employee.exitDate || date <= iso(employee.exitDate));

    const applies = (a: { effectiveFrom: Date; effectiveTo: Date | null }) =>
      iso(a.effectiveFrom) <= date && (!a.effectiveTo || date < iso(a.effectiveTo));
    const latest = <T extends { effectiveFrom: Date }>(rows: T[]) =>
      rows.sort((x, y) => iso(y.effectiveFrom).localeCompare(iso(x.effectiveFrom)))[0];

    // A person's own assignment beats their department's, which beats the
    // company default.
    const personal = latest(
      this.assignments.filter((a) => a.employeeId === employeeId && applies(a)),
    );
    const departmental = employee.departmentId
      ? latest(
          this.assignments.filter((a) => a.departmentId === employee.departmentId && applies(a)),
        )
      : undefined;
    const assignment = personal ?? departmental;

    const shift =
      (assignment && this.shifts.find((s) => s.id === assignment.shiftId)) ??
      this.shifts.find((s) => s.isDefault) ??
      null;

    const weeklyOffDays = assignment?.weeklyOffDays
      ? asDays(assignment.weeklyOffDays, [])
      : asDays(office.weeklyOffDays, [0]);

    const holidayRow = this.holidays.find(
      (h) =>
        !h.isOptional && iso(h.date) === date && (h.officeId === null || h.officeId === office.id),
    );

    const leaveRows = this.leaves.filter(
      (l) => l.employeeId === employeeId && iso(l.fromDate) <= date && date <= iso(l.toDate),
    );
    // A half-day dayPart only makes sense for a single-day request; across a
    // range every day is a full day. A full day wins if both somehow overlap.
    const leaveRow =
      leaveRows.find((l) => l.dayPart === 'FULL_DAY' || iso(l.fromDate) !== iso(l.toDate)) ??
      leaveRows[0];

    const policyRow = this.pickPolicy(office.id, shift?.id ?? null);

    return {
      office,
      eligible,
      shift,
      shiftRule: shift
        ? {
            startTime: shift.startTime,
            endTime: shift.endTime,
            crossesMidnight: shift.crossesMidnight,
            breakMinutes: shift.breakMinutes,
            graceMinutes: shift.graceMinutes,
          }
        : null,
      policyRow,
      policy: policyRow ? toPolicyRule(policyRow) : fallbackPolicy(shift),
      weeklyOff: weeklyOffDays.includes(dayOfWeek(date)),
      weeklyOffDays,
      holiday: holidayRow ? { id: holidayRow.id, name: holidayRow.name } : null,
      leave: leaveRow
        ? {
            id: leaveRow.id,
            dayPart:
              iso(leaveRow.fromDate) !== iso(leaveRow.toDate) ? 'FULL_DAY' : leaveRow.dayPart,
            isPaid: leaveRow.leaveType.isPaid,
          }
        : null,
    };
  }

  /**
   * The most specific policy wins: one for this shift at this office, then for
   * this shift, then for this office, then the company default.
   */
  private pickPolicy(officeId: string, shiftId: string | null): PolicyRow | null {
    const score = (p: PolicyRow): number => {
      if (p.officeId && p.officeId !== officeId) return -1;
      if (p.shiftId && p.shiftId !== shiftId) return -1;
      if (p.shiftId && p.officeId) return 4;
      if (p.shiftId) return 3;
      if (p.officeId) return 2;
      return p.isDefault ? 1 : 0;
    };
    let best: PolicyRow | null = null;
    let bestScore = -1;
    for (const policy of this.policies) {
      const s = score(policy);
      if (s > bestScore) {
        best = policy;
        bestScore = s;
      }
    }
    return best;
  }
}

@Injectable()
export class AttendanceContextLoader {
  constructor(private readonly prisma: PrismaService) {}

  async load(employees: ContextEmployee[], from: string, to: string): Promise<AttendanceContext> {
    const officeIds = [...new Set(employees.map((e) => e.officeId))];
    const employeeIds = employees.map((e) => e.id);
    const departmentIds = [
      ...new Set(employees.map((e) => e.departmentId).filter(Boolean)),
    ] as string[];
    const rangeStart = new Date(`${from}T00:00:00.000Z`);
    const rangeEnd = new Date(`${to}T00:00:00.000Z`);

    const [offices, shifts, assignments, policies, holidays, leaves] = await Promise.all([
      this.prisma.scoped.office.findMany({ where: { id: { in: officeIds } } }),
      this.prisma.scoped.shift.findMany({ where: { deletedAt: null } }),
      this.prisma.scoped.shiftAssignment.findMany({
        where: {
          OR: [{ employeeId: { in: employeeIds } }, { departmentId: { in: departmentIds } }],
          effectiveFrom: { lte: rangeEnd },
          AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: rangeStart } }] }],
        },
      }),
      this.prisma.scoped.attendancePolicy.findMany({ where: { isActive: true } }),
      this.prisma.scoped.holiday.findMany({
        where: { date: { gte: rangeStart, lte: rangeEnd } },
      }),
      this.prisma.scoped.leaveRequest.findMany({
        where: {
          employeeId: { in: employeeIds },
          status: 'APPROVED',
          fromDate: { lte: rangeEnd },
          toDate: { gte: rangeStart },
        },
        include: { leaveType: { select: { isPaid: true } } },
      }),
    ]);

    return new AttendanceContext(
      new Map(offices.map((o) => [o.id, o as unknown as OfficeRow])),
      shifts,
      assignments,
      policies as unknown as PolicyRow[],
      holidays,
      leaves as never,
      new Map(employees.map((e) => [e.id, e])),
    );
  }
}

/** Dates from `from` to `to` inclusive. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
