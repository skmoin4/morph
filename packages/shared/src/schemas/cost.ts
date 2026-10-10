import { z } from 'zod';
import { dateOnlySchema, idSchema, moneySchema, paginationQuerySchema } from './common';

/** A manual correction to a project's cost, by someone with `cost.edit`. */
export const costAdjustmentSchema = z
  .object({
    /** LABOUR moves hours and labour cost; EXPENSE moves expense cost only. */
    kind: z.enum(['LABOUR', 'EXPENSE']),
    /** Positive adds cost, negative takes it off. */
    amount: moneySchema.refine((v) => Number(v) !== 0, 'The amount cannot be zero'),
    /** Hours the adjustment carries (labour only), signed like the amount. */
    hours: z.coerce.number().min(-100000).max(100000).optional().nullable(),
    postingDate: dateOnlySchema,
    description: z.string().trim().min(5, 'Say what this corrects').max(500),
  })
  .refine((v) => v.kind === 'LABOUR' || !v.hours, {
    message: 'Hours belong to a labour adjustment',
    path: ['hours'],
  });
export type CostAdjustmentInput = z.infer<typeof costAdjustmentSchema>;

export const reverseEntrySchema = z.object({
  reason: z.string().trim().min(5, 'Say why it is being reversed').max(1000),
});
export type ReverseEntryInput = z.infer<typeof reverseEntrySchema>;

export const ledgerQuerySchema = paginationQuerySchema.extend({
  sourceType: z.enum(['TIMESHEET', 'EXPENSE', 'ADJUSTMENT']).optional(),
  employeeId: idSchema.optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
export type LedgerQuery = z.infer<typeof ledgerQuerySchema>;

export const costOverviewQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']).optional(),
  officeId: idSchema.optional(),
  /** Only projects at or past a budget alert level (80 or 100). */
  alert: z.enum(['80', '100']).optional(),
});
export type CostOverviewQuery = z.infer<typeof costOverviewQuerySchema>;
