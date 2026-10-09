import { describe, expect, it } from 'vitest';
import { officeLocalToUtc } from '../utils/date';
import {
  applyLateMarkPenalty,
  attributeDate,
  computeDay,
  ipAllowed,
  judgeGeofence,
  pairPunches,
  shiftWindow,
  type DayInput,
  type PolicyRule,
  type ShiftRule,
} from './engine';

const IST = 'Asia/Kolkata';
const RUH = 'Asia/Riyadh';

const GENERAL: ShiftRule = {
  startTime: '09:30',
  endTime: '18:30',
  crossesMidnight: false,
  breakMinutes: 60,
  graceMinutes: 10,
};
const NIGHT: ShiftRule = {
  startTime: '22:00',
  endTime: '06:00',
  crossesMidnight: true,
  breakMinutes: 45,
  graceMinutes: 15,
};
const POLICY: PolicyRule = {
  graceMinutes: 10,
  lateMarkAfterMinutes: 0,
  halfDayFromHours: 4,
  fullDayMinimumHours: 8,
  overtimeAfterHours: 9,
  earlyExitBeforeMinutes: 15,
  lateMarksPerHalfDay: 3,
};

const DATE = '2026-10-05'; // a Monday
const at = (date: string, time: string, tz = IST) => officeLocalToUtc(date, time, tz);

/** A finished Monday: "now" is well after the shift closed. */
function day(overrides: Partial<DayInput> & { punches?: Array<[string, string, 'IN' | 'OUT']> } = {}) {
  const { punches = [], ...rest } = overrides;
  return computeDay({
    date: DATE,
    timeZone: IST,
    weeklyOff: false,
    holiday: false,
    leave: null,
    shift: GENERAL,
    policy: POLICY,
    punches: punches.map(([d, t, type]) => ({ type, at: at(d, t) })),
    now: at('2026-10-07', '12:00'),
    ...rest,
  });
}

const inOut = (inTime: string, outTime: string): Array<[string, string, 'IN' | 'OUT']> => [
  [DATE, inTime, 'IN'],
  [DATE, outTime, 'OUT'],
];

describe('a normal working day', () => {
  it('is present for a full day on time', () => {
    const r = day({ punches: inOut('09:28', '18:35') });
    expect(r.status).toBe('PRESENT');
    expect(r.dayValue).toBe(1);
    expect(r.isLate).toBe(false);
    expect(r.isEarlyExit).toBe(false);
    // 7 minutes past nine hours at work: overtime is counted from the threshold.
    expect(r.overtimeMinutes).toBe(7);
    expect(r.final).toBe(true);
    // 547 minutes at work, less the 60-minute break.
    expect(r.presenceMinutes).toBe(547);
    expect(r.workedMinutes).toBe(487);
    expect(r.breakMinutes).toBe(60);
  });

  it('uses the grace period: late only once it has run out', () => {
    // Shift 09:30 + 10 min grace = 09:40.
    expect(day({ punches: inOut('09:40', '18:40') }).isLate).toBe(false);
    const late = day({ punches: inOut('09:41', '18:41') });
    expect(late.isLate).toBe(true);
    expect(late.lateMinutes).toBe(1);
    expect(late.status).toBe('LATE');
  });

  it('counts a late arrival who stays to the end as a full day, marked late', () => {
    const r = day({ punches: inOut('10:05', '18:35') });
    expect(r.status).toBe('LATE');
    expect(r.lateMinutes).toBe(25);
    expect(r.dayValue).toBe(1);
  });

  it('applies the extra tolerance before a late mark', () => {
    const tolerant = { ...POLICY, lateMarkAfterMinutes: 15 };
    // 09:50 is 10 minutes past grace — inside the 15 minutes of tolerance.
    expect(day({ policy: tolerant, punches: inOut('09:50', '18:50') }).isLate).toBe(false);
    expect(day({ policy: tolerant, punches: inOut('09:58', '18:58') }).isLate).toBe(true);
  });

  it('gives a half day for four to eight hours at work', () => {
    const r = day({ punches: inOut('09:30', '14:00') });
    expect(r.status).toBe('HALF_DAY');
    expect(r.dayValue).toBe(0.5);
    // No break is taken off a short visit.
    expect(r.breakMinutes).toBe(0);
    expect(r.workedMinutes).toBe(270);
  });

  it('marks under four hours absent and says why', () => {
    const r = day({ punches: inOut('09:30', '12:30') });
    expect(r.status).toBe('ABSENT');
    expect(r.dayValue).toBe(0);
    expect(r.flagReason).toMatch(/below the 4 h half-day minimum/);
  });

  it('treats the thresholds as inclusive', () => {
    expect(day({ punches: inOut('09:30', '17:30') }).status).toBe('PRESENT'); // exactly 8 h
    expect(day({ punches: inOut('09:30', '17:29') }).status).toBe('HALF_DAY');
    expect(day({ punches: inOut('09:30', '13:30') }).status).toBe('HALF_DAY'); // exactly 4 h
    expect(day({ punches: inOut('09:30', '13:29') }).status).toBe('ABSENT');
  });

  it('counts overtime beyond the overtime threshold', () => {
    const r = day({ punches: inOut('09:30', '20:30') });
    expect(r.presenceMinutes).toBe(660);
    expect(r.overtimeMinutes).toBe(120);
  });

  it('flags an early exit only past the allowance', () => {
    // Shift ends 18:30, allowance 15 minutes.
    const early = day({ punches: inOut('09:30', '17:45') });
    expect(early.isEarlyExit).toBe(true);
    expect(early.earlyExitMinutes).toBe(45);
    expect(day({ punches: inOut('09:30', '18:20') }).isEarlyExit).toBe(false);
    expect(day({ punches: inOut('09:30', '18:15') }).isEarlyExit).toBe(false); // exactly the allowance
    expect(day({ punches: inOut('09:30', '18:14') }).isEarlyExit).toBe(true);
  });
});

describe('several punches in a day', () => {
  it('sums the sessions and does not deduct a break the person already took', () => {
    const r = day({
      punches: [
        [DATE, '09:30', 'IN'],
        [DATE, '13:00', 'OUT'],
        [DATE, '14:00', 'IN'],
        [DATE, '18:30', 'OUT'],
      ],
    });
    expect(r.presenceMinutes).toBe(480);
    expect(r.breakMinutes).toBe(60); // the gap
    expect(r.workedMinutes).toBe(480);
    expect(r.status).toBe('PRESENT');
  });

  it('tops up a short lunch to the full break', () => {
    const r = day({
      punches: [
        [DATE, '09:30', 'IN'],
        [DATE, '13:00', 'OUT'],
        [DATE, '13:30', 'IN'],
        [DATE, '18:30', 'OUT'],
      ],
    });
    // 210 + 300 = 510 at work; a 30-minute gap, so a further 30 comes off.
    expect(r.presenceMinutes).toBe(510);
    expect(r.breakMinutes).toBe(60);
    expect(r.workedMinutes).toBe(480);
  });

  it('ignores a duplicate clock-in and orders punches by time, not by arrival', () => {
    const r = day({
      punches: [
        [DATE, '18:30', 'OUT'],
        [DATE, '09:30', 'IN'],
        [DATE, '09:31', 'IN'],
      ],
    });
    expect(r.firstInAt).toEqual(at(DATE, '09:30'));
    expect(r.lastOutAt).toEqual(at(DATE, '18:30'));
    expect(r.presenceMinutes).toBe(540);
  });

  it('flags a clock-out that has no clock-in', () => {
    const r = day({ punches: [[DATE, '18:30', 'OUT']] });
    expect(pairPunches([{ type: 'OUT', at: at(DATE, '18:30') }]).strayOut).toBe(true);
    expect(r.firstInAt).toBeNull();
    expect(r.status).toBe('ABSENT');
  });
});

describe('a day still in progress', () => {
  const midMorning = at(DATE, '11:00');

  it('is "not in yet", not absent, before anyone punches', () => {
    const r = day({ now: midMorning });
    expect(r.notInYet).toBe(true);
    expect(r.final).toBe(false);
  });

  it('shows the person as present or late while they are in, without judging the day', () => {
    const onTime = day({ now: midMorning, punches: [[DATE, '09:30', 'IN']] });
    expect(onTime.status).toBe('PRESENT');
    expect(onTime.clockedIn).toBe(true);
    expect(onTime.final).toBe(false);
    expect(onTime.dayValue).toBe(0);

    expect(day({ now: midMorning, punches: [[DATE, '10:15', 'IN']] }).status).toBe('LATE');
  });

  it('does not call a lunch-time clock-out an early exit', () => {
    const r = day({
      now: at(DATE, '13:30'),
      punches: inOut('09:30', '13:00'),
    });
    expect(r.isEarlyExit).toBe(false);
    expect(r.final).toBe(false);
  });

  it('stays open for hours after the shift ends, because people work late', () => {
    expect(day({ now: at(DATE, '20:00'), punches: [[DATE, '09:30', 'IN']] }).final).toBe(false);
    expect(day({ now: at(DATE, '22:31'), punches: [[DATE, '09:30', 'IN']] }).final).toBe(true);
  });
});

describe('a forgotten clock-out', () => {
  it('holds the day at a half day and says so, once the day is over', () => {
    const r = day({ punches: [[DATE, '09:30', 'IN']] });
    expect(r.status).toBe('HALF_DAY');
    expect(r.dayValue).toBe(0.5);
    expect(r.flagReason).toMatch(/No clock-out/);
    expect(r.lastOutAt).toBeNull();
  });

  it('judges the closed sessions and flags the dangling one', () => {
    const r = day({
      punches: [
        [DATE, '09:30', 'IN'],
        [DATE, '17:30', 'OUT'],
        [DATE, '18:00', 'IN'],
      ],
    });
    expect(r.status).toBe('PRESENT');
    expect(r.flagReason).toMatch(/Last clock-in has no clock-out/);
  });
});

describe('absence', () => {
  it('is absent on a finished working day with no punches', () => {
    const r = day();
    expect(r.status).toBe('ABSENT');
    expect(r.final).toBe(true);
    expect(r.notInYet).toBe(false);
  });
});

describe('weekly offs, holidays and leave', () => {
  it('records a weekly off with no credit', () => {
    const r = day({ weeklyOff: true });
    expect(r.status).toBe('WEEKLY_OFF');
    expect(r.dayValue).toBe(0);
    expect(r.notInYet).toBe(false);
  });

  it('records a holiday, and lets a holiday on a weekly off read as the weekly off', () => {
    expect(day({ holiday: true }).status).toBe('HOLIDAY');
    expect(day({ holiday: true, weeklyOff: true }).status).toBe('WEEKLY_OFF');
  });

  it('turns work on a day off into overtime, flagged', () => {
    const r = day({ weeklyOff: true, punches: inOut('10:00', '14:00') });
    expect(r.status).toBe('WEEKLY_OFF');
    expect(r.overtimeMinutes).toBe(240);
    expect(r.flagReason).toMatch(/weekly off/);
  });

  it('does not let leave eat a weekly off or a holiday', () => {
    const leave = { dayPart: 'FULL_DAY' as const, isPaid: true };
    expect(day({ weeklyOff: true, leave }).status).toBe('WEEKLY_OFF');
    expect(day({ holiday: true, leave }).status).toBe('HOLIDAY');
  });

  it('credits paid full-day leave and not unpaid', () => {
    expect(day({ leave: { dayPart: 'FULL_DAY', isPaid: true } })).toMatchObject({
      status: 'ON_LEAVE',
      dayValue: 1,
    });
    expect(day({ leave: { dayPart: 'FULL_DAY', isPaid: false } })).toMatchObject({
      status: 'ON_LEAVE',
      dayValue: 0,
    });
  });

  it('flags punching on a day of approved leave but keeps it as leave', () => {
    const r = day({
      leave: { dayPart: 'FULL_DAY', isPaid: true },
      punches: inOut('09:30', '18:30'),
    });
    expect(r.status).toBe('ON_LEAVE');
    expect(r.flagReason).toMatch(/approved leave/);
  });
});

describe('half-day leave', () => {
  const morningOff = { dayPart: 'FIRST_HALF' as const, isPaid: true };
  const afternoonOff = { dayPart: 'SECOND_HALF' as const, isPaid: true };

  it('expects the second half to be worked in full, from the shift midpoint', () => {
    // Shift 09:30–18:30: midpoint 14:00. Grace 10 minutes.
    const onTime = day({ leave: morningOff, punches: inOut('14:00', '18:30') });
    expect(onTime.status).toBe('PRESENT');
    expect(onTime.dayValue).toBe(1);
    expect(onTime.isLate).toBe(false);

    const late = day({ leave: morningOff, punches: inOut('14:30', '18:50') });
    expect(late.status).toBe('LATE');
    expect(late.lateMinutes).toBe(20);
  });

  it('expects the first half to be worked when the afternoon is leave', () => {
    const r = day({ leave: afternoonOff, punches: inOut('09:30', '14:00') });
    expect(r.status).toBe('PRESENT');
    expect(r.dayValue).toBe(1);
    expect(r.isEarlyExit).toBe(false);
  });

  it('leaves only the leave credit when the working half is not completed', () => {
    expect(day({ leave: morningOff })).toMatchObject({ status: 'ON_LEAVE', dayValue: 0.5 });
    expect(
      day({ leave: { dayPart: 'FIRST_HALF', isPaid: false } }),
    ).toMatchObject({ status: 'ON_LEAVE', dayValue: 0 });
    const short = day({ leave: morningOff, punches: inOut('14:00', '15:00') });
    expect(short.status).toBe('ON_LEAVE');
    expect(short.dayValue).toBe(0.5);
  });
});

describe('the office time zone', () => {
  it('judges a Riyadh day by Riyadh time, not India time', () => {
    const riyadhShift: ShiftRule = { ...GENERAL, startTime: '08:00', endTime: '17:00' };
    const punches = [
      { type: 'IN' as const, at: at(DATE, '07:55', RUH) },
      { type: 'OUT' as const, at: at(DATE, '17:05', RUH) },
    ];
    const r = computeDay({
      date: DATE,
      timeZone: RUH,
      weeklyOff: false,
      holiday: false,
      leave: null,
      shift: riyadhShift,
      policy: POLICY,
      punches,
      now: at('2026-10-07', '12:00', RUH),
    });
    expect(r.status).toBe('PRESENT');
    expect(r.isLate).toBe(false);

    // The same instants read against an India shift would be hours "late".
    const wrong = computeDay({
      date: DATE,
      timeZone: IST,
      weeklyOff: false,
      holiday: false,
      leave: null,
      shift: GENERAL,
      policy: POLICY,
      punches,
      now: at('2026-10-07', '12:00'),
    });
    expect(wrong.isLate).toBe(true);
  });
});

describe('a night shift', () => {
  it('runs past midnight and still belongs to the day it started', () => {
    const { start, end } = shiftWindow('2026-10-05', NIGHT, IST);
    expect(start).toEqual(at('2026-10-05', '22:00'));
    expect(end).toEqual(at('2026-10-06', '06:00'));

    const policy = { ...POLICY, fullDayMinimumHours: 7.5, overtimeAfterHours: 8, halfDayFromHours: 4 };
    const r = computeDay({
      date: '2026-10-05',
      timeZone: IST,
      weeklyOff: false,
      holiday: false,
      leave: null,
      shift: NIGHT,
      policy,
      punches: [
        { type: 'IN', at: at('2026-10-05', '21:55') },
        { type: 'OUT', at: at('2026-10-06', '06:05') },
      ],
      now: at('2026-10-06', '14:00'),
    });
    expect(r.status).toBe('PRESENT');
    expect(r.presenceMinutes).toBe(490);
    expect(r.isLate).toBe(false);
    expect(r.isEarlyExit).toBe(false);
  });

  it('attributes the morning clock-out to the shift that started the night before', () => {
    const shiftFor = () => NIGHT;
    expect(attributeDate(at('2026-10-06', '05:58'), IST, shiftFor)).toBe('2026-10-05');
    expect(attributeDate(at('2026-10-05', '21:50'), IST, shiftFor)).toBe('2026-10-05');
    // The next night's arrival belongs to the next day.
    expect(attributeDate(at('2026-10-06', '21:50'), IST, shiftFor)).toBe('2026-10-06');
  });

  it('keeps an ordinary day on its own calendar date', () => {
    const shiftFor = () => GENERAL;
    expect(attributeDate(at(DATE, '09:20'), IST, shiftFor)).toBe(DATE);
    expect(attributeDate(at(DATE, '19:40'), IST, shiftFor)).toBe(DATE);
    // No shift at all: the calendar date, whatever the hour.
    expect(attributeDate(at(DATE, '03:00'), IST, () => null)).toBe(DATE);
  });
});

describe('late marks per half day', () => {
  const days = (statuses: Array<[string, 'LATE' | 'PRESENT']>) =>
    statuses.map(([date, status]) => ({ date, status, dayValue: 1 }));

  it('costs half a day on every Nth late mark, in date order', () => {
    const month = days([
      ['2026-10-01', 'LATE'],
      ['2026-10-02', 'PRESENT'],
      ['2026-10-05', 'LATE'],
      ['2026-10-06', 'LATE'],
      ['2026-10-07', 'LATE'],
      ['2026-10-08', 'LATE'],
      ['2026-10-09', 'LATE'],
    ]);
    const adjusted = applyLateMarkPenalty(month, 3);
    // Late marks: 01, 05, 06(3rd), 07, 08, 09(6th).
    expect([...adjusted.keys()]).toEqual(['2026-10-06', '2026-10-09']);
    expect(adjusted.get('2026-10-06')).toBe(0.5);
  });

  it('does nothing when the rule is off or there are too few late marks', () => {
    expect(applyLateMarkPenalty(days([['2026-10-01', 'LATE']]), 0).size).toBe(0);
    expect(applyLateMarkPenalty(days([['2026-10-01', 'LATE'], ['2026-10-02', 'LATE']]), 3).size).toBe(0);
  });

  it('does not depend on the order the days arrive in', () => {
    const shuffled = days([
      ['2026-10-07', 'LATE'],
      ['2026-10-01', 'LATE'],
      ['2026-10-05', 'LATE'],
    ]);
    expect([...applyLateMarkPenalty(shuffled, 3).keys()]).toEqual(['2026-10-07']);
  });
});

describe('office network allow-list', () => {
  const list = ['103.21.58.0/24', '127.0.0.1', '::1', '212.118.10.42'];

  it('matches CIDR ranges and exact addresses', () => {
    expect(ipAllowed('103.21.58.17', list)).toBe(true);
    expect(ipAllowed('103.21.58.255', list)).toBe(true);
    expect(ipAllowed('103.21.59.1', list)).toBe(false);
    expect(ipAllowed('212.118.10.42', list)).toBe(true);
    expect(ipAllowed('212.118.10.43', list)).toBe(false);
    expect(ipAllowed('::1', list)).toBe(true);
  });

  it('sees through IPv4-mapped IPv6 addresses', () => {
    expect(ipAllowed('::ffff:103.21.58.17', list)).toBe(true);
    expect(ipAllowed('::ffff:8.8.8.8', list)).toBe(false);
  });

  it('handles the CIDR edges', () => {
    expect(ipAllowed('10.0.0.1', ['0.0.0.0/0'])).toBe(true);
    expect(ipAllowed('10.0.0.1', ['10.0.0.1/32'])).toBe(true);
    expect(ipAllowed('10.0.0.2', ['10.0.0.1/32'])).toBe(false);
    expect(ipAllowed('192.168.1.200', ['192.168.1.128/25'])).toBe(true);
    expect(ipAllowed('192.168.1.100', ['192.168.1.128/25'])).toBe(false);
  });

  it('refuses when there is nothing to match, and never allows on garbage', () => {
    expect(ipAllowed(undefined, list)).toBe(false);
    expect(ipAllowed('1.2.3.4', [])).toBe(false);
    expect(ipAllowed('1.2.3.4', null)).toBe(false);
    expect(ipAllowed('1.2.3.4', ['not-an-ip', '999.1.1.1/8', '1.2.3.4/99', 42, ''])).toBe(false);
    expect(ipAllowed('1.2.3.4', ['  1.2.3.4  '])).toBe(true);
  });
});

describe('geofence', () => {
  const site = { latitude: 19.076, longitude: 72.8777, radiusM: 120, mode: 'FLAG' as const };

  it('lets a punch inside the radius through clean', () => {
    expect(judgeGeofence(site, 80)).toEqual({
      allowed: true,
      distanceM: 80,
      within: true,
      flagReason: null,
    });
    expect(judgeGeofence(site, 120)).toMatchObject({ allowed: true, within: true });
  });

  it('flags an outside punch where the site only flags', () => {
    const v = judgeGeofence(site, 310);
    expect(v).toMatchObject({ allowed: true, within: false });
    expect((v as { flagReason: string }).flagReason).toMatch(/310 m from the site pin \(limit 120 m\)/);
  });

  it('refuses an outside punch where the site rejects', () => {
    const v = judgeGeofence({ ...site, mode: 'REJECT' }, 121);
    expect(v).toMatchObject({ allowed: false, code: 'OUTSIDE_GEOFENCE', distanceM: 121 });
    expect(judgeGeofence({ ...site, mode: 'REJECT' }, 120).allowed).toBe(true);
  });

  it('flags — rather than blocks — a site with no map pin', () => {
    const v = judgeGeofence({ ...site, latitude: null, longitude: null, mode: 'REJECT' }, null);
    expect(v).toMatchObject({ allowed: true, within: null });
  });

  it('flags a fix too vague to trust', () => {
    const v = judgeGeofence(site, 50, 400);
    expect(v).toMatchObject({ allowed: true, within: true });
    expect((v as { flagReason: string }).flagReason).toMatch(/±400 m/);
    expect(judgeGeofence(site, 50, 30)).toMatchObject({ flagReason: null });
  });
});
