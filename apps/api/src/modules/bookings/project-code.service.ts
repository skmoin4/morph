import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildProjectCode, financialYearLabel, financialYearStartYear } from '@opsvera/shared';
import { PrismaService, type ScopedTx } from '../../prisma/prisma.service';

export interface MintCodeArgs {
  companyId: string;
  codePrefix: string;
  pattern: string;
  fyStartMonth: number;
  /** Office-local booking date; decides which financial year the code belongs to. */
  bookingDate: string;
  typeShortCode: string;
}

export interface MintedCode {
  projectCode: string;
  sequence: number;
  fyLabel: string;
  fyStartYear: number;
}

/**
 * Project code generation.
 *
 * Two guarantees, and both have to survive two people confirming at the same
 * instant:
 *
 *   1. **Unique.** The counter row is locked with `SELECT ... FOR UPDATE`
 *      inside the caller's transaction, so concurrent confirmations queue
 *      rather than read the same number. `UNIQUE(companyId, projectCode)` on
 *      `projects` is the backstop if anything ever bypasses this.
 *   2. **Never reused.** The counter only moves forward. A cancelled booking
 *      does not return its number to the pool, and a failed transaction rolls
 *      the counter back with it — so a number is either used or never existed.
 *
 * Must be called inside a transaction; the lock is meaningless otherwise.
 */
@Injectable()
export class ProjectCodeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Makes sure the counter row exists, in its own committed statement.
   *
   * This must happen *outside* the confirmation transaction. Doing the insert
   * inside it means concurrent transactions take insert-intention locks on the
   * same unique key and then try to escalate to `FOR UPDATE`, which MySQL
   * resolves as a deadlock (error 1213). With the row already committed, the
   * transaction below only ever takes a plain row lock on an existing row.
   */
  async ensureSequence(args: {
    companyId: string;
    bookingDate: string;
    fyStartMonth: number;
  }): Promise<void> {
    const fyStartYear = financialYearStartYear(args.bookingDate, args.fyStartMonth);
    const fyLabel = financialYearLabel(args.bookingDate, args.fyStartMonth);

    await this.prisma.$executeRaw`
      INSERT IGNORE INTO project_code_sequences
        (id, companyId, fyStartYear, fyLabel, lastSequence, createdAt, updatedAt)
      VALUES (${cuidLike()}, ${args.companyId}, ${fyStartYear}, ${fyLabel}, 0, NOW(3), NOW(3))
    `;
  }

  async mint(tx: ScopedTx, args: MintCodeArgs): Promise<MintedCode> {
    const fyStartYear = financialYearStartYear(args.bookingDate, args.fyStartMonth);
    const fyLabel = financialYearLabel(args.bookingDate, args.fyStartMonth);

    // The row lock. Everything after this is serialised per company per FY.
    // `ensureSequence` has already committed the row, so this never inserts.
    const locked = await tx.$queryRaw<Array<{ id: string; lastSequence: number }>>`
      SELECT id, lastSequence
        FROM project_code_sequences
       WHERE companyId = ${args.companyId} AND fyStartYear = ${fyStartYear}
       FOR UPDATE
    `;

    if (locked.length === 0) {
      // Unreachable when ensureSequence() ran first, which is the contract.
      throw new Error(
        `No project code sequence for ${args.companyId} FY ${fyLabel}. Call ensureSequence() before the transaction.`,
      );
    }

    const sequence = locked[0].lastSequence + 1;

    await tx.$executeRaw`
      UPDATE project_code_sequences
         SET lastSequence = ${sequence}, updatedAt = NOW(3)
       WHERE id = ${locked[0].id}
    `;

    const projectCode = buildProjectCode(args.pattern, {
      prefix: args.codePrefix,
      fy: fyLabel,
      type: args.typeShortCode,
      sequence,
    });

    return { projectCode, sequence, fyLabel, fyStartYear };
  }

  /** What the next code would look like, without consuming it. */
  async preview(
    tx: ScopedTx | { $queryRaw: typeof Prisma.raw },
    args: MintCodeArgs,
  ): Promise<string> {
    const fyStartYear = financialYearStartYear(args.bookingDate, args.fyStartMonth);
    const fyLabel = financialYearLabel(args.bookingDate, args.fyStartMonth);

    const rows = await (tx as ScopedTx).$queryRaw<Array<{ lastSequence: number }>>`
      SELECT lastSequence FROM project_code_sequences
       WHERE companyId = ${args.companyId} AND fyStartYear = ${fyStartYear}
    `;

    return buildProjectCode(args.pattern, {
      prefix: args.codePrefix,
      fy: fyLabel,
      type: args.typeShortCode,
      sequence: (rows[0]?.lastSequence ?? 0) + 1,
    });
  }
}

/**
 * A cuid-shaped id for the raw INSERT above.
 *
 * Prisma generates ids in its client layer, which a raw statement bypasses —
 * so one is produced here in the same shape the rest of the table uses.
 */
function cuidLike(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 12);
  return `c${timestamp}${random}`.slice(0, 25);
}
