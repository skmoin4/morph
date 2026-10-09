import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/** Office-local date string -> a DATE column value. */
export function d(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

/**
 * Office-local wall clock -> the UTC instant to store.
 * Only used with fixed offsets, which is all the seeded offices need
 * (Asia/Kolkata +5:30 and Asia/Riyadh +3:00 have no DST).
 */
export function utc(dateStr: string, time: string, offsetMinutes: number): Date {
  const [hh, mm] = time.split(':').map(Number);
  const base = new Date(`${dateStr}T00:00:00.000Z`).getTime();
  return new Date(base + (hh * 60 + mm - offsetMinutes) * 60_000);
}

export const OFFSET = {
  KOLKATA: 330,
  RIYADH: 180,
} as const;

export function addDays(dateStr: string, days: number): string {
  const [y, m, dd] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd + days)).toISOString().slice(0, 10);
}

/** Inclusive list of office-local date strings. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let cur = from; cur <= to; cur = addDays(cur, 1)) out.push(cur);
  return out;
}

/** Sunday = 0. */
export function dayOfWeek(dateStr: string): number {
  const [y, m, dd] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
}

let step = 0;
export function log(message: string): void {
  step += 1;
  // eslint-disable-next-line no-console
  console.log(`  ${String(step).padStart(2, '0')}. ${message}`);
}

export function section(title: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n${title}`);
}
