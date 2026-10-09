import { addDays, dayOfWeek, officeLocalToUtc, toOfficeDateString } from '../utils/date';

/**
 * The attendance rule engine.
 *
 * Pure functions, no database and no clock of their own: everything a day's
 * result depends on is passed in, so the same code runs on a punch, in the
 * nightly job, in a regularisation, in a report — and in a test. All times are
 * UTC instants; "the day" is always the office's local calendar day.
 *
 * Decisions that are policy rather than arithmetic are called out where they
 * are made, and are the ones to confirm with the client.
 *
 * Hour thresholds (half day, full day, overtime) are measured against time
 * *at work* — the clocked-in span, break included. With the default policy
 * (full day 8 h, overtime after 9 h) and a 09:30–18:30 shift that means a late
 * arrival who stays to the end still completes the day, and overtime starts
 * when the shift ends. Paid hours (`workedMinutes`) are reported net of the
 * unpaid break.
 */

export type DayStatus =
  | 'PRESENT'
  | 'LATE'
  | 'HALF_DAY'
  | 'ABSENT'
  | 'ON_LEAVE'
  | 'HOLIDAY'
  | 'WEEKLY_OFF';

export interface ShiftRule {
  /** Office-local wall clock, "HH:mm". */
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  breakMinutes: number;
  graceMinutes: number;
}

export interface PolicyRule {
  graceMinutes: number;
  /** Minutes late beyond grace before the day is marked LATE. */
  lateMarkAfterMinutes: number;
  /** Worked hours from here up to the full-day minimum are a half day; below it, absent. */
  halfDayFromHours: number;
  fullDayMinimumHours: number;
  overtimeAfterHours: number;
  /** Leaving more than this many minutes before shift end is an early exit. */
  earlyExitBeforeMinutes: number;
  /** N late marks in a month cost half a day. 0 switches the rule off. */
  lateMarksPerHalfDay: number;
}

export interface DayLeave {
  dayPart: 'FULL_DAY' | 'FIRST_HALF' | 'SECOND_HALF';
  isPaid: boolean;
}

export interface PunchEvent {
  type: 'IN' | 'OUT';
  at: Date;
}

export interface DayInput {
  /** Office-local date, YYYY-MM-DD. */
  date: string;
  timeZone: string;
  weeklyOff: boolean;
  holiday: boolean;
  leave: DayLeave | null;
  shift: ShiftRule | null;
  policy: PolicyRule;
  punches: PunchEvent[];
  /** "Now", so a day still in progress is not judged as if it were over. */
  now: Date;
}

export interface DayResult {
  status: DayStatus;
  /** False while the day can still change: someone may yet punch in or out. */
  final: boolean;
  /** An open day, a working day, and nobody has punched: "not in yet", not "absent". */
  notInYet: boolean;
  firstInAt: Date | null;
  lastOutAt: Date | null;
  /** Paid hours: time clocked in, less the unpaid break. */
  workedMinutes: number;
  /** Time clocked in, break included — what the hour thresholds are measured against. */
  presenceMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  earlyExitMinutes: number;
  overtimeMinutes: number;
  isLate: boolean;
  isEarlyExit: boolean;
  /** Set when the punches need a human look. */
  flagReason: string | null;
  /** Clocked in and not yet out. */
  clockedIn: boolean;
  /** Day credit: 1 full, 0.5 half, 0 none. */
  dayValue: number;
}

/** A day is only judged over this long after the shift ends — people work late. */
export const DAY_CLOSE_GRACE_MINUTES = 240;

/**
 * A continuous stint longer than this has the unpaid break taken out of it. A
 * short visit (a half day) is not docked for a lunch it did not include.
 */
export const BREAK_DEDUCTION_AFTER_MINUTES = 300;

const MS = 60_000;
const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / MS);

// ---------------------------------------------------------------------------
// Shift windows
// ---------------------------------------------------------------------------

/** The shift's start and end as UTC instants, for the shift that *starts* on `date`. */
export function shiftWindow(date: string, shift: ShiftRule, timeZone: string) {
  const start = officeLocalToUtc(date, shift.startTime, timeZone);
  const endDate = shift.crossesMidnight ? addDays(date, 1) : date;
  const end = officeLocalToUtc(endDate, shift.endTime, timeZone);
  return { start, end };
}

/** True when the shift's end is before or at its start on the clock — it runs past midnight. */
export function endsNextDay(startTime: string, endTime: string): boolean {
  return endTime <= startTime;
}

/**
 * Which day a punch belongs to.
 *
 * Usually the office-local date of the punch. A night shift is the reason this
 * is not that simple: a 22:00–06:00 shift's 05:58 clock-out is on the *next*
 * calendar day but belongs to the shift that started the evening before. The
 * punch goes to the candidate day whose shift window (with 4 hours of slack
 * either side for early arrivals and late finishes) contains it; if several
 * do, the one that starts closest to the punch wins.
 */
export function attributeDate(
  at: Date,
  timeZone: string,
  shiftFor: (date: string) => ShiftRule | null,
): string {
  const local = toOfficeDateString(at, timeZone);
  const slack = 240 * MS;

  let best: { date: string; distance: number } | null = null;
  for (const candidate of [addDays(local, -1), local, addDays(local, 1)]) {
    const shift = shiftFor(candidate);
    if (!shift) continue;
    const { start, end } = shiftWindow(candidate, shift, timeZone);
    if (at.getTime() >= start.getTime() - slack && at.getTime() <= end.getTime() + slack) {
      const distance = Math.abs(at.getTime() - start.getTime());
      if (!best || distance < best.distance) best = { date: candidate, distance };
    }
  }
  return best?.date ?? local;
}

// ---------------------------------------------------------------------------
// One day
// ---------------------------------------------------------------------------

interface Session {
  from: Date;
  to: Date;
}

/** Pairs IN/OUT punches into sessions. Stray repeats are ignored, not errors. */
export function pairPunches(punches: PunchEvent[]) {
  const ordered = [...punches].sort((a, b) => a.at.getTime() - b.at.getTime());
  const sessions: Session[] = [];
  let open: Date | null = null;
  let firstIn: Date | null = null;
  let strayOut = false;

  for (const punch of ordered) {
    if (punch.type === 'IN') {
      if (!open) open = punch.at;
      firstIn ??= punch.at;
    } else if (open) {
      sessions.push({ from: open, to: punch.at });
      open = null;
    } else {
      strayOut = true;
    }
  }
  return { sessions, open, firstIn, strayOut };
}

export function computeDay(input: DayInput): DayResult {
  const { date, timeZone, policy, shift, now } = input;

  const base: DayResult = {
    status: 'ABSENT',
    final: true,
    notInYet: false,
    firstInAt: null,
    lastOutAt: null,
    workedMinutes: 0,
    presenceMinutes: 0,
    breakMinutes: 0,
    lateMinutes: 0,
    earlyExitMinutes: 0,
    overtimeMinutes: 0,
    isLate: false,
    isEarlyExit: false,
    flagReason: null,
    clockedIn: false,
    dayValue: 0,
  };

  const { sessions, open, firstIn, strayOut } = pairPunches(input.punches);
  const hasPunches = firstIn !== null;

  // --- When is this day over? -------------------------------------------------
  const window = shift ? shiftWindow(date, shift, timeZone) : null;
  const closesAt = window
    ? new Date(window.end.getTime() + DAY_CLOSE_GRACE_MINUTES * MS)
    : officeLocalToUtc(addDays(date, 1), '00:00', timeZone);
  const final = now.getTime() >= closesAt.getTime();

  // --- Hours worked, from closed sessions only ---------------------------------
  const grossMinutes = sessions.reduce((sum, s) => sum + minutesBetween(s.from, s.to), 0);
  const gapMinutes = sessions
    .slice(1)
    .reduce((sum, s, i) => sum + minutesBetween(sessions[i].to, s.from), 0);

  // The unpaid break comes off a long day unless the person already took it as
  // a gap between punches.
  const autoBreak =
    grossMinutes > BREAK_DEDUCTION_AFTER_MINUTES && shift
      ? Math.max(0, shift.breakMinutes - gapMinutes)
      : 0;
  const workedMinutes = Math.max(0, grossMinutes - autoBreak);
  const breakMinutes = gapMinutes + autoBreak;

  const lastOutAt = sessions.length > 0 ? sessions[sessions.length - 1].to : null;

  const evidence: DayResult = {
    ...base,
    final,
    firstInAt: firstIn,
    lastOutAt,
    workedMinutes,
    presenceMinutes: grossMinutes,
    breakMinutes,
    clockedIn: open !== null,
  };

  // --- Days that are not working days -----------------------------------------
  // Weekly offs and holidays win over leave and over everything else: leave
  // taken across a weekend does not eat the weekend.
  if (input.weeklyOff || input.holiday) {
    return {
      ...evidence,
      status: input.weeklyOff ? 'WEEKLY_OFF' : 'HOLIDAY',
      // Work on a day off is overtime in full.
      overtimeMinutes: grossMinutes,
      flagReason: hasPunches
        ? `Worked on a ${input.weeklyOff ? 'weekly off' : 'holiday'}`
        : null,
      dayValue: 0,
    };
  }

  // --- Approved leave -----------------------------------------------------------
  if (input.leave && input.leave.dayPart === 'FULL_DAY') {
    return {
      ...evidence,
      status: 'ON_LEAVE',
      dayValue: input.leave.isPaid ? 1 : 0,
      flagReason: hasPunches ? 'Punched on a day of approved leave' : null,
    };
  }

  // --- A working day -----------------------------------------------------------
  if (!hasPunches) {
    if (input.leave) {
      // Half a day of leave and no punches: the leave credit stands, and
      // nobody is expected at this hour yet if the working half is still ahead.
      return {
        ...evidence,
        status: 'ON_LEAVE',
        notInYet: !final,
        final,
        dayValue: final && input.leave.isPaid ? 0.5 : 0,
      };
    }
    if (!final) {
      // Still before the end of the day: not in *yet*.
      return { ...evidence, final: false, notInYet: true, status: 'ABSENT' };
    }
    return { ...evidence, status: 'ABSENT', flagReason: null };
  }

  // Half-day leave halves the day's expectations: the working half starts (or
  // ends) at the midpoint of the shift and the hour thresholds halve with it.
  const half = input.leave && input.leave.dayPart !== 'FULL_DAY' ? input.leave.dayPart : null;
  const scale = half ? 0.5 : 1;
  const leaveCredit = half && input.leave?.isPaid ? 0.5 : 0;

  let expectedStart: Date | null = window?.start ?? null;
  let expectedEnd: Date | null = window?.end ?? null;
  if (window && half) {
    const midpoint = new Date((window.start.getTime() + window.end.getTime()) / 2);
    if (half === 'FIRST_HALF') expectedStart = midpoint;
    else expectedEnd = midpoint;
  }

  // Lateness: arriving after start + grace. `lateMarkAfterMinutes` is extra
  // tolerance before it counts as a mark.
  let lateMinutes = 0;
  if (expectedStart) {
    const onTimeUntil = expectedStart.getTime() + policy.graceMinutes * MS;
    lateMinutes = Math.max(0, Math.round((firstIn!.getTime() - onTimeUntil) / MS));
  }
  const isLate = lateMinutes > policy.lateMarkAfterMinutes;

  // Leaving early only means something once the day cannot change any more (a
  // lunch-time clock-out is not an early exit) and nobody is still clocked in.
  let earlyExitMinutes = 0;
  if (final && expectedEnd && lastOutAt && !open) {
    const early = Math.round((expectedEnd.getTime() - lastOutAt.getTime()) / MS);
    if (early > policy.earlyExitBeforeMinutes) earlyExitMinutes = early;
  }

  const overtimeMinutes = Math.max(
    0,
    grossMinutes - Math.round(policy.overtimeAfterHours * 60 * scale),
  );

  const fullMinutes = policy.fullDayMinimumHours * 60 * scale;
  const halfMinutes = policy.halfDayFromHours * 60 * scale;

  const flags: string[] = [];
  if (strayOut) flags.push('Clock-out with no matching clock-in');

  const missingOut = open !== null && final;
  let status: DayStatus;
  let dayValue: number;

  if (!final) {
    // Mid-day: they are in (or have been). The day is judged when it is over,
    // so there is no credit yet — only a status the live board can show.
    status = isLate ? 'LATE' : 'PRESENT';
    dayValue = 0;
  } else if (half) {
    // Half a day of leave: the other half has to be worked in full. Anything
    // less leaves just the leave credit.
    if (missingOut && sessions.length === 0) {
      status = 'ON_LEAVE';
      dayValue = leaveCredit;
      flags.push('No clock-out — regularise to credit the working half');
    } else if (grossMinutes >= fullMinutes) {
      status = isLate ? 'LATE' : 'PRESENT';
      dayValue = Math.min(1, leaveCredit + 0.5);
    } else {
      status = 'ON_LEAVE';
      dayValue = leaveCredit;
      flags.push('Worked less than the half day expected');
    }
  } else if (missingOut && sessions.length === 0) {
    // Punched in, never out. There are no hours to judge, so the day is held at
    // a half day until a regularisation supplies the clock-out. (Policy decision.)
    status = 'HALF_DAY';
    dayValue = 0.5;
    flags.push('No clock-out — regularise to credit the full day');
  } else if (grossMinutes >= fullMinutes) {
    status = isLate ? 'LATE' : 'PRESENT';
    dayValue = 1;
  } else if (grossMinutes >= halfMinutes) {
    status = 'HALF_DAY';
    dayValue = 0.5;
  } else {
    status = 'ABSENT';
    dayValue = 0;
    flags.push(
      `At work ${(grossMinutes / 60).toFixed(1)} h, below the ${policy.halfDayFromHours} h half-day minimum`,
    );
  }

  if (missingOut && sessions.length > 0) flags.push('Last clock-in has no clock-out');

  return {
    ...evidence,
    status,
    notInYet: false,
    lateMinutes,
    isLate,
    earlyExitMinutes,
    isEarlyExit: earlyExitMinutes > 0,
    overtimeMinutes,
    dayValue,
    flagReason: flags.length > 0 ? flags.join('; ') : null,
  };
}

// ---------------------------------------------------------------------------
// Month-level rule
// ---------------------------------------------------------------------------

/**
 * "Late marks per half day": every Nth LATE day in a month costs half a day.
 *
 * Applied across a whole month in date order, so the 3rd, 6th and 9th late
 * mark are the ones that lose half a day — not a flat deduction at month end.
 * Returns the days whose credit changes; unaffected days are not mentioned.
 */
export function applyLateMarkPenalty(
  days: Array<{ date: string; status: DayStatus; dayValue: number }>,
  lateMarksPerHalfDay: number,
): Map<string, number> {
  const adjusted = new Map<string, number>();
  if (lateMarksPerHalfDay <= 0) return adjusted;

  let lateMarks = 0;
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    if (day.status !== 'LATE') continue;
    lateMarks += 1;
    if (lateMarks % lateMarksPerHalfDay === 0) {
      adjusted.set(day.date, Math.max(0, day.dayValue - 0.5));
    }
  }
  return adjusted;
}

// ---------------------------------------------------------------------------
// Where a punch came from
// ---------------------------------------------------------------------------

/** "::ffff:1.2.3.4" is IPv4 wearing IPv6 clothes. */
export function normaliseIp(ip: string): string {
  const trimmed = ip.trim();
  return trimmed.toLowerCase().startsWith('::ffff:') ? trimmed.slice(7) : trimmed;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

/**
 * Whether `ip` is on an office's allow-list. Entries are plain addresses or
 * IPv4 CIDR ranges ("103.21.58.0/24"); anything unparseable is ignored rather
 * than allowing everything or throwing at punch time.
 */
export function ipAllowed(ip: string | null | undefined, allowList: unknown): boolean {
  if (!ip || !Array.isArray(allowList)) return false;
  const address = normaliseIp(ip);
  const addressInt = ipv4ToInt(address);

  return allowList.some((entry) => {
    if (typeof entry !== 'string') return false;
    const rule = entry.trim();
    if (!rule) return false;

    if (!rule.includes('/')) return normaliseIp(rule) === address;

    const [network, bitsText] = rule.split('/');
    const bits = Number(bitsText);
    const networkInt = ipv4ToInt(normaliseIp(network));
    if (addressInt === null || networkInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
      return false;
    }
    if (bits === 0) return true;
    const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
    return ((addressInt & mask) >>> 0) === ((networkInt & mask) >>> 0);
  });
}

// ---------------------------------------------------------------------------
// Geofence
// ---------------------------------------------------------------------------

export interface GeofenceSite {
  latitude: number | null;
  longitude: number | null;
  radiusM: number;
  /** FLAG lets an out-of-range punch through marked for review; REJECT refuses it. */
  mode: 'FLAG' | 'REJECT';
}

export type GeofenceVerdict =
  | { allowed: true; distanceM: number | null; within: boolean | null; flagReason: string | null }
  | { allowed: false; code: 'OUTSIDE_GEOFENCE'; distanceM: number; message: string };

/** Pure geofence decision; the haversine distance is passed in so this stays testable. */
export function judgeGeofence(
  site: GeofenceSite,
  distanceM: number | null,
  accuracyM?: number | null,
): GeofenceVerdict {
  if (site.latitude === null || site.longitude === null || distanceM === null) {
    // A site with no map pin cannot be checked. That is a setup gap, not the
    // employee's fault, so it is let through for review rather than refused.
    return {
      allowed: true,
      distanceM: null,
      within: null,
      flagReason: 'The site has no map pin, so the location could not be checked',
    };
  }

  if (distanceM > site.radiusM) {
    if (site.mode === 'REJECT') {
      return {
        allowed: false,
        code: 'OUTSIDE_GEOFENCE',
        distanceM,
        message: `You are ${distanceM} m from the site; punching is allowed within ${site.radiusM} m.`,
      };
    }
    return {
      allowed: true,
      distanceM,
      within: false,
      flagReason: `${distanceM} m from the site pin (limit ${site.radiusM} m)`,
    };
  }

  // Inside the radius, but the phone itself is unsure by more than that.
  if (accuracyM && accuracyM > Math.max(site.radiusM, 100)) {
    return {
      allowed: true,
      distanceM,
      within: true,
      flagReason: `Location accuracy is only ±${Math.round(accuracyM)} m`,
    };
  }
  return { allowed: true, distanceM, within: true, flagReason: null };
}

/** Day of week helper re-exported so callers resolving weekly offs need one import. */
export { dayOfWeek };
