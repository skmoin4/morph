import { z } from 'zod';
import { LeaveApprovalFlow } from '../constants/enums';
import { dateOnlySchema, idSchema, moneySchema, paginationQuerySchema } from './common';

/** IANA zone id, e.g. "Asia/Kolkata". Validated against the runtime's zone list. */
export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Not a recognised time zone' },
  );

/** 0 = Sunday … 6 = Saturday. Riyadh is [5, 6]. */
export const weeklyOffDaysSchema = z
  .array(z.coerce.number().int().min(0).max(6))
  .max(7)
  .refine((days) => new Set(days).size === days.length, {
    message: 'Each day can only be listed once',
  })
  .refine((days) => days.length < 7, { message: 'At least one day must be a working day' });

/** IPv4 address or CIDR block, as used for office network punches. */
export const ipRuleSchema = z
  .string()
  .trim()
  .regex(
    /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^::1$|^[0-9a-fA-F:]+(\/\d{1,3})?$/,
    'Enter an IPv4/IPv6 address or CIDR block, e.g. 103.21.58.0/24',
  );

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------

export const PROJECT_CODE_TOKENS = [
  '{PREFIX}',
  '{FY}',
  '{TYPE}',
  '{SEQ3}',
  '{SEQ4}',
  '{SEQ5}',
  '{SEQ6}',
  '{SEQ}',
] as const;

export const updateCompanySchema = z.object({
  name: z.string().trim().min(2).max(200),
  legalName: z.string().trim().max(200).optional().nullable(),
  /** Changing this does not rewrite codes already issued. */
  codePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'At least 2 characters')
    .max(10)
    .regex(/^[A-Z0-9]+$/, 'Letters and numbers only'),
  projectCodePattern: z
    .string()
    .trim()
    .min(5)
    .max(120)
    .refine((p) => p.includes('{SEQ'), { message: 'The pattern must contain a sequence token' })
    .refine((p) => p.includes('{PREFIX}'), { message: 'The pattern must contain {PREFIX}' }),
  /** 1–12. April (4) for the Indian financial year. */
  fyStartMonth: z.coerce.number().int().min(1).max(12),
  currency: z.string().trim().toUpperCase().length(3),
  currencySymbol: z.string().trim().min(1).max(5),
  gstin: z.string().trim().max(20).optional().nullable(),
  addressLine1: z.string().trim().max(200).optional().nullable(),
  addressLine2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  state: z.string().trim().max(100).optional().nullable(),
  country: z.string().trim().max(100).optional().nullable(),
  postalCode: z.string().trim().max(20).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  email: z.string().trim().toLowerCase().email().optional().nullable().or(z.literal('')),
});
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

// ---------------------------------------------------------------------------
// Offices
// ---------------------------------------------------------------------------

const officeBaseSchema = z.object({
  name: z.string().trim().min(2).max(150),
  shortCode: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(20)
    .regex(/^[A-Z0-9-]+$/, 'Letters, numbers and dashes only'),
  timezone: timezoneSchema,
  addressLine1: z.string().trim().max(200).optional().nullable(),
  addressLine2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  state: z.string().trim().max(100).optional().nullable(),
  country: z.string().trim().max(100).optional().nullable(),
  postalCode: z.string().trim().max(20).optional().nullable(),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  geofenceRadiusM: z.coerce.number().int().min(25).max(5000),
  weeklyOffDays: weeklyOffDaysSchema,
  allowedIPs: z.array(ipRuleSchema).max(50),
  /** A client site where GPS and a selfie are mandatory. */
  requiresGps: z.boolean(),
  isActive: z.boolean().optional(),
});

export const createOfficeSchema = officeBaseSchema.refine(
  // A geofence is meaningless without a pin to measure from. Both an explicit
  // null and an omitted field count as missing.
  (o) => !o.requiresGps || (o.latitude != null && o.longitude != null),
  { message: 'A GPS-required site needs a map pin', path: ['latitude'] },
);
export type CreateOfficeInput = z.infer<typeof createOfficeSchema>;

export const updateOfficeSchema = officeBaseSchema.partial();
export type UpdateOfficeInput = z.infer<typeof updateOfficeSchema>;

// ---------------------------------------------------------------------------
// Departments, designations, project types
// ---------------------------------------------------------------------------

export const departmentSchema = z.object({
  name: z.string().trim().min(2).max(150),
  shortCode: z.string().trim().toUpperCase().max(20).optional().nullable(),
  headEmployeeId: idSchema.optional().nullable(),
  isActive: z.boolean().optional(),
});
export type DepartmentInput = z.infer<typeof departmentSchema>;

export const designationSchema = z.object({
  name: z.string().trim().min(2).max(150),
  departmentId: idSchema.optional().nullable(),
  level: z.coerce.number().int().min(1).max(20).optional().nullable(),
  isActive: z.boolean().optional(),
});
export type DesignationInput = z.infer<typeof designationSchema>;

export const projectTypeSchema = z.object({
  name: z.string().trim().min(2).max(150),
  /** Goes straight into the project code, so it is constrained hard. */
  shortCode: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(10)
    .regex(/^[A-Z0-9]+$/, 'Letters and numbers only'),
  colorToken: z.enum(['blue', 'cyan', 'green', 'amber', 'red', 'violet']).optional().nullable(),
  isActive: z.boolean().optional(),
});
export type ProjectTypeInput = z.infer<typeof projectTypeSchema>;

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

export const holidaySchema = z.object({
  name: z.string().trim().min(2).max(150),
  date: dateOnlySchema,
  /** Which offices observe it. Indian holidays do not apply in Riyadh. */
  officeIds: z.array(idSchema).min(1, 'Choose at least one office'),
  isOptional: z.boolean().optional(),
});
export type HolidayInput = z.infer<typeof holidaySchema>;

export const holidayListQuerySchema = paginationQuerySchema.extend({
  officeId: idSchema.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type HolidayListQuery = z.infer<typeof holidayListQuerySchema>;

// ---------------------------------------------------------------------------
// Attendance policy
// ---------------------------------------------------------------------------

export const attendancePolicySchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    /** Null applies it company-wide. */
    officeId: idSchema.optional().nullable(),
    shiftId: idSchema.optional().nullable(),
    graceMinutes: z.coerce.number().int().min(0).max(120),
    lateMarkAfterMinutes: z.coerce.number().int().min(0).max(240),
    halfDayBelowHours: z.coerce.number().min(0).max(24),
    fullDayMinimumHours: z.coerce.number().min(0).max(24),
    overtimeAfterHours: z.coerce.number().min(0).max(24),
    earlyExitBeforeMinutes: z.coerce.number().int().min(0).max(240),
    /** 0 disables the "3 late marks = half day" rule. */
    lateMarksPerHalfDay: z.coerce.number().int().min(0).max(31),
    isDefault: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((p) => p.halfDayBelowHours <= p.fullDayMinimumHours, {
    message: 'The half-day threshold cannot be above the full-day minimum',
    path: ['halfDayBelowHours'],
  })
  .refine((p) => p.overtimeAfterHours >= p.fullDayMinimumHours, {
    message: 'Overtime cannot start before a full day is worked',
    path: ['overtimeAfterHours'],
  });
export type AttendancePolicyInput = z.infer<typeof attendancePolicySchema>;

// ---------------------------------------------------------------------------
// Leave types
// ---------------------------------------------------------------------------

export const leaveTypeSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    shortCode: z.string().trim().toUpperCase().min(1).max(10),
    yearlyQuota: z.coerce.number().min(0).max(365),
    carryForward: z.boolean(),
    maxCarryForward: z.coerce.number().min(0).max(365).optional().nullable(),
    allowHalfDay: z.boolean(),
    isPaid: z.boolean(),
    approvalFlow: z.nativeEnum(LeaveApprovalFlow),
    colorToken: z.enum(['blue', 'cyan', 'green', 'amber', 'red', 'violet']).optional().nullable(),
    isActive: z.boolean().optional(),
  })
  .refine((t) => !t.carryForward || t.maxCarryForward !== null, {
    message: 'Set a carry-forward cap, or turn carry forward off',
    path: ['maxCarryForward'],
  });
export type LeaveTypeInput = z.infer<typeof leaveTypeSchema>;

// ---------------------------------------------------------------------------
// Expense categories
// ---------------------------------------------------------------------------

export const expenseCategorySchema = z.object({
  name: z.string().trim().min(2).max(120),
  shortCode: z.string().trim().toUpperCase().max(20).optional().nullable(),
  /** Soft caps: exceeding them warns, it does not block the claim. */
  perClaimLimit: moneySchema.optional().nullable(),
  perMonthLimit: moneySchema.optional().nullable(),
  requiresReceipt: z.boolean(),
  isActive: z.boolean().optional(),
});
export type ExpenseCategoryInput = z.infer<typeof expenseCategorySchema>;

// ---------------------------------------------------------------------------
// Shared list query
// ---------------------------------------------------------------------------

export const settingsListQuerySchema = paginationQuerySchema.extend({
  isActive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
});
export type SettingsListQuery = z.infer<typeof settingsListQuerySchema>;

// ---------------------------------------------------------------------------
// Booking policy
//
// The client has not settled these rules, so they are configuration rather
// than code. Defaults match the agreed Phase 1 behaviour.
// ---------------------------------------------------------------------------

export const bookingPolicySchema = z.object({
  /** Roles allowed to create a booking. Empty = the booking.create permission alone. */
  bookingCreateRoleIds: z.array(idSchema).max(20).default([]),
  /** Roles allowed to confirm. Empty = the booking.confirm permission alone. */
  bookingConfirmRoleIds: z.array(idSchema).max(20).default([]),
  /** Hold a confirmed booking for a second approval before creating the project. */
  bookingRequiresApproval: z.boolean().default(false),
  /**
   * Days a VERBAL booking may go without its email before it is chased.
   * A reminder only — it never blocks confirmation or the project. 0 disables it.
   */
  verbalEmailGraceDays: z.coerce.number().int().min(0).max(365).default(7),
});
export type BookingPolicyInput = z.infer<typeof bookingPolicySchema>;
