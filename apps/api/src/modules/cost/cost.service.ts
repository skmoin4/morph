import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import {
  alertLevelFor,
  burnPercent,
  toOfficeDateString,
  type CostAdjustmentInput,
  type CostOverviewQuery,
  type LedgerQuery,
  type ReverseEntryInput,
} from '@opsvera/shared';
import { Clock } from '../../common/clock';
import { DataScopeService } from '../../common/scope/data-scope.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService, type ScopedDb } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BudgetAlertService } from './budget-alert.service';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);
const num = (value: Prisma.Decimal | number | string | null | undefined) => Number(value ?? 0);
const r2 = (value: number) => Math.round(value * 100) / 100;
const fixed = (value: number) => r2(value).toFixed(2);

/** Tolerance when comparing the project's running totals with the ledger. */
const DRIFT_TOLERANCE = 0.01;

/**
 * The project cost ledger, read and corrected.
 *
 * The ledger is append-only and is the source of truth: the project's
 * `actual*` columns are running totals kept in step with it by the same
 * transaction that writes each row. Reading here never trusts them blindly —
 * the summary reconciles them against the ledger and says so when they differ.
 *
 * Whether an ADJUSTMENT row is labour or expense is not stored; it is read from
 * the hours: a labour adjustment always carries hours (possibly 0), an expense
 * adjustment has none.
 */
@Injectable()
export class CostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: DataScopeService,
    private readonly audit: AuditService,
    private readonly budget: BudgetAlertService,
    private readonly clock: Clock,
  ) {}

  private notFound() {
    return new NotFoundException({ code: 'NOT_FOUND', message: 'Project not found.' });
  }

  private invalid(field: string, message: string) {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message,
      details: [{ path: field, message }],
    });
  }

  /** The projects whose cost the caller may see; null = all of them. */
  private visibleProjects(user: AuthenticatedUser) {
    return this.scope.visibleProjectIds(user, this.scope.scopeFor(user, 'cost.view'));
  }

  private async project(projectId: string, user: AuthenticatedUser) {
    const ids = await this.visibleProjects(user);
    if (ids !== null && !ids.includes(projectId)) throw this.notFound();
    const project = await this.prisma.scoped.project.findFirst({
      where: { id: projectId, deletedAt: null },
      include: { office: { select: { timezone: true, shortCode: true } } },
    });
    if (!project) throw this.notFound();
    return project;
  }

  // -------------------------------------------------------------------------
  // The ledger
  // -------------------------------------------------------------------------

  async ledger(projectId: string, query: LedgerQuery, user: AuthenticatedUser) {
    await this.project(projectId, user);
    const where: Prisma.CostLedgerEntryWhereInput = {
      projectId,
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.from || query.to
        ? {
            postingDate: {
              ...(query.from ? { gte: d(query.from) } : {}),
              ...(query.to ? { lte: d(query.to) } : {}),
            },
          }
        : {}),
    };

    const [rows, total, sum] = await Promise.all([
      this.prisma.scoped.costLedgerEntry.findMany({
        where,
        orderBy: [{ postingDate: 'desc' }, { createdAt: 'desc' }, { isReversal: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.scoped.costLedgerEntry.count({ where }),
      this.prisma.scoped.costLedgerEntry.aggregate({ where, _sum: { amount: true, hours: true } }),
    ]);

    const [people, sheets, expenses, reversedBy, authors] = await Promise.all([
      this.lookupPeople(rows.map((r) => r.employeeId)),
      this.prisma.scoped.timesheet.findMany({
        where: {
          id: { in: rows.filter((r) => r.sourceType === 'TIMESHEET').map((r) => r.sourceId) },
        },
        select: { id: true, weekStartDate: true },
      }),
      this.prisma.scoped.expense.findMany({
        where: {
          id: { in: rows.filter((r) => r.sourceType === 'EXPENSE').map((r) => r.sourceId) },
        },
        select: { id: true, description: true, category: { select: { name: true } } },
      }),
      this.prisma.scoped.costLedgerEntry.findMany({
        where: { reversesId: { in: rows.map((r) => r.id) } },
        select: { reversesId: true },
      }),
      this.prisma.scoped.user.findMany({
        where: { id: { in: rows.map((r) => r.createdById).filter((x): x is string => !!x) } },
        select: { id: true, fullName: true },
      }),
    ]);
    const sheetWeek = new Map(sheets.map((s) => [s.id, iso(s.weekStartDate)]));
    const expenseInfo = new Map(expenses.map((e) => [e.id, e]));
    const reversed = new Set(reversedBy.map((r) => r.reversesId));
    const author = new Map(authors.map((a) => [a.id, a.fullName]));
    const canEdit = user.permissions.has('cost.edit');

    return {
      data: rows.map((r) => ({
        id: r.id,
        postingDate: iso(r.postingDate),
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        sourceLabel:
          r.sourceType === 'TIMESHEET'
            ? `Timesheet, week of ${sheetWeek.get(r.sourceId) ?? '—'}`
            : r.sourceType === 'EXPENSE'
              ? `Expense · ${expenseInfo.get(r.sourceId)?.category.name ?? ''}`
              : 'Adjustment',
        postingVersion: r.postingVersion,
        isReversal: r.isReversal,
        reversesId: r.reversesId,
        reversed: reversed.has(r.id),
        hours: r.hours === null ? null : num(r.hours),
        rateApplied: r.rateApplied === null ? null : num(r.rateApplied),
        rateBreakdown: r.rateBreakdown as unknown,
        amount: fixed(num(r.amount)),
        description: r.description,
        employee: r.employeeId ? (people.get(r.employeeId) ?? null) : null,
        postedBy: r.createdById ? (author.get(r.createdById) ?? null) : null,
        canReverse:
          canEdit && r.sourceType === 'ADJUSTMENT' && !r.isReversal && !reversed.has(r.id),
      })),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        netAmount: fixed(num(sum._sum.amount)),
        netHours: r2(num(sum._sum.hours)),
      },
    };
  }

  private async lookupPeople(ids: Array<string | null>) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (unique.length === 0)
      return new Map<string, { id: string; fullName: string; employeeCode: string }>();
    const rows = await this.prisma.scoped.employee.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true, employeeCode: true },
    });
    return new Map(
      rows.map((e) => [
        e.id,
        { id: e.id, fullName: `${e.firstName} ${e.lastName}`, employeeCode: e.employeeCode },
      ]),
    );
  }

  // -------------------------------------------------------------------------
  // Budget vs actual
  // -------------------------------------------------------------------------

  async summary(projectId: string, user: AuthenticatedUser) {
    const project = await this.project(projectId, user);
    const entries = await this.prisma.scoped.costLedgerEntry.findMany({
      where: { projectId },
      select: {
        sourceType: true,
        employeeId: true,
        postingDate: true,
        hours: true,
        amount: true,
      },
      orderBy: { postingDate: 'asc' },
    });

    // Net by kind, as the project's running totals are kept.
    let hours = 0;
    let labour = 0;
    let expense = 0;
    const bySource = {
      TIMESHEET: { hours: 0, amount: 0 },
      EXPENSE: { hours: 0, amount: 0 },
      ADJUSTMENT: { hours: 0, amount: 0 },
    };
    const people = new Map<string, { hours: number; amount: number }>();
    const days = new Map<string, { hours: number; cost: number }>();

    for (const e of entries) {
      const h = num(e.hours);
      const a = num(e.amount);
      hours += h;
      const isLabour =
        e.sourceType === 'TIMESHEET' || (e.sourceType === 'ADJUSTMENT' && e.hours !== null);
      if (isLabour) labour += a;
      else expense += a;
      bySource[e.sourceType].hours += h;
      bySource[e.sourceType].amount += a;
      if (e.sourceType === 'TIMESHEET' && e.employeeId) {
        const p = people.get(e.employeeId) ?? { hours: 0, amount: 0 };
        p.hours += h;
        p.amount += a;
        people.set(e.employeeId, p);
      }
      const day = days.get(iso(e.postingDate)) ?? { hours: 0, cost: 0 };
      day.hours += h;
      day.cost += a;
      days.set(iso(e.postingDate), day);
    }

    // The burn curve: running totals at each posting date.
    let cumulativeHours = 0;
    let cumulativeCost = 0;
    const series = [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => {
        cumulativeHours += v.hours;
        cumulativeCost += v.cost;
        return { date, hours: r2(cumulativeHours), cost: fixed(cumulativeCost) };
      });

    const names = await this.lookupPeople([...people.keys()]);
    const budgetHours = num(project.budgetHours);
    const actualHours = num(project.actualHours);
    const value = num(project.projectValue);
    const totalCost = num(project.actualTotalCost);

    const drift: string[] = [];
    const check = (label: string, stored: number, ledger: number) => {
      if (Math.abs(stored - ledger) > DRIFT_TOLERANCE) {
        drift.push(
          `${label}: project shows ${fixed(stored)}, the ledger adds up to ${fixed(ledger)}`,
        );
      }
    };
    check('Hours', actualHours, hours);
    check('Labour cost', num(project.actualLabourCost), labour);
    check('Expense cost', num(project.actualExpenseCost), expense);
    check('Total cost', totalCost, labour + expense);

    return {
      project: {
        id: project.id,
        projectCode: project.projectCode,
        name: project.name,
        status: project.status,
        health: project.health,
        office: project.office.shortCode,
      },
      budgetHours,
      actualHours: r2(actualHours),
      burnPercent: burnPercent(actualHours, budgetHours),
      alertLevel: alertLevelFor(burnPercent(actualHours, budgetHours)),
      hoursRemaining: r2(budgetHours - actualHours),
      actualLabourCost: fixed(num(project.actualLabourCost)),
      actualExpenseCost: fixed(num(project.actualExpenseCost)),
      actualTotalCost: fixed(totalCost),
      // Masked unless the caller holds the matching permission.
      projectValue: fixed(value),
      marginAmount: fixed(value - totalCost),
      marginPercent: value > 0 ? Math.round(((value - totalCost) / value) * 1000) / 10 : null,
      costPerHour: actualHours > 0 ? fixed(num(project.actualLabourCost) / actualHours) : null,
      bySource: {
        TIMESHEET: {
          hours: r2(bySource.TIMESHEET.hours),
          amount: fixed(bySource.TIMESHEET.amount),
        },
        EXPENSE: { hours: 0, amount: fixed(bySource.EXPENSE.amount) },
        ADJUSTMENT: {
          hours: r2(bySource.ADJUSTMENT.hours),
          amount: fixed(bySource.ADJUSTMENT.amount),
        },
      },
      byEmployee: [...people.entries()]
        .map(([id, v]) => ({
          employee: names.get(id) ?? { id, fullName: 'Former employee', employeeCode: '' },
          hours: r2(v.hours),
          amount: fixed(v.amount),
        }))
        .sort((a, b) => Number(b.amount) - Number(a.amount))
        .slice(0, 10),
      series,
      reconciled: drift.length === 0,
      drift,
    };
  }

  // -------------------------------------------------------------------------
  // All projects
  // -------------------------------------------------------------------------

  async overview(query: CostOverviewQuery, user: AuthenticatedUser) {
    const rows = await this.overviewRows(query, user);
    const start = (query.page - 1) * query.pageSize;
    const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);

    return {
      data: rows.slice(start, start + query.pageSize),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: rows.length,
        totalPages: Math.max(1, Math.ceil(rows.length / query.pageSize)),
        totalCost: fixed(sum((r) => num(r.actualTotalCost))),
        totalHours: r2(sum((r) => r.actualHours)),
        overBudget: rows.filter((r) => r.alertLevel === 100).length,
        nearBudget: rows.filter((r) => r.alertLevel === 80).length,
      },
    };
  }

  private async overviewRows(query: CostOverviewQuery, user: AuthenticatedUser) {
    const ids = await this.visibleProjects(user);
    const projects = await this.prisma.scoped.project.findMany({
      where: {
        deletedAt: null,
        ...(ids === null ? {} : { id: { in: ids } }),
        ...(query.status ? { status: query.status } : {}),
        ...(query.officeId ? { officeId: query.officeId } : {}),
        ...(query.q
          ? { OR: [{ projectCode: { contains: query.q } }, { name: { contains: query.q } }] }
          : {}),
      },
      include: {
        office: { select: { shortCode: true } },
        client: { select: { name: true } },
      },
    });

    return (
      projects
        .map((p) => {
          const actualHours = num(p.actualHours);
          const budgetHours = num(p.budgetHours);
          const burn = burnPercent(actualHours, budgetHours);
          const value = num(p.projectValue);
          const cost = num(p.actualTotalCost);
          return {
            id: p.id,
            projectCode: p.projectCode,
            name: p.name,
            client: p.client.name,
            office: p.office.shortCode,
            status: p.status,
            health: p.health,
            budgetHours,
            actualHours: r2(actualHours),
            burnPercent: burn,
            alertLevel: alertLevelFor(burn),
            actualLabourCost: fixed(num(p.actualLabourCost)),
            actualExpenseCost: fixed(num(p.actualExpenseCost)),
            actualTotalCost: fixed(cost),
            projectValue: fixed(value),
            marginAmount: fixed(value - cost),
            marginPercent: value > 0 ? Math.round(((value - cost) / value) * 1000) / 10 : null,
          };
        })
        .filter((r) => (query.alert ? r.alertLevel >= Number(query.alert) : true))
        // The projects closest to, or past, their budget come first.
        .sort(
          (a, b) =>
            (b.burnPercent ?? -1) - (a.burnPercent ?? -1) ||
            a.projectCode.localeCompare(b.projectCode),
        )
    );
  }

  // -------------------------------------------------------------------------
  // Adjustments
  // -------------------------------------------------------------------------

  /**
   * A manual correction: opening balances, a missed cost, a write-off. It is a
   * ledger row like any other, so it can be seen, filtered and reversed — never
   * edited or deleted.
   */
  async addAdjustment(projectId: string, input: CostAdjustmentInput, user: AuthenticatedUser) {
    const project = await this.project(projectId, user);
    if (input.postingDate > toOfficeDateString(this.clock.now(), project.office.timezone)) {
      throw this.invalid('postingDate', 'The posting date cannot be in the future.');
    }
    const amount = r2(Number(input.amount));
    const hours = input.kind === 'LABOUR' ? r2(input.hours ?? 0) : null;

    const entry = await this.prisma.scoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
      const row = await tx.costLedgerEntry.create({
        data: {
          projectId,
          sourceType: 'ADJUSTMENT',
          sourceId: randomUUID(),
          postingVersion: 1,
          postingDate: d(input.postingDate),
          hours,
          amount: amount.toFixed(2),
          description: input.description,
          createdById: user.userId,
        } as never,
      });
      await this.moveActuals(tx, projectId, input.kind, amount, hours ?? 0);
      return row;
    });

    await this.audit.record({
      action: 'CREATE',
      entityType: 'CostLedgerEntry',
      entityId: entry.id,
      summary: `Adjusted ${project.projectCode} ${input.kind.toLowerCase()} cost by ₹${amount.toFixed(2)}${hours ? ` and ${hours} h` : ''}: ${input.description}`,
      userId: user.userId,
    });
    if (input.kind === 'LABOUR') await this.budget.evaluate([projectId]);
    return { id: entry.id };
  }

  /** Takes an adjustment back with a mirror-image row. Timesheet and expense postings reverse through their own screens. */
  async reverseEntry(entryId: string, input: ReverseEntryInput, user: AuthenticatedUser) {
    const entry = await this.prisma.scoped.costLedgerEntry.findFirst({ where: { id: entryId } });
    if (!entry) throw this.notFound();
    const project = await this.project(entry.projectId, user);

    if (entry.sourceType !== 'ADJUSTMENT' || entry.isReversal) {
      throw new ConflictException({
        code: 'NOT_REVERSIBLE',
        message:
          entry.sourceType === 'ADJUSTMENT'
            ? 'That row is already a reversal.'
            : 'Timesheet and expense postings are reversed from the timesheet or the claim.',
      });
    }

    await this.prisma.scoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${entry.projectId} FOR UPDATE`;
      const already = await tx.costLedgerEntry.findFirst({ where: { reversesId: entry.id } });
      if (already) {
        throw new ConflictException({
          code: 'ALREADY_REVERSED',
          message: 'That adjustment has already been reversed.',
        });
      }
      const amount = -num(entry.amount);
      const hours = entry.hours === null ? null : -num(entry.hours);
      await tx.costLedgerEntry.create({
        data: {
          projectId: entry.projectId,
          employeeId: entry.employeeId,
          sourceType: 'ADJUSTMENT',
          sourceId: entry.sourceId,
          postingVersion: entry.postingVersion,
          isReversal: true,
          postingDate: entry.postingDate,
          hours: hours === null ? null : r2(hours).toFixed(2),
          amount: r2(amount).toFixed(2),
          description: `Reversal: ${input.reason}`,
          reversesId: entry.id,
          createdById: user.userId,
        } as never,
      });
      await this.moveActuals(
        tx,
        entry.projectId,
        entry.hours === null ? 'EXPENSE' : 'LABOUR',
        amount,
        hours ?? 0,
      );
    });

    await this.audit.record({
      action: 'REOPEN',
      entityType: 'CostLedgerEntry',
      entityId: entry.id,
      summary: `Reversed a ₹${fixed(num(entry.amount))} adjustment on ${project.projectCode}`,
      reason: input.reason,
      userId: user.userId,
    });
    if (entry.hours !== null) await this.budget.evaluate([entry.projectId]);
    return { reversed: true };
  }

  /** Moves the project's running totals, refusing to take any below zero. */
  private async moveActuals(
    tx: ScopedDb,
    projectId: string,
    kind: 'LABOUR' | 'EXPENSE',
    amount: number,
    hours: number,
  ) {
    const updated = await tx.project.update({
      where: { id: projectId },
      data:
        kind === 'LABOUR'
          ? {
              actualHours: { increment: hours.toFixed(2) },
              actualLabourCost: { increment: amount.toFixed(2) },
              actualTotalCost: { increment: amount.toFixed(2) },
            }
          : {
              actualExpenseCost: { increment: amount.toFixed(2) },
              actualTotalCost: { increment: amount.toFixed(2) },
            },
    });
    if (
      num(updated.actualHours) < -DRIFT_TOLERANCE ||
      num(updated.actualLabourCost) < -DRIFT_TOLERANCE ||
      num(updated.actualExpenseCost) < -DRIFT_TOLERANCE
    ) {
      // Throwing inside the transaction rolls the posting back.
      throw new ConflictException({
        code: 'WOULD_GO_NEGATIVE',
        message: 'That would take the project’s cost or hours below zero.',
      });
    }
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  async exportLedger(projectId: string, user: AuthenticatedUser) {
    const project = await this.project(projectId, user);
    const all: Awaited<ReturnType<CostService['ledger']>>['data'] = [];
    for (let page = 1; ; page += 1) {
      const result = await this.ledger(projectId, { page, pageSize: 200 } as LedgerQuery, user);
      all.push(...result.data);
      if (page >= result.meta.totalPages) break;
    }
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'OPSVERA';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Cost ledger', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'Posting date', key: 'date', width: 13 },
      { header: 'Source', key: 'source', width: 30 },
      { header: 'Employee', key: 'employee', width: 24 },
      { header: 'Hours', key: 'hours', width: 10, style: { numFmt: '#,##0.00' } },
      { header: 'Rate (INR/h)', key: 'rate', width: 13, style: { numFmt: '#,##0.00' } },
      { header: 'Amount (INR)', key: 'amount', width: 16, style: { numFmt: '#,##0.00' } },
      { header: 'Version', key: 'version', width: 9 },
      { header: 'Reversal', key: 'reversal', width: 10 },
      { header: 'Description', key: 'description', width: 50 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const r of all) {
      sheet.addRow({
        date: r.postingDate,
        source: r.sourceLabel,
        employee: r.employee?.fullName ?? '',
        hours: r.hours ?? '',
        rate: r.rateApplied ?? '',
        amount: Number(r.amount),
        version: r.postingVersion,
        reversal: r.isReversal ? 'Yes' : '',
        description: r.description ?? '',
      });
    }
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { buffer, fileName: `cost-ledger-${project.projectCode}.xlsx` };
  }

  async exportOverview(query: CostOverviewQuery, user: AuthenticatedUser) {
    const rows = await this.overviewRows(query, user);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'OPSVERA';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Project cost', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    const canValue = user.permissions.has('project.value.view');
    const canMargin = user.permissions.has('margin.view');
    sheet.columns = [
      { header: 'Project', key: 'code', width: 22 },
      { header: 'Name', key: 'name', width: 34 },
      { header: 'Client', key: 'client', width: 24 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Budget hours', key: 'budget', width: 13, style: { numFmt: '#,##0.00' } },
      { header: 'Actual hours', key: 'hours', width: 13, style: { numFmt: '#,##0.00' } },
      { header: 'Burn %', key: 'burn', width: 9 },
      { header: 'Labour (INR)', key: 'labour', width: 16, style: { numFmt: '#,##0.00' } },
      { header: 'Expenses (INR)', key: 'expense', width: 16, style: { numFmt: '#,##0.00' } },
      { header: 'Total cost (INR)', key: 'total', width: 16, style: { numFmt: '#,##0.00' } },
      ...(canValue
        ? [
            {
              header: 'Contract value (INR)',
              key: 'value',
              width: 18,
              style: { numFmt: '#,##0.00' },
            },
          ]
        : []),
      ...(canMargin ? [{ header: 'Margin %', key: 'margin', width: 10 }] : []),
    ];
    sheet.getRow(1).font = { bold: true };
    for (const r of rows) {
      sheet.addRow({
        code: r.projectCode,
        name: r.name,
        client: r.client,
        status: r.status.toLowerCase(),
        budget: r.budgetHours,
        hours: r.actualHours,
        burn: r.burnPercent ?? '',
        labour: Number(r.actualLabourCost),
        expense: Number(r.actualExpenseCost),
        total: Number(r.actualTotalCost),
        value: Number(r.projectValue),
        margin: r.marginPercent ?? '',
      });
    }
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      buffer,
      fileName: `project-cost-${toOfficeDateString(this.clock.now(), 'Asia/Kolkata')}.xlsx`,
    };
  }
}
