import { describe, expect, it } from 'vitest';
import {
  approvalCompletes,
  availableDays,
  carryForwardAmount,
  closingDays,
  countLeaveDays,
  eachDate,
  floorToHalf,
  leaveYearOf,
  nextLeaveStage,
  openingForYear,
  type LeaveCalendarDay,
} from './rules';

const cal = (
  from: string,
  to: string,
  weeklyOff: number[] = [],
  holidays: Record<string, string> = {},
): LeaveCalendarDay[] =>
  eachDate(from, to).map((date) => ({
    date,
    weeklyOff: weeklyOff.includes(new Date(`${date}T00:00:00Z`).getUTCDay()),
    holiday: holidays[date] ?? null,
  }));

describe('eachDate', () => {
  it('is inclusive and handles month and year ends', () => {
    expect(eachDate('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });
  it('is empty when the range is backwards', () => {
    expect(eachDate('2026-10-05', '2026-10-04')).toEqual([]);
  });
  it('includes 29 Feb in a leap year', () => {
    expect(eachDate('2028-02-28', '2028-03-01')).toHaveLength(3);
  });
});

describe('countLeaveDays', () => {
  it('counts a plain working week', () => {
    // Mon 05 .. Fri 09 Oct 2026, Sunday off.
    const r = countLeaveDays(cal('2026-10-05', '2026-10-09', [0]));
    expect(r.totalDays).toBe(5);
    expect(r.skipped).toEqual([]);
  });

  it('does not charge the weekly off inside the range', () => {
    // Fri 09 to Tue 13 Oct: Sat counts (Sunday-only week off), Sun is free.
    const r = countLeaveDays(cal('2026-10-09', '2026-10-13', [0]));
    expect(r.totalDays).toBe(4);
    expect(r.skipped.map((s) => s.reason)).toEqual(['WEEKLY_OFF']);
  });

  it('does not charge a holiday and says which one', () => {
    const r = countLeaveDays(cal('2026-10-19', '2026-10-21', [0], { '2026-10-20': 'Diwali' }));
    expect(r.totalDays).toBe(2);
    expect(r.skipped).toEqual([{ date: '2026-10-20', reason: 'HOLIDAY', holiday: 'Diwali' }]);
  });

  it('costs nothing when the whole range is off', () => {
    // A Sunday on its own.
    const r = countLeaveDays(cal('2026-10-11', '2026-10-11', [0]));
    expect(r.totalDays).toBe(0);
    expect(r.workingDates).toEqual([]);
  });

  it('counts a half day as 0.5 on a single working day', () => {
    expect(countLeaveDays(cal('2026-10-07', '2026-10-07', [0]), 'FIRST_HALF').totalDays).toBe(0.5);
    expect(countLeaveDays(cal('2026-10-07', '2026-10-07', [0]), 'SECOND_HALF').totalDays).toBe(0.5);
  });

  it('ignores a half-day flag on a range of several days', () => {
    expect(countLeaveDays(cal('2026-10-07', '2026-10-08', [0]), 'FIRST_HALF').totalDays).toBe(2);
  });

  it('a half day on a day off is still nothing', () => {
    expect(countLeaveDays(cal('2026-10-11', '2026-10-11', [0]), 'FIRST_HALF').totalDays).toBe(0);
  });

  it('counts a six-day week properly', () => {
    // Mon 05 .. Sun 11 with only Sunday off.
    expect(countLeaveDays(cal('2026-10-05', '2026-10-11', [0])).totalDays).toBe(6);
  });

  it('handles a Friday-Saturday weekend (Riyadh)', () => {
    // Sun 04 .. Sat 10 Oct, Fri and Sat off.
    expect(countLeaveDays(cal('2026-10-04', '2026-10-10', [5, 6])).totalDays).toBe(5);
  });
});

describe('leaveYearOf', () => {
  it('is the calendar year', () => {
    expect(leaveYearOf('2026-01-01')).toBe(2026);
    expect(leaveYearOf('2026-12-31')).toBe(2026);
  });
});

describe('floorToHalf', () => {
  it('rounds down to a half', () => {
    expect(floorToHalf(7.9)).toBe(7.5);
    expect(floorToHalf(7.5)).toBe(7.5);
    expect(floorToHalf(7.49)).toBe(7);
    expect(floorToHalf(0.4)).toBe(0);
  });
});

describe('openingForYear', () => {
  it('gives a long-standing employee the full quota', () => {
    expect(openingForYear(12, '2024-04-15', 2026)).toBe(12);
  });
  it('prorates a joiner by the months left, joining month included', () => {
    expect(openingForYear(12, '2026-01-20', 2026)).toBe(12);
    expect(openingForYear(12, '2026-07-01', 2026)).toBe(6);
    expect(openingForYear(18, '2026-10-05', 2026)).toBe(4.5);
    expect(openingForYear(8, '2026-12-31', 2026)).toBe(0.5);
  });
  it('gives nothing for a year before joining', () => {
    expect(openingForYear(12, '2027-01-05', 2026)).toBe(0);
  });
  it('rounds down to half days', () => {
    // 8 * 5/12 = 3.33 -> 3
    expect(openingForYear(8, '2026-08-01', 2026)).toBe(3);
  });
});

describe('balances', () => {
  const b = { opening: 12, accrued: 0, carriedForward: 3, used: 4, pending: 2 };
  it('available subtracts used and pending', () => {
    expect(availableDays(b)).toBe(9);
  });
  it('closing ignores pending', () => {
    expect(closingDays(b)).toBe(11);
  });
  it('avoids float drift', () => {
    expect(
      availableDays({ opening: 0.1, accrued: 0.2, carriedForward: 0, used: 0, pending: 0 }),
    ).toBe(0.3);
  });
});

describe('carryForwardAmount', () => {
  it('carries everything when there is no cap', () => {
    expect(carryForwardAmount(10, true, null)).toBe(10);
  });
  it('caps it', () => {
    expect(carryForwardAmount(40, true, 30)).toBe(30);
    expect(carryForwardAmount(5, true, 30)).toBe(5);
  });
  it('carries nothing when switched off or overdrawn', () => {
    expect(carryForwardAmount(10, false, 30)).toBe(0);
    expect(carryForwardAmount(-2, true, 30)).toBe(0);
    expect(carryForwardAmount(0, true, null)).toBe(0);
  });
});

describe('approval stages', () => {
  it('single level finishes at the first decision', () => {
    expect(nextLeaveStage('SINGLE_LEVEL', false)).toBe(1);
    expect(approvalCompletes('SINGLE_LEVEL', 1, false)).toBe(true);
  });
  it('two levels needs a second decision', () => {
    expect(nextLeaveStage('TEAM_LEAD_THEN_MANAGER', false)).toBe(1);
    expect(approvalCompletes('TEAM_LEAD_THEN_MANAGER', 1, false)).toBe(false);
    expect(nextLeaveStage('TEAM_LEAD_THEN_MANAGER', true)).toBe(2);
    expect(approvalCompletes('TEAM_LEAD_THEN_MANAGER', 2, false)).toBe(true);
  });
  it('someone who sees everyone can finish a two-level request alone', () => {
    expect(approvalCompletes('TEAM_LEAD_THEN_MANAGER', 1, true)).toBe(true);
  });
});
