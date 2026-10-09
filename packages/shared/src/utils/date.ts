/**
 * Everything is stored in UTC. These helpers convert to and from an office's
 * local calendar, which is what attendance rules and timesheet weeks are about.
 */

/** Civil date string (YYYY-MM-DD) for an instant, as seen in `timeZone`. */
export function toOfficeDateString(instant: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(instant);
}

/** Wall-clock HH:mm for an instant, as seen in `timeZone`. */
export function toOfficeTimeString(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
}

/** The UTC offset of `timeZone` at `instant`, in minutes. */
export function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000;
}

/** Turn an office-local date + HH:mm into the matching UTC instant. */
export function officeLocalToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const offset = timeZoneOffsetMinutes(guess, timeZone);
  return new Date(guess.getTime() - offset * 60000);
}

/** Day of week 0..6 (Sun..Sat) for an office-local date string. */
export function dayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Monday of the week containing `dateStr` — timesheet weeks start Monday. */
export function startOfWeek(dateStr: string): string {
  const dow = dayOfWeek(dateStr);
  return addDays(dateStr, dow === 0 ? -6 : 1 - dow);
}

export function endOfWeek(dateStr: string): string {
  return addDays(startOfWeek(dateStr), 6);
}

/**
 * Financial year label for a date, given the FY start month (1-12).
 * April start, 2026-10-06 -> "26-27".
 */
export function financialYearLabel(dateStr: string, fyStartMonth: number): string {
  const [y, m] = dateStr.split('-').map(Number);
  const startYear = m >= fyStartMonth ? y : y - 1;
  return `${String(startYear % 100).padStart(2, '0')}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export function financialYearStartYear(dateStr: string, fyStartMonth: number): number {
  const [y, m] = dateStr.split('-').map(Number);
  return m >= fyStartMonth ? y : y - 1;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Display format used throughout the UI: "04 Oct 2026". */
export function formatDisplayDate(value: string | Date): string {
  const s = typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  const [y, m, d] = s.split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

/** Haversine distance in metres — used by the attendance geofence check. */
export function distanceMetres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/**
 * Formats an *exclusive* end date for display as an inclusive one.
 *
 * Effective-dated history stores `effectiveTo` as the day the next row starts,
 * which is the first day the row no longer applies. Showing that date to a
 * user reads as if the rate applied on it — so the display steps back one day:
 * stored 2026-10-01 is shown as "30 Sep 2026".
 *
 * Returns null for an open-ended row, which the caller renders as "ongoing".
 */
export function formatExclusiveEndInclusive(
  exclusiveEnd: string | Date | null | undefined,
): string | null {
  if (!exclusiveEnd) return null;
  const iso =
    typeof exclusiveEnd === 'string'
      ? exclusiveEnd.slice(0, 10)
      : exclusiveEnd.toISOString().slice(0, 10);
  return formatDisplayDate(addDays(iso, -1));
}

/** The same step back, as a plain date string. */
export function exclusiveEndToInclusive(exclusiveEnd: string): string {
  return addDays(exclusiveEnd.slice(0, 10), -1);
}
