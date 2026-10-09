import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';

/**
 * Cost ledger posting.
 *
 * Two rules drive everything here:
 *   1. The rate used is the one effective on the *work date*, not today's rate.
 *   2. The ledger is append-only. A correction never updates a row: it posts a
 *      negative reversal of the version it cancels, and the next approval posts
 *      the next version. The unique key
 *      (sourceType, sourceId, projectId, postingVersion, isReversal)
 *      makes a repeated posting fail loudly instead of double-counting.
 *
 * A weekly timesheet may span several projects, so one timesheet posts one row
 * per project per version.
 */

export const TIMER_ALREADY_RUNNING = 'TIMER_ALREADY_RUNNING';

/** Anything that can run queries: the client, or a transaction client. */
export type TxClient = Omit<
  Prisma.TransactionClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface CostRateRow {
  hourlyRate: Prisma.Decimal | string;
  effectiveFrom: Date;
}

/** Office-local date string from a DATE column value. */
function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * The rate effective on `workDate`: the latest row whose effectiveFrom is on or
 * before that date. Returns null when the employee has no rate yet, which the
 * caller must treat as a hard error rather than zero.
 */
export function resolveRateForDate(rates: CostRateRow[], workDate: Date): Decimal | null {
  const target = dateKey(workDate);
  let best: { from: string; rate: Decimal } | null = null;

  for (const row of rates) {
    const from = dateKey(row.effectiveFrom);
    if (from > target) continue;
    if (!best || from > best.from) {
      best = { from, rate: new Decimal(row.hourlyRate.toString()) };
    }
  }
  return best?.rate ?? null;
}

export interface TimeEntryForCosting {
  projectId: string;
  workDate: Date;
  hours: Prisma.Decimal | string;
}

/**
 * One contiguous run of work dates charged at a single rate.
 *
 * Stored on the ledger entry as `rateBreakdown`, so the arithmetic behind
 * `amount` is always on the row itself — including for single-rate postings,
 * where there is exactly one segment. The cost ledger UI renders this as a
 * tooltip.
 */
export interface RateSegment {
  /** First work date in the segment, office-local (YYYY-MM-DD). */
  from: string;
  /** Last work date in the segment, office-local (YYYY-MM-DD). */
  to: string;
  hours: string;
  rate: string;
  /** hours x rate for this segment; the segments sum to the posting amount. */
  amount: string;
}

export interface ProjectPosting {
  projectId: string;
  hours: string;
  amount: string;
  /** The rate, when one rate covered every entry. Null when it changed. */
  rateApplied: string | null;
  /** Always at least one segment. */
  rateBreakdown: RateSegment[];
}

/**
 * Groups a timesheet's entries by project and costs each day at that day's rate.
 *
 * Within a project the worked days are walked in date order and a new segment
 * starts whenever the applicable rate changes, so a week straddling a rate rise
 * produces two segments rather than one blended number. `rateApplied` is still
 * set when a single rate covered everything, because that is the common case
 * and the ledger reads better for it.
 */
export function computeTimesheetPostings(
  entries: TimeEntryForCosting[],
  rates: CostRateRow[],
): ProjectPosting[] {
  // project -> workDate -> hours, so several entries on the same day (two tasks,
  // say) are costed as one day at one rate.
  const byProject = new Map<string, Map<string, Decimal>>();

  for (const entry of entries) {
    const hours = new Decimal(entry.hours.toString());
    if (hours.isZero()) continue;

    const day = dateKey(entry.workDate);
    const days = byProject.get(entry.projectId) ?? new Map<string, Decimal>();
    days.set(day, (days.get(day) ?? new Decimal(0)).plus(hours));
    byProject.set(entry.projectId, days);
  }

  const rateByDate = new Map<string, Decimal>();
  const rateFor = (day: string): Decimal => {
    const cached = rateByDate.get(day);
    if (cached) return cached;

    const rate = resolveRateForDate(rates, new Date(`${day}T00:00:00.000Z`));
    if (!rate) {
      throw new Error(`No cost rate effective on ${day} — cannot post labour cost.`);
    }
    rateByDate.set(day, rate);
    return rate;
  };

  return [...byProject.entries()].map(([projectId, days]) => {
    const segments: RateSegment[] = [];
    let totalHours = new Decimal(0);
    let totalAmount = new Decimal(0);

    for (const day of [...days.keys()].sort()) {
      const hours = days.get(day)!;
      const rate = rateFor(day);
      const amount = hours.times(rate);

      totalHours = totalHours.plus(hours);
      totalAmount = totalAmount.plus(amount);

      const open = segments.at(-1);
      if (open && open.rate === rate.toFixed(2)) {
        // Same rate as the previous worked day: extend the run.
        open.to = day;
        open.hours = new Decimal(open.hours).plus(hours).toFixed(2);
        open.amount = new Decimal(open.amount).plus(amount).toFixed(2);
      } else {
        segments.push({
          from: day,
          to: day,
          hours: hours.toFixed(2),
          rate: rate.toFixed(2),
          amount: amount.toFixed(2),
        });
      }
    }

    const distinctRates = new Set(segments.map((s) => s.rate));

    return {
      projectId,
      hours: totalHours.toFixed(2),
      amount: totalAmount.toFixed(2),
      rateApplied: distinctRates.size === 1 ? [...distinctRates][0] : null,
      rateBreakdown: segments,
    };
  });
}

/** Mirrors a breakdown for a reversal row: same rates and dates, negated hours. */
export function negateRateBreakdown(segments: RateSegment[]): RateSegment[] {
  return segments.map((s) => ({
    ...s,
    hours: new Decimal(s.hours).negated().toFixed(2),
    amount: new Decimal(s.amount).negated().toFixed(2),
  }));
}

/**
 * The next posting version for a source. Version 1 on first approval, then one
 * higher than whatever is already on the ledger.
 */
export async function nextPostingVersion(
  tx: TxClient,
  sourceType: 'TIMESHEET' | 'EXPENSE' | 'ADJUSTMENT',
  sourceId: string,
): Promise<number> {
  const latest = await tx.costLedgerEntry.aggregate({
    where: { sourceType, sourceId },
    _max: { postingVersion: true },
  });
  return (latest._max.postingVersion ?? 0) + 1;
}

/** The version currently in force: the highest one that has not been reversed. */
export async function activePostingVersion(
  tx: TxClient,
  sourceType: 'TIMESHEET' | 'EXPENSE' | 'ADJUSTMENT',
  sourceId: string,
): Promise<number | null> {
  const rows = await tx.costLedgerEntry.findMany({
    where: { sourceType, sourceId },
    select: { postingVersion: true, isReversal: true },
  });
  if (rows.length === 0) return null;

  const reversed = new Set(rows.filter((r) => r.isReversal).map((r) => r.postingVersion));
  const live = rows
    .filter((r) => !r.isReversal && !reversed.has(r.postingVersion))
    .map((r) => r.postingVersion);

  return live.length ? Math.max(...live) : null;
}

export interface PostTimesheetArgs {
  companyId: string;
  timesheetId: string;
  employeeId: string;
  postingDate: Date;
  postings: ProjectPosting[];
  createdById?: string | null;
  description?: string;
}

/**
 * Posts one row per project at the next version, and rolls the amounts into the
 * project's denormalised actuals in the same transaction.
 */
export async function postTimesheetCost(
  tx: TxClient,
  args: PostTimesheetArgs,
): Promise<{ version: number; rows: number }> {
  const version = await nextPostingVersion(tx, 'TIMESHEET', args.timesheetId);

  for (const posting of args.postings) {
    await tx.costLedgerEntry.create({
      data: {
        companyId: args.companyId,
        projectId: posting.projectId,
        employeeId: args.employeeId,
        sourceType: 'TIMESHEET',
        sourceId: args.timesheetId,
        postingVersion: version,
        isReversal: false,
        postingDate: args.postingDate,
        hours: posting.hours,
        rateApplied: posting.rateApplied,
        rateBreakdown: posting.rateBreakdown as unknown as Prisma.InputJsonValue,
        amount: posting.amount,
        description: args.description ?? `Approved timesheet (v${version})`,
        createdById: args.createdById ?? null,
      },
    });

    await tx.project.update({
      where: { id: posting.projectId },
      data: {
        actualHours: { increment: posting.hours },
        actualLabourCost: { increment: posting.amount },
        actualTotalCost: { increment: posting.amount },
      },
    });
  }

  return { version, rows: args.postings.length };
}

/**
 * Reverses the version currently in force. Writes the mirror-image negative row
 * for each project and backs the project actuals out again.
 */
export async function reverseTimesheetCost(
  tx: TxClient,
  args: { companyId: string; timesheetId: string; reason: string; createdById?: string | null },
): Promise<{ version: number; rows: number }> {
  const version = await activePostingVersion(tx, 'TIMESHEET', args.timesheetId);
  if (version === null) return { version: 0, rows: 0 };

  const originals = await tx.costLedgerEntry.findMany({
    where: {
      sourceType: 'TIMESHEET',
      sourceId: args.timesheetId,
      postingVersion: version,
      isReversal: false,
    },
  });

  for (const original of originals) {
    const hours = original.hours ? new Decimal(original.hours.toString()).negated() : null;
    const amount = new Decimal(original.amount.toString()).negated();

    await tx.costLedgerEntry.create({
      data: {
        companyId: original.companyId,
        projectId: original.projectId,
        employeeId: original.employeeId,
        sourceType: 'TIMESHEET',
        sourceId: args.timesheetId,
        postingVersion: version,
        isReversal: true,
        postingDate: original.postingDate,
        hours: hours?.toFixed(2) ?? null,
        rateApplied: original.rateApplied,
        // The mirror image: same dates and rates, negated hours and amounts, so
        // the reversal explains itself exactly as the original does.
        rateBreakdown: original.rateBreakdown
          ? (negateRateBreakdown(
              original.rateBreakdown as unknown as RateSegment[],
            ) as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        amount: amount.toFixed(2),
        description: `Reversal of v${version}: ${args.reason}`,
        reversesId: original.id,
        createdById: args.createdById ?? null,
      },
    });

    await tx.project.update({
      where: { id: original.projectId },
      data: {
        actualHours: { increment: hours?.toFixed(2) ?? '0.00' },
        actualLabourCost: { increment: amount.toFixed(2) },
        actualTotalCost: { increment: amount.toFixed(2) },
      },
    });
  }

  return { version, rows: originals.length };
}

export interface PostExpenseArgs {
  companyId: string;
  expenseId: string;
  projectId: string;
  employeeId: string;
  postingDate: Date;
  amount: string;
  description?: string;
  createdById?: string | null;
}

/** Posts an expense on its final (Finance) approval. */
export async function postExpenseCost(
  tx: TxClient,
  args: PostExpenseArgs,
): Promise<{ version: number }> {
  const version = await nextPostingVersion(tx, 'EXPENSE', args.expenseId);

  await tx.costLedgerEntry.create({
    data: {
      companyId: args.companyId,
      projectId: args.projectId,
      employeeId: args.employeeId,
      sourceType: 'EXPENSE',
      sourceId: args.expenseId,
      postingVersion: version,
      isReversal: false,
      postingDate: args.postingDate,
      amount: args.amount,
      description: args.description ?? `Approved expense (v${version})`,
      createdById: args.createdById ?? null,
    },
  });

  await tx.project.update({
    where: { id: args.projectId },
    data: {
      actualExpenseCost: { increment: args.amount },
      actualTotalCost: { increment: args.amount },
    },
  });

  return { version };
}

/** Net posted cost for a source: live versions minus reversals. */
export async function netPostedAmount(
  tx: TxClient,
  sourceType: 'TIMESHEET' | 'EXPENSE' | 'ADJUSTMENT',
  sourceId: string,
): Promise<string> {
  const rows = await tx.costLedgerEntry.findMany({
    where: { sourceType, sourceId },
    select: { amount: true },
  });
  return rows
    .reduce((acc, r) => acc.plus(new Decimal(r.amount.toString())), new Decimal(0))
    .toFixed(2);
}
