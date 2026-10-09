import { z } from 'zod';
import { endsNextDay } from '../attendance/engine';
import { dateOnlySchema, idSchema, paginationQuerySchema } from './common';

/** Office-local wall clock, 24-hour. */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time, like 09:30');

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');

const weeklyOffSchema = z
  .array(z.number().int().min(0).max(6))
  .max(6, 'At least one working day is needed')
  .refine((days) => new Set(days).size === days.length, 'Each day once');

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Length of a shift in minutes, across midnight where it runs over. */
export function shiftLengthMinutes(startTime: string, endTime: string): number {
  const start = minutesOf(startTime);
  const end = minutesOf(endTime);
  return endsNextDay(startTime, endTime) ? end + 24 * 60 - start : end - start;
}

export const shiftSchema = z
  .object({
    name: z.string().trim().min(2, 'Name the shift').max(120),
    startTime: timeOfDaySchema,
    endTime: timeOfDaySchema,
    breakMinutes: z.coerce.number().int().min(0).max(240),
    graceMinutes: z.coerce.number().int().min(0).max(120),
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((s) => s.startTime !== s.endTime, {
    message: 'A shift cannot start and end at the same time',
    path: ['endTime'],
  })
  .refine((s) => s.breakMinutes < shiftLengthMinutes(s.startTime, s.endTime), {
    message: 'The break is longer than the shift',
    path: ['breakMinutes'],
  });
export type ShiftInput = z.infer<typeof shiftSchema>;

export const shiftAssignmentSchema = z
  .object({
    /** Exactly one of these: a person, or a whole department. */
    employeeId: idSchema.optional().nullable(),
    departmentId: idSchema.optional().nullable(),
    effectiveFrom: dateOnlySchema,
    /** Exclusive, like every effective-dated range here. Empty = until changed. */
    effectiveTo: dateOnlySchema.optional().nullable(),
    /** 0 = Sunday. Overrides the office's weekly offs for this assignment. */
    weeklyOffDays: weeklyOffSchema.optional().nullable(),
  })
  .refine((a) => Boolean(a.employeeId) !== Boolean(a.departmentId), {
    message: 'Choose one employee or one department',
    path: ['employeeId'],
  })
  .refine((a) => !a.effectiveTo || a.effectiveTo > a.effectiveFrom, {
    message: 'The end must be after the start',
    path: ['effectiveTo'],
  });
export type ShiftAssignmentInput = z.infer<typeof shiftAssignmentSchema>;

export const rosterQuerySchema = z.object({
  /** Any date in the week; the roster shows Monday to Sunday around it. */
  weekOf: dateOnlySchema.optional(),
  officeId: idSchema.optional(),
  departmentId: idSchema.optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type RosterQuery = z.infer<typeof rosterQuerySchema>;

// ---------------------------------------------------------------------------
// Punching
// ---------------------------------------------------------------------------

export const SELFIE_MAX_BYTES = 5 * 1024 * 1024;
export const SELFIE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;

/**
 * A mobile punch arrives as multipart form data, so every number is a string
 * until it is parsed here. The coordinates must be real: 0,0 ("null island")
 * is what some browsers report when location fails, and it is never a site.
 */
export const mobilePunchSchema = z
  .object({
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    accuracyM: z.coerce.number().min(0).max(100_000).optional(),
    deviceInfo: z.string().trim().max(300).optional(),
    /** Omit to let the server choose: in if you are out, out if you are in. */
    type: z.enum(['IN', 'OUT']).optional(),
  })
  .refine((p) => !(p.latitude === 0 && p.longitude === 0), {
    message: 'The device did not report a real location',
    path: ['latitude'],
  });
export type MobilePunchInput = z.infer<typeof mobilePunchSchema>;

export const officePunchSchema = z.object({
  deviceInfo: z.string().trim().max(300).optional(),
  type: z.enum(['IN', 'OUT']).optional(),
});
export type OfficePunchInput = z.infer<typeof officePunchSchema>;

/** The first bytes of a real JPEG, PNG or WebP — a renamed file is not a selfie. */
export function looksLikeImage(bytes: Uint8Array): boolean {
  const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  const isJpeg = startsWith(0xff, 0xd8, 0xff);
  const isPng = startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const isWebp =
    startsWith(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  return isJpeg || isPng || isWebp;
}

// ---------------------------------------------------------------------------
// Reading attendance
// ---------------------------------------------------------------------------

export const boardQuerySchema = z.object({
  date: dateOnlySchema.optional(),
  officeId: idSchema.optional(),
  departmentId: idSchema.optional(),
  /** A status name, or NOT_IN for people who have not punched yet today. */
  status: z
    .enum(['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF', 'NOT_IN'])
    .optional(),
  flagged: z.coerce.boolean().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type BoardQuery = z.infer<typeof boardQuerySchema>;

export const registerQuerySchema = z.object({
  month: monthSchema,
  officeId: idSchema.optional(),
  departmentId: idSchema.optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type RegisterQuery = z.infer<typeof registerQuerySchema>;

export const employeeAttendanceQuerySchema = z.object({
  from: dateOnlySchema,
  to: dateOnlySchema,
});
export type EmployeeAttendanceQuery = z.infer<typeof employeeAttendanceQuerySchema>;

// ---------------------------------------------------------------------------
// Regularisation
// ---------------------------------------------------------------------------

/** How far back a day can still be corrected. */
export const REGULARISATION_WINDOW_DAYS = 31;

export const regularisationSchema = z
  .object({
    attendanceDate: dateOnlySchema,
    requestedInTime: timeOfDaySchema.optional().nullable(),
    requestedOutTime: timeOfDaySchema.optional().nullable(),
    reason: z.string().trim().min(10, 'Explain what happened (min 10 characters)').max(1000),
  })
  .refine((r) => Boolean(r.requestedInTime) || Boolean(r.requestedOutTime), {
    message: 'Give the clock-in time, the clock-out time, or both',
    path: ['requestedInTime'],
  });
export type RegularisationInput = z.infer<typeof regularisationSchema>;

export const regularisationDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    note: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((d) => d.decision === 'APPROVED' || (d.note ?? '').length >= 5, {
    message: 'Say why it is being rejected',
    path: ['note'],
  });
export type RegularisationDecisionInput = z.infer<typeof regularisationDecisionSchema>;

export const regularisationListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  /** Only the caller's own requests. */
  mine: z.coerce.boolean().optional(),
  employeeId: idSchema.optional(),
});
export type RegularisationListQuery = z.infer<typeof regularisationListQuerySchema>;
