import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuditAction } from '@opsvera/shared';
import { PrismaService, type ScopedDb } from '../../prisma/prisma.service';
import { runUnscoped } from '../../prisma/tenant-context';

export interface AuditEntry {
  action: AuditAction;
  /** Logical entity name, e.g. 'Booking', 'EmployeeCostRate'. */
  entityType: string;
  entityId?: string | null;
  /** One human line for the audit screen. */
  summary: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  userId?: string | null;
  companyId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/**
 * The audit trail.
 *
 * Written for the events the scope calls out: booking confirmation, salary and
 * cost rate changes, approvals, rejections, deletes and permission changes.
 *
 * `record` takes an optional transaction client so an audit row lands in the
 * same transaction as the change it describes — a confirmed booking with no
 * audit row, or the reverse, is not a state the database can reach.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: ScopedDb): Promise<void> {
    const client = tx ?? this.prisma.scoped;

    const data = {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      summary: entry.summary.slice(0, 400),
      beforeData: toJson(entry.before),
      afterData: toJson(entry.after),
      reason: entry.reason ?? null,
      userId: entry.userId ?? null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent?.slice(0, 300) ?? null,
      requestId: entry.requestId ?? null,
    };

    try {
      if (entry.companyId) {
        // Used by login, which audits before a tenant scope exists.
        await runUnscoped(() =>
          this.prisma.auditLog.create({ data: { ...data, companyId: entry.companyId! } }),
        );
      } else {
        await client.auditLog.create({ data: data as never });
      }
    } catch (error) {
      // An audit write must never be the reason a business action fails, but a
      // silent loss would defeat the point — so it is logged loudly.
      this.logger.error(
        `Failed to write audit entry ${entry.action} ${entry.entityType}: ${String(error)}`,
      );
      if (tx) throw error;
    }
  }

  /**
   * Diffs two records and records only what changed. Keeps the audit screen
   * readable instead of dumping whole rows.
   */
  async recordChange(
    entry: Omit<AuditEntry, 'before' | 'after'> & {
      before: Record<string, unknown>;
      after: Record<string, unknown>;
      /** Fields worth auditing; others are ignored. */
      fields: string[];
    },
    tx?: ScopedDb,
  ): Promise<void> {
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    for (const field of entry.fields) {
      const from = normalise(entry.before[field]);
      const to = normalise(entry.after[field]);
      if (from !== to) {
        before[field] = from;
        after[field] = to;
      }
    }

    if (Object.keys(after).length === 0) return;
    await this.record({ ...entry, before, after }, tx);
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull as unknown as Prisma.InputJsonValue;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Dates and Decimals compare badly by reference, so flatten them to strings. */
function normalise(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && typeof (value as { toFixed?: unknown }).toFixed === 'function') {
    return (value as { toString(): string }).toString();
  }
  return value;
}
