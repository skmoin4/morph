import { z } from 'zod';
import { idSchema } from './common';

export const dashboardQuerySchema = z.object({
  /** Limit the executive view to one office. */
  officeId: idSchema.optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export const REPORT_KEYS = [
  'bookings',
  'attendance',
  'leave',
  'timesheets',
  'project-cost',
  'expenses',
  'utilization',
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

const reportDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-31');

/** Every report takes the same filters; each one uses the ones that make sense for it. */
export const reportQuerySchema = z
  .object({
    from: reportDate.optional(),
    to: reportDate.optional(),
    officeId: idSchema.optional(),
    projectId: idSchema.optional(),
    employeeId: idSchema.optional(),
    /** A status of the report's own record (booking, leave, expense). */
    status: z.string().max(40).optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'The start date must be on or before the end date',
    path: ['to'],
  });
export type ReportQuery = z.infer<typeof reportQuerySchema>;
