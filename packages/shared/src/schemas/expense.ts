import { z } from 'zod';
import { dateOnlySchema, idSchema, moneySchema, paginationQuerySchema } from './common';

const flag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

const positiveMoney = moneySchema.refine((v) => Number(v) > 0, 'Enter an amount above zero');

export const expenseSchema = z.object({
  categoryId: idSchema,
  /** Optional: an expense with no project is company overhead and posts no project cost. */
  projectId: idSchema.optional().nullable(),
  expenseDate: dateOnlySchema,
  amount: positiveMoney,
  isBillable: z.boolean().default(false),
  description: z.string().trim().max(1000).optional().nullable(),
  /** An uploaded receipt (from POST /expenses/receipts) to attach. */
  receiptDocumentId: idSchema.optional().nullable(),
});
export type ExpenseInput = z.infer<typeof expenseSchema>;

export const updateExpenseSchema = expenseSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const EXPENSE_STATUSES = [
  'DRAFT',
  'PENDING_MANAGER',
  'PENDING_FINANCE',
  'APPROVED',
  'REJECTED',
] as const;

export const expenseListQuerySchema = paginationQuerySchema.extend({
  status: z.enum(EXPENSE_STATUSES).optional(),
  reimbursement: z.enum(['PENDING', 'REIMBURSED']).optional(),
  mine: flag.optional(),
  /** Only claims waiting on the caller's own decision. */
  toDecide: flag.optional(),
  /** Approved claims not yet paid out (Finance). */
  toReimburse: flag.optional(),
  employeeId: idSchema.optional(),
  projectId: idSchema.optional(),
  categoryId: idSchema.optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
export type ExpenseListQuery = z.infer<typeof expenseListQuerySchema>;

export const expenseDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    comment: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((d) => d.decision === 'APPROVED' || (d.comment ?? '').length >= 5, {
    message: 'Say why it is being rejected',
    path: ['comment'],
  });
export type ExpenseDecisionInput = z.infer<typeof expenseDecisionSchema>;

export const bulkExpenseDecisionSchema = z
  .object({
    ids: z.array(idSchema).min(1).max(100),
    decision: z.enum(['APPROVED', 'REJECTED']),
    comment: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((d) => d.decision === 'APPROVED' || (d.comment ?? '').length >= 5, {
    message: 'Say why it is being rejected',
    path: ['comment'],
  });
export type BulkExpenseDecisionInput = z.infer<typeof bulkExpenseDecisionSchema>;

export const reimburseSchema = z.object({
  ids: z.array(idSchema).min(1).max(200),
});
export type ReimburseInput = z.infer<typeof reimburseSchema>;

export const reverseExpenseSchema = z.object({
  reason: z.string().trim().min(5, 'Say why it is being reversed').max(1000),
});
export type ReverseExpenseInput = z.infer<typeof reverseExpenseSchema>;
