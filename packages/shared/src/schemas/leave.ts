import { z } from 'zod';
import { dateOnlySchema, idSchema, paginationQuerySchema } from './common';

export const leaveDayPartSchema = z.enum(['FULL_DAY', 'FIRST_HALF', 'SECOND_HALF']);

/** How far back a leave can be applied for, and how far ahead. */
export const LEAVE_BACKDATE_DAYS = 30;
export const LEAVE_ADVANCE_DAYS = 400;

const leaveRangeShape = {
  leaveTypeId: idSchema,
  fromDate: dateOnlySchema,
  toDate: dateOnlySchema,
  dayPart: leaveDayPartSchema.default('FULL_DAY'),
  /** Only people who may apply for others (HR) can name someone else. */
  employeeId: idSchema.optional().nullable(),
};

function checkRange(
  v: { fromDate: string; toDate: string; dayPart: string },
  ctx: z.RefinementCtx,
) {
  if (v.toDate < v.fromDate) {
    ctx.addIssue({ code: 'custom', path: ['toDate'], message: 'The end is before the start' });
  }
  if (v.fromDate.slice(0, 4) !== v.toDate.slice(0, 4)) {
    ctx.addIssue({
      code: 'custom',
      path: ['toDate'],
      message: 'A request cannot run across two years. Apply for each year separately.',
    });
  }
  if (v.dayPart !== 'FULL_DAY' && v.fromDate !== v.toDate) {
    ctx.addIssue({
      code: 'custom',
      path: ['dayPart'],
      message: 'A half day is for a single day',
    });
  }
}

export const leavePreviewSchema = z.object(leaveRangeShape).superRefine(checkRange);
export type LeavePreviewInput = z.infer<typeof leavePreviewSchema>;

export const leaveRequestSchema = z
  .object({
    ...leaveRangeShape,
    reason: z.string().trim().min(5, 'Give a reason, in a few words').max(1000),
  })
  .superRefine(checkRange);
export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>;

export const leaveDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    note: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((d) => d.decision === 'APPROVED' || (d.note ?? '').length >= 5, {
    message: 'Say why it is being rejected',
    path: ['note'],
  });
export type LeaveDecisionInput = z.infer<typeof leaveDecisionSchema>;

export const leaveCancelSchema = z.object({
  note: z.string().trim().max(1000).optional().nullable(),
});
export type LeaveCancelInput = z.infer<typeof leaveCancelSchema>;

const flag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

export const leaveListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  /** Only the caller's own requests. */
  mine: flag.optional(),
  /** Only requests the caller is allowed to decide, and that are waiting. */
  toDecide: flag.optional(),
  employeeId: idSchema.optional(),
  leaveTypeId: idSchema.optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
export type LeaveListQuery = z.infer<typeof leaveListQuerySchema>;

export const leaveBalanceQuerySchema = z.object({
  employeeId: idSchema.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type LeaveBalanceQuery = z.infer<typeof leaveBalanceQuerySchema>;

export const leaveCalendarQuerySchema = z.object({
  from: dateOnlySchema,
  to: dateOnlySchema,
  officeId: idSchema.optional(),
  departmentId: idSchema.optional(),
});
export type LeaveCalendarQuery = z.infer<typeof leaveCalendarQuerySchema>;
