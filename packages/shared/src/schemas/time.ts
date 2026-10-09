import { z } from 'zod';
import { dateOnlySchema, idSchema, paginationQuerySchema } from './common';
import { isMonday, MAX_DAY_HOURS } from '../time/rules';

const flag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

export const hoursInputSchema = z.coerce
  .number({ invalid_type_error: 'Enter the hours' })
  .gt(0, 'Hours must be more than zero')
  .max(MAX_DAY_HOURS, `A day has only ${MAX_DAY_HOURS} hours`)
  .refine((h) => Math.abs(h * 100 - Math.round(h * 100)) < 1e-6, 'At most two decimal places');

const descriptionSchema = z.string().trim().max(1000).optional().nullable();

export const startTimerSchema = z.object({
  projectId: idSchema,
  taskId: idSchema,
  description: descriptionSchema,
  isBillable: z.boolean().default(true),
});
export type StartTimerInput = z.infer<typeof startTimerSchema>;

export const stopTimerSchema = z.object({
  description: descriptionSchema,
});
export type StopTimerInput = z.infer<typeof stopTimerSchema>;

export const timeEntrySchema = z.object({
  projectId: idSchema,
  taskId: idSchema.optional().nullable(),
  workDate: dateOnlySchema,
  hours: hoursInputSchema,
  isBillable: z.boolean().default(true),
  description: descriptionSchema,
});
export type TimeEntryInput = z.infer<typeof timeEntrySchema>;

export const updateTimeEntrySchema = z
  .object({
    projectId: idSchema,
    taskId: idSchema.nullable(),
    workDate: dateOnlySchema,
    hours: hoursInputSchema,
    isBillable: z.boolean(),
    description: descriptionSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
export type UpdateTimeEntryInput = z.infer<typeof updateTimeEntrySchema>;

/** Set one grid cell (a project/task row on a day) to a number of hours. 0 clears it. */
export const timeCellSchema = z.object({
  projectId: idSchema,
  taskId: idSchema.optional().nullable(),
  workDate: dateOnlySchema,
  isBillable: z.boolean().default(true),
  hours: z.coerce
    .number()
    .min(0)
    .max(MAX_DAY_HOURS)
    .refine((h) => Math.abs(h * 100 - Math.round(h * 100)) < 1e-6, 'At most two decimal places'),
});
export type TimeCellInput = z.infer<typeof timeCellSchema>;

export const weekQuerySchema = z.object({
  /** Any date in the week; the Monday is worked out. Defaults to this week. */
  weekStart: dateOnlySchema.optional(),
  employeeId: idSchema.optional(),
});
export type WeekQuery = z.infer<typeof weekQuerySchema>;

export const submitWeekSchema = z.object({
  weekStart: dateOnlySchema.refine(isMonday, 'A week starts on Monday'),
});
export type SubmitWeekInput = z.infer<typeof submitWeekSchema>;

export const timesheetListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'REOPENED']).optional(),
  mine: flag.optional(),
  /** Only what is waiting on the caller. */
  toDecide: flag.optional(),
  employeeId: idSchema.optional(),
  weekStart: dateOnlySchema.optional(),
});
export type TimesheetListQuery = z.infer<typeof timesheetListQuerySchema>;

export const timesheetDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    comment: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((d) => d.decision === 'APPROVED' || (d.comment ?? '').length >= 5, {
    message: 'Say why it is being rejected',
    path: ['comment'],
  });
export type TimesheetDecisionInput = z.infer<typeof timesheetDecisionSchema>;

export const bulkTimesheetDecisionSchema = z
  .object({
    ids: z.array(idSchema).min(1).max(100),
    decision: z.enum(['APPROVED', 'REJECTED']),
    comment: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((d) => d.decision === 'APPROVED' || (d.comment ?? '').length >= 5, {
    message: 'Say why it is being rejected',
    path: ['comment'],
  });
export type BulkTimesheetDecisionInput = z.infer<typeof bulkTimesheetDecisionSchema>;

export const reopenTimesheetSchema = z.object({
  reason: z.string().trim().min(5, 'Say why it is being reopened').max(1000),
});
export type ReopenTimesheetInput = z.infer<typeof reopenTimesheetSchema>;

export const timeEntriesQuerySchema = paginationQuerySchema.extend({
  projectId: idSchema.optional(),
  employeeId: idSchema.optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
export type TimeEntriesQuery = z.infer<typeof timeEntriesQuerySchema>;
