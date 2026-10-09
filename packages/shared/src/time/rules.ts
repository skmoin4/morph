/**
 * Time-tracking rules, pure so the API, the grid and the tests share them.
 *
 * Decisions (also in docs/00-project-context.md):
 *  - A week runs Monday to Sunday and is the unit of submission and approval.
 *  - A timer entry is credited to the office-local date it was *started* on, even
 *    if it runs past midnight.
 *  - A timer stopped within a minute is thrown away; one left running is capped
 *    at 12 hours, so a forgotten timer cannot post a day's cost.
 *  - No one logs more than 24 hours on one date.
 *  - Hours are kept to two decimals; timers round to the nearest hundredth.
 *  - Only DRAFT, REJECTED and REOPENED weeks can be edited.
 */
import { round2 } from '../leave/rules';
import { addDays, startOfWeek } from '../utils/date';

export const MAX_TIMER_HOURS = 12;
export const MIN_TIMER_SECONDS = 60;
export const MAX_DAY_HOURS = 24;
/** How far back time can be logged. Older days need the sheet reopened. */
export const TIME_BACKDATE_DAYS = 90;

export type TimesheetStatusValue = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REOPENED';

export function weekStartOf(date: string): string {
  return startOfWeek(date);
}

export function weekEndOf(weekStart: string): string {
  return addDays(weekStart, 6);
}

/** The seven dates of a week, Monday first. */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function isMonday(date: string): boolean {
  return startOfWeek(date) === date;
}

export function editableStatus(status: TimesheetStatusValue): boolean {
  return status === 'DRAFT' || status === 'REJECTED' || status === 'REOPENED';
}

export interface TimerOutcome {
  /** Hours to record; 0 when the timer is discarded. */
  hours: number;
  /** Under a minute: nothing is saved. */
  discard: boolean;
  /** Stopped at the 12-hour ceiling rather than at its real length. */
  capped: boolean;
}

/** What a timer that ran from `start` to `end` is worth. */
export function timerHours(start: Date, end: Date): TimerOutcome {
  const seconds = Math.max(0, (end.getTime() - start.getTime()) / 1000);
  if (seconds < MIN_TIMER_SECONDS) return { hours: 0, discard: true, capped: false };
  const hours = seconds / 3600;
  if (hours > MAX_TIMER_HOURS) return { hours: MAX_TIMER_HOURS, discard: false, capped: true };
  return { hours: Math.max(0.01, round2(hours)), discard: false, capped: false };
}

/** Hours that still fit on a date, given what is already logged. */
export function dayRoom(alreadyLogged: number): number {
  return Math.max(0, round2(MAX_DAY_HOURS - alreadyLogged));
}

/** Seconds elapsed on a running timer, never negative. */
export function elapsedSeconds(startedAt: Date | string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(startedAt).getTime()) / 1000));
}
