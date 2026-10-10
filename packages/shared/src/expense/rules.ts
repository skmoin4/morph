/**
 * Expense rules, pure so the API, the entry form and the tests agree.
 *
 * Decisions (also in docs/00-project-context.md):
 *  - A claim goes Draft -> Manager -> Finance -> Approved. Either stage can
 *    reject (with a reason); the employee then edits and resubmits.
 *  - Category limits warn, they never block: the claim is flagged for the
 *    approvers instead. The per-month limit counts the person's other live
 *    claims in the same month (waiting or approved).
 *  - A receipt can be missing on a draft, but a category that requires one
 *    cannot be submitted without it.
 *  - Only an approved claim *with a project* posts to the cost ledger.
 */
import { addDays } from '../utils/date';

/** How far back an expense date may be. */
export const EXPENSE_BACKDATE_DAYS = 90;
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

export type ExpenseStatusValue =
  | 'DRAFT'
  | 'PENDING_MANAGER'
  | 'PENDING_FINANCE'
  | 'APPROVED'
  | 'REJECTED';

/** Only these can be edited or deleted by the owner. */
export function expenseEditable(status: ExpenseStatusValue): boolean {
  return status === 'DRAFT' || status === 'REJECTED';
}

export function expenseWindowStart(today: string): string {
  return addDays(today, -EXPENSE_BACKDATE_DAYS);
}

export interface LimitCheck {
  exceededClaim: boolean;
  exceededMonth: boolean;
  messages: string[];
}

const inr = (value: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);

/**
 * Compares a claim with its category's soft limits. `monthSoFar` is what the
 * person already has live in that month, not counting this claim.
 */
export function checkLimits(args: {
  amount: number;
  perClaimLimit: number | null;
  perMonthLimit: number | null;
  monthSoFar: number;
}): LimitCheck {
  const messages: string[] = [];
  const exceededClaim = args.perClaimLimit !== null && args.amount > args.perClaimLimit;
  if (exceededClaim) {
    messages.push(`Over the ₹${inr(args.perClaimLimit!)} per-claim limit for this category.`);
  }
  const monthTotal = Math.round((args.monthSoFar + args.amount) * 100) / 100;
  const exceededMonth = args.perMonthLimit !== null && monthTotal > args.perMonthLimit;
  if (exceededMonth) {
    messages.push(
      `This brings the month to ₹${inr(monthTotal)}, over the ₹${inr(args.perMonthLimit!)} monthly limit.`,
    );
  }
  return { exceededClaim, exceededMonth, messages };
}

/** First bytes of a PDF. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

/** A receipt is a photo (JPEG, PNG, WebP) or a PDF; the bytes must agree with the claim. */
export function looksLikeReceipt(bytes: Uint8Array): boolean {
  const startsWith = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  const jpeg = startsWith(0xff, 0xd8, 0xff);
  const png = startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const webp =
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;
  return jpeg || png || webp || looksLikePdf(bytes);
}

/** First and last date of the month a YYYY-MM-DD date is in. */
export function monthRangeOf(date: string): { from: string; to: string } {
  const [y, m] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}
