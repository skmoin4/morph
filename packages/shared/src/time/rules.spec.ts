import { describe, expect, it } from 'vitest';
import { round2 } from '../leave/rules';
import {
  dayRoom,
  editableStatus,
  elapsedSeconds,
  isMonday,
  MAX_TIMER_HOURS,
  timerHours,
  weekDates,
  weekEndOf,
  weekStartOf,
} from './rules';

const at = (hhmmss: string, day = '2026-10-05') => new Date(`${day}T${hhmmss}.000Z`);

describe('weeks', () => {
  it('start on Monday, whatever day you ask from', () => {
    expect(weekStartOf('2026-10-05')).toBe('2026-10-05'); // Monday
    expect(weekStartOf('2026-10-09')).toBe('2026-10-05'); // Friday
    expect(weekStartOf('2026-10-11')).toBe('2026-10-05'); // Sunday belongs to the week before
    expect(weekStartOf('2026-10-12')).toBe('2026-10-12');
  });
  it('end on Sunday', () => {
    expect(weekEndOf('2026-10-05')).toBe('2026-10-11');
  });
  it('lists seven dates, across a month end', () => {
    expect(weekDates('2026-09-28')).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
  });
  it('knows a Monday', () => {
    expect(isMonday('2026-10-05')).toBe(true);
    expect(isMonday('2026-10-06')).toBe(false);
  });
});

describe('timerHours', () => {
  it('rounds to the nearest hundredth of an hour', () => {
    // 1h 20m = 1.3333 h
    expect(timerHours(at('09:00:00'), at('10:20:00')).hours).toBe(1.33);
    // 90 minutes
    expect(timerHours(at('09:00:00'), at('10:30:00')).hours).toBe(1.5);
    // 2h 45m 30s = 2.7583 h
    expect(timerHours(at('09:00:00'), at('11:45:30')).hours).toBe(2.76);
  });
  it('throws away a timer under a minute', () => {
    expect(timerHours(at('09:00:00'), at('09:00:59'))).toEqual({
      hours: 0,
      discard: true,
      capped: false,
    });
  });
  it('keeps a timer of exactly a minute, as at least 0.01 h', () => {
    const r = timerHours(at('09:00:00'), at('09:01:00'));
    expect(r.discard).toBe(false);
    expect(r.hours).toBe(0.02);
  });
  it('treats a clock that ran backwards as nothing', () => {
    expect(timerHours(at('10:00:00'), at('09:00:00')).discard).toBe(true);
  });
  it('caps a forgotten timer at twelve hours', () => {
    const r = timerHours(at('09:00:00'), at('09:00:00', '2026-10-06'));
    expect(r).toEqual({ hours: MAX_TIMER_HOURS, discard: false, capped: true });
  });
  it('does not cap exactly twelve hours', () => {
    const r = timerHours(at('09:00:00'), at('21:00:00'));
    expect(r.hours).toBe(12);
    expect(r.capped).toBe(false);
  });
});

describe('dayRoom', () => {
  it('is what is left of 24 hours', () => {
    expect(dayRoom(0)).toBe(24);
    expect(dayRoom(7.5)).toBe(16.5);
    expect(dayRoom(24)).toBe(0);
    expect(dayRoom(30)).toBe(0);
  });
});

describe('editableStatus', () => {
  it('lets a week be edited until it is submitted or approved', () => {
    expect(editableStatus('DRAFT')).toBe(true);
    expect(editableStatus('REJECTED')).toBe(true);
    expect(editableStatus('REOPENED')).toBe(true);
    expect(editableStatus('SUBMITTED')).toBe(false);
    expect(editableStatus('APPROVED')).toBe(false);
  });
});

describe('small helpers', () => {
  it('rounds to two decimals without drift', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(2.5)).toBe(2.5);
  });
  it('measures elapsed seconds, never negative', () => {
    expect(elapsedSeconds(at('09:00:00'), at('09:01:30'))).toBe(90);
    expect(elapsedSeconds(at('09:05:00'), at('09:00:00'))).toBe(0);
  });
});
