/**
 * Leave rules, kept pure so the API, the apply form and the tests all use the
 * same arithmetic.
 *
 * Decisions (also in docs/00-project-context.md):
 *  - The leave year is the calendar year. A request cannot straddle two years;
 *    the employee applies once per year, so every request draws on one balance.
 *  - Only working days count: weekly offs and (non-optional) holidays inside a
 *    range are free, exactly as the attendance engine sees them.
 *  - A half day is a single working day with `FIRST_HALF` or `SECOND_HALF` and
 *    counts 0.5.
 *  - A joiner's first-year quota is prorated by whole months (joining month
 *    included) and rounded down to the nearest half day.
 *  - Carry forward moves unused balance into the next year, capped; it is only
 *    ever worked out once, when the next year's balance is first created.
 */
import { addDays } from '../utils/date';

export type LeaveDayPartValue = 'FULL_DAY' | 'FIRST_HALF' | 'SECOND_HALF';

export interface LeaveCalendarDay {
  date: string;
  weeklyOff: boolean;
  /** Name of a non-optional holiday on that day, if any. */
  holiday: string | null;
}

export interface SkippedLeaveDay {
  date: string;
  reason: 'WEEKLY_OFF' | 'HOLIDAY';
  holiday: string | null;
}

export interface LeaveDayCount {
  /** Working days the request uses up. 0.5 for a half day. */
  totalDays: number;
  /** The working dates that count. */
  workingDates: string[];
  /** Days inside the range that cost nothing, with why. */
  skipped: SkippedLeaveDay[];
}

/** Every date from `from` to `to`, inclusive. Empty when `to` is before `from`. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) out.push(day);
  return out;
}

/** The leave year a date belongs to. */
export function leaveYearOf(date: string): number {
  return Number(date.slice(0, 4));
}

/**
 * Working days a leave range consumes. `days` is the office calendar for every
 * date in the range, in order.
 */
export function countLeaveDays(
  days: LeaveCalendarDay[],
  dayPart: LeaveDayPartValue = 'FULL_DAY',
): LeaveDayCount {
  const workingDates: string[] = [];
  const skipped: SkippedLeaveDay[] = [];
  for (const day of days) {
    if (day.weeklyOff) skipped.push({ date: day.date, reason: 'WEEKLY_OFF', holiday: null });
    else if (day.holiday)
      skipped.push({ date: day.date, reason: 'HOLIDAY', holiday: day.holiday });
    else workingDates.push(day.date);
  }
  const half = dayPart !== 'FULL_DAY' && workingDates.length === 1 && days.length === 1;
  return { totalDays: half ? 0.5 : workingDates.length, workingDates, skipped };
}

/** Rounds down to the nearest half day. */
export function floorToHalf(value: number): number {
  return Math.floor(value * 2 + 1e-9) / 2;
}

/**
 * Quota for a year. Someone who joined earlier than `year` gets all of it; a
 * joiner in `year` gets the share of the year left, counting the joining month.
 */
export function openingForYear(quota: number, joiningDate: string, year: number): number {
  const joinYear = Number(joiningDate.slice(0, 4));
  if (joinYear < year) return quota;
  if (joinYear > year) return 0;
  const monthsLeft = 12 - (Number(joiningDate.slice(5, 7)) - 1);
  return floorToHalf((quota * monthsLeft) / 12);
}

export interface BalanceFigures {
  opening: number;
  accrued: number;
  carriedForward: number;
  used: number;
  pending: number;
}

/** What the person can still apply for. */
export function availableDays(b: BalanceFigures): number {
  return round2(b.opening + b.accrued + b.carriedForward - b.used - b.pending);
}

/** What was left at the year's end, before pending requests: the carry-forward base. */
export function closingDays(b: BalanceFigures): number {
  return round2(b.opening + b.accrued + b.carriedForward - b.used);
}

/** Days that roll into next year. */
export function carryForwardAmount(
  closing: number,
  enabled: boolean,
  cap: number | null,
): number {
  if (!enabled || closing <= 0) return 0;
  return cap === null ? closing : Math.min(closing, cap);
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Who decides next, for a request still waiting.
 *   SINGLE_LEVEL           one decision finishes it.
 *   TEAM_LEAD_THEN_MANAGER the first decision moves it to level 2; the second,
 *                          by a different person, finishes it. Someone whose
 *                          scope is everyone (HR, CEO) may finish it in one go.
 */
export type LeaveFlow = 'SINGLE_LEVEL' | 'TEAM_LEAD_THEN_MANAGER';

export function nextLeaveStage(flow: LeaveFlow, level1Done: boolean): 1 | 2 {
  return flow === 'TEAM_LEAD_THEN_MANAGER' && level1Done ? 2 : 1;
}

/** Does approving at `stage` finish the request? */
export function approvalCompletes(
  flow: LeaveFlow,
  stage: 1 | 2,
  deciderSeesEveryone: boolean,
): boolean {
  return flow === 'SINGLE_LEVEL' || stage === 2 || deciderSeesEveryone;
}
