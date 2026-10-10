import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import {
  checkLimits,
  expenseEditable,
  expenseWindowStart,
  looksLikeReceipt,
  monthRangeOf,
  RECEIPT_MAX_BYTES,
  toOfficeDateString,
  type BulkExpenseDecisionInput,
  type ExpenseDecisionInput,
  type ExpenseInput,
  type ExpenseListQuery,
  type ExpenseStatusValue,
  type ReimburseInput,
  type ReverseExpenseInput,
  type UpdateExpenseInput,
} from '@opsvera/shared';
import { Clock } from '../../common/clock';
import { NotifyService } from '../../common/notify/notify.service';
import { DataScopeService } from '../../common/scope/data-scope.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService, type ScopedDb } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { postExpenseCost, reverseExpenseCost, type TxClient } from '../cost/cost-posting.logic';
import { FilesService, type StoredUpload } from '../files/files.service';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);
const money = (value: Prisma.Decimal | string | number) => Number(value);
const fixed = (value: Prisma.Decimal | string | number) => money(value).toFixed(2);

const INCLUDE = {
  employee: {
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      userId: true,
      office: { select: { shortCode: true, timezone: true } },
    },
  },
  project: { select: { id: true, projectCode: true, name: true } },
  category: true,
  receiptDocument: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
  approvals: { orderBy: { stage: 'asc' } },
} satisfies Prisma.ExpenseInclude;

type Row = Prisma.ExpenseGetPayload<{ include: typeof INCLUDE }>;

/** Statuses that count towards a person's month for the category limit. */
const LIVE: ExpenseStatusValue[] = ['PENDING_MANAGER', 'PENDING_FINANCE', 'APPROVED'];

const FINANCE_ROLE = 'FINANCE';

/**
 * Expenses: entry, the two-step approval, reimbursement and cost posting.
 *
 * Stage 1 ("manager") is anyone with `expense.approve` whose scope reaches the
 * claimant — except the Finance role, which has its own stage. Stage 2
 * ("finance") needs `expense.reimburse` as well, and must be a different
 * person. Nobody decides their own claim. Money-moving steps run in a
 * transaction that first locks the claim, so two clicks cannot approve or
 * post it twice.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: DataScopeService,
    private readonly notify: NotifyService,
    private readonly files: FilesService,
    private readonly clock: Clock,
  ) {}

  private notFound() {
    return new NotFoundException({ code: 'NOT_FOUND', message: 'Expense not found.' });
  }

  private invalid(field: string, message: string) {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message,
      details: [{ path: field, message }],
    });
  }

  private async me(user: AuthenticatedUser) {
    if (!user.employeeId) {
      throw new ForbiddenException({
        code: 'NO_EMPLOYEE_PROFILE',
        message:
          'Your login is not linked to an employee record, so there is nothing to claim for.',
      });
    }
    const employee = await this.prisma.scoped.employee.findFirst({
      where: { id: user.employeeId, deletedAt: null },
      include: { office: { select: { timezone: true } } },
    });
    if (!employee) throw this.notFound();
    return employee;
  }

  private today(timeZone: string) {
    return toOfficeDateString(this.clock.now(), timeZone);
  }

  // -------------------------------------------------------------------------
  // Lookups and receipts
  // -------------------------------------------------------------------------

  async lookups(user: AuthenticatedUser) {
    const employee = await this.me(user);
    const [categories, projects] = await Promise.all([
      this.prisma.scoped.expenseCategory.findMany({
        where: { isActive: true, deletedAt: null },
        orderBy: { name: 'asc' },
      }),
      this.prisma.scoped.project.findMany({
        where: {
          deletedAt: null,
          status: { not: 'CANCELLED' },
          OR: [
            { projectManagerId: employee.id },
            { members: { some: { employeeId: employee.id } } },
          ],
        },
        select: { id: true, projectCode: true, name: true, status: true },
        orderBy: { projectCode: 'asc' },
      }),
    ]);
    return {
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        shortCode: c.shortCode,
        perClaimLimit: c.perClaimLimit ? fixed(c.perClaimLimit) : null,
        perMonthLimit: c.perMonthLimit ? fixed(c.perMonthLimit) : null,
        requiresReceipt: c.requiresReceipt,
      })),
      projects,
    };
  }

  /** Stores a receipt photo or PDF. It is attached to a claim when the claim is saved. */
  async uploadReceipt(upload: StoredUpload, user: AuthenticatedUser) {
    await this.me(user);
    if (upload.size > RECEIPT_MAX_BYTES) {
      throw this.invalid('receipt', 'The receipt is over 10 MB.');
    }
    // The browser says what it thinks the file is; the bytes decide.
    if (!looksLikeReceipt(upload.buffer.subarray(0, 16))) {
      throw this.invalid('receipt', 'Attach a photo (JPEG, PNG, WebP) or a PDF.');
    }
    const document = await this.files.store(
      upload,
      { ownerType: 'EXPENSE', category: 'Receipt' },
      user,
    );
    return {
      id: document.id,
      fileName: document.fileName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
    };
  }

  async openReceipt(id: string, user: AuthenticatedUser) {
    const row = await this.prisma.scoped.expense.findFirst({
      where: { id, deletedAt: null },
      select: { employeeId: true, receiptDocumentId: true, status: true },
    });
    // A draft, and its receipt, is private to its author.
    const hidden = row?.status === 'DRAFT' && row.employeeId !== user.employeeId;
    if (!row || hidden || !(await this.canSee(row.employeeId, user)) || !row.receiptDocumentId) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'No receipt for that expense.' });
    }
    return this.files.openForDownload(row.receiptDocumentId);
  }

  /** A receipt may only be attached by the person who uploaded it, and only once. */
  private async checkReceipt(
    documentId: string,
    expenseId: string | null,
    user: AuthenticatedUser,
  ) {
    const doc = await this.prisma.scoped.document.findFirst({
      where: { id: documentId, deletedAt: null, ownerType: 'EXPENSE' },
    });
    if (!doc || doc.uploadedById !== user.userId || (doc.ownerId && doc.ownerId !== expenseId)) {
      throw this.invalid('receiptDocumentId', 'That receipt is not available. Upload it again.');
    }
  }

  // -------------------------------------------------------------------------
  // Entry
  // -------------------------------------------------------------------------

  private async validate(
    employee: { id: string; joiningDate: Date; office: { timezone: string } },
    input: { categoryId: string; projectId?: string | null; expenseDate: string },
  ) {
    const today = this.today(employee.office.timezone);
    if (input.expenseDate > today) {
      throw this.invalid('expenseDate', 'The expense date cannot be in the future.');
    }
    if (input.expenseDate < expenseWindowStart(today)) {
      throw this.invalid('expenseDate', 'Claims can go back 90 days. Ask Finance for older ones.');
    }
    if (input.expenseDate < iso(employee.joiningDate)) {
      throw this.invalid('expenseDate', 'That is before you joined.');
    }
    const category = await this.prisma.scoped.expenseCategory.findFirst({
      where: { id: input.categoryId, isActive: true, deletedAt: null },
    });
    if (!category) throw this.invalid('categoryId', 'That category is not available.');

    if (input.projectId) {
      const project = await this.prisma.scoped.project.findFirst({
        where: { id: input.projectId, deletedAt: null },
        select: {
          projectCode: true,
          status: true,
          projectManagerId: true,
          members: { where: { employeeId: employee.id }, select: { id: true } },
        },
      });
      if (!project) throw this.invalid('projectId', 'That project was not found.');
      if (project.status === 'CANCELLED') {
        throw this.invalid('projectId', `${project.projectCode} is cancelled and takes no claims.`);
      }
      if (project.members.length === 0 && project.projectManagerId !== employee.id) {
        throw this.invalid('projectId', `You are not on the ${project.projectCode} team.`);
      }
    }
    return category;
  }

  /** What the person already has live in that category and month. */
  private async monthSoFar(
    db: ScopedDb,
    employeeId: string,
    categoryId: string,
    expenseDate: string,
    excludeId?: string,
  ) {
    const { from, to } = monthRangeOf(expenseDate);
    const agg = await db.expense.aggregate({
      where: {
        employeeId,
        categoryId,
        deletedAt: null,
        status: { in: LIVE },
        expenseDate: { gte: d(from), lte: d(to) },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      _sum: { amount: true },
    });
    return money(agg._sum.amount ?? 0);
  }

  private async limits(
    db: ScopedDb,
    employeeId: string,
    category: {
      id: string;
      perClaimLimit: Prisma.Decimal | null;
      perMonthLimit: Prisma.Decimal | null;
    },
    amount: number,
    expenseDate: string,
    excludeId?: string,
  ) {
    return checkLimits({
      amount,
      perClaimLimit: category.perClaimLimit ? money(category.perClaimLimit) : null,
      perMonthLimit: category.perMonthLimit ? money(category.perMonthLimit) : null,
      monthSoFar: await this.monthSoFar(db, employeeId, category.id, expenseDate, excludeId),
    });
  }

  /** The same person, date, amount and category already claimed: likely a double entry. */
  private async duplicateOf(employeeId: string, input: ExpenseInput, excludeId?: string) {
    return this.prisma.scoped.expense.findFirst({
      where: {
        employeeId,
        deletedAt: null,
        categoryId: input.categoryId,
        expenseDate: d(input.expenseDate),
        amount: input.amount,
        status: { not: 'REJECTED' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
  }

  async create(input: ExpenseInput, user: AuthenticatedUser) {
    const employee = await this.me(user);
    const category = await this.validate(employee, input);
    if (input.receiptDocumentId) await this.checkReceipt(input.receiptDocumentId, null, user);

    const limit = await this.limits(
      this.prisma.scoped,
      employee.id,
      category,
      money(input.amount),
      input.expenseDate,
    );
    const duplicate = await this.duplicateOf(employee.id, input);

    const created = await this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.expense.create({
        data: {
          employeeId: employee.id,
          projectId: input.projectId ?? null,
          categoryId: input.categoryId,
          expenseDate: d(input.expenseDate),
          amount: input.amount,
          isBillable: input.isBillable,
          description: input.description ?? null,
          receiptDocumentId: input.receiptDocumentId ?? null,
          status: 'DRAFT',
          exceededLimit: limit.exceededClaim || limit.exceededMonth,
          createdById: user.userId,
        } as never,
      });
      if (input.receiptDocumentId) {
        await tx.document.update({
          where: { id: input.receiptDocumentId },
          data: { ownerId: row.id },
        });
      }
      return row;
    });
    await this.audit.record({
      action: 'CREATE',
      entityType: 'Expense',
      entityId: created.id,
      summary: `${employee.employeeCode} drafted an expense of ₹${fixed(input.amount)} (${category.name})`,
      userId: user.userId,
    });
    return {
      ...(await this.get(created.id, user)),
      warnings: [
        ...limit.messages,
        ...(duplicate ? ['You already have a claim with the same date, category and amount.'] : []),
      ],
    };
  }

  async update(id: string, input: UpdateExpenseInput, user: AuthenticatedUser) {
    const employee = await this.me(user);
    const row = await this.ownEditable(id, employee.id);

    const next = {
      categoryId: input.categoryId ?? row.categoryId,
      projectId: input.projectId !== undefined ? input.projectId : row.projectId,
      expenseDate: input.expenseDate ?? iso(row.expenseDate),
      amount: input.amount ?? fixed(row.amount),
      isBillable: input.isBillable ?? row.isBillable,
      description: input.description !== undefined ? input.description : row.description,
      receiptDocumentId:
        input.receiptDocumentId !== undefined ? input.receiptDocumentId : row.receiptDocumentId,
    };
    const category = await this.validate(employee, next);
    if (next.receiptDocumentId && next.receiptDocumentId !== row.receiptDocumentId) {
      await this.checkReceipt(next.receiptDocumentId, id, user);
    }
    const limit = await this.limits(
      this.prisma.scoped,
      employee.id,
      category,
      money(next.amount),
      next.expenseDate,
      id,
    );

    await this.prisma.scoped.$transaction(async (tx) => {
      await tx.expense.update({
        where: { id },
        data: {
          categoryId: next.categoryId,
          projectId: next.projectId ?? null,
          expenseDate: d(next.expenseDate),
          amount: next.amount,
          isBillable: next.isBillable,
          description: next.description ?? null,
          receiptDocumentId: next.receiptDocumentId ?? null,
          exceededLimit: limit.exceededClaim || limit.exceededMonth,
        },
      });
      if (next.receiptDocumentId && next.receiptDocumentId !== row.receiptDocumentId) {
        await tx.document.update({ where: { id: next.receiptDocumentId }, data: { ownerId: id } });
      }
    });
    return { ...(await this.get(id, user)), warnings: limit.messages };
  }

  private async ownEditable(id: string, employeeId: string) {
    const row = await this.prisma.scoped.expense.findFirst({ where: { id, deletedAt: null } });
    // Someone else's claim does not exist for you.
    if (!row || row.employeeId !== employeeId) throw this.notFound();
    if (!expenseEditable(row.status as ExpenseStatusValue)) {
      throw new ConflictException({
        code: 'EXPENSE_LOCKED',
        message:
          row.status === 'APPROVED'
            ? 'That claim is approved and locked.'
            : 'That claim is with an approver. Withdraw it to change it.',
      });
    }
    return row;
  }

  async remove(id: string, user: AuthenticatedUser) {
    const employee = await this.me(user);
    const row = await this.ownEditable(id, employee.id);
    await this.prisma.scoped.expense.update({
      where: { id },
      data: { deletedAt: this.clock.now() },
    });
    await this.audit.record({
      action: 'DELETE',
      entityType: 'Expense',
      entityId: id,
      summary: `${employee.employeeCode} deleted an expense of ₹${fixed(row.amount)}`,
      userId: user.userId,
    });
    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Submit and withdraw
  // -------------------------------------------------------------------------

  async submit(id: string, user: AuthenticatedUser) {
    const employee = await this.me(user);
    const found = await this.ownEditable(id, employee.id);
    const category = await this.validate(employee, {
      categoryId: found.categoryId,
      projectId: found.projectId,
      expenseDate: iso(found.expenseDate),
    });
    if (category.requiresReceipt && !found.receiptDocumentId) {
      throw this.invalid(
        'receiptDocumentId',
        `${category.name} claims need a receipt. Attach one first.`,
      );
    }

    const now = this.clock.now();
    const limit = await this.prisma.scoped.$transaction(async (tx) => {
      // The month's total is read and then a claim joins it: serialise per person.
      await tx.$queryRaw`SELECT id FROM employees WHERE id = ${employee.id} FOR UPDATE`;
      const fresh = await tx.expense.findFirstOrThrow({ where: { id } });
      if (!expenseEditable(fresh.status as ExpenseStatusValue)) {
        throw new ConflictException({
          code: 'EXPENSE_LOCKED',
          message: 'That claim has already been submitted.',
        });
      }
      const check = await this.limits(
        tx,
        employee.id,
        category,
        money(fresh.amount),
        iso(fresh.expenseDate),
        id,
      );
      // A resubmission starts the approval afresh; the earlier decision stays in the audit log.
      await tx.expenseApproval.deleteMany({ where: { expenseId: id } });
      await tx.expenseApproval.create({
        data: { expenseId: id, stage: 'MANAGER', status: 'PENDING' } as never,
      });
      await tx.expense.update({
        where: { id },
        data: {
          status: 'PENDING_MANAGER',
          submittedAt: now,
          rejectedAt: null,
          exceededLimit: check.exceededClaim || check.exceededMonth,
        },
      });
      return check;
    });

    await this.audit.record({
      action: 'UPDATE',
      entityType: 'Expense',
      entityId: id,
      summary: `${employee.employeeCode} submitted an expense of ₹${fixed(found.amount)} (${category.name})`,
      userId: user.userId,
    });
    await this.notify.toApprovers(
      'expense.approve',
      employee.id,
      'EXPENSE_SUBMITTED',
      {
        title: `${employee.firstName} ${employee.lastName} claimed ₹${fixed(found.amount)} (${category.name})`,
        body: limit.messages[0] ?? found.description,
        linkUrl: '/expenses?tab=approvals',
        entityType: 'Expense',
        entityId: id,
      },
      { excludeRoleKeys: [FINANCE_ROLE] },
    );
    return { ...(await this.get(id, user)), warnings: limit.messages };
  }

  /** Takes a claim back before the manager has decided on it. */
  async withdraw(id: string, user: AuthenticatedUser) {
    const employee = await this.me(user);
    await this.prisma.scoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM expenses WHERE id = ${id} FOR UPDATE`;
      const row = await tx.expense.findFirst({ where: { id, deletedAt: null } });
      if (!row || row.employeeId !== employee.id) throw this.notFound();
      if (row.status !== 'PENDING_MANAGER') {
        throw new ConflictException({
          code: 'NOT_WITHDRAWABLE',
          message: 'Only a claim still waiting for its manager can be withdrawn.',
        });
      }
      await tx.expenseApproval.deleteMany({ where: { expenseId: id } });
      await tx.expense.update({ where: { id }, data: { status: 'DRAFT', submittedAt: null } });
    });
    await this.audit.record({
      action: 'UPDATE',
      entityType: 'Expense',
      entityId: id,
      summary: `${employee.employeeCode} withdrew an expense claim`,
      userId: user.userId,
    });
    return this.get(id, user);
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  /** The people whose claims the caller may see or act on, per permission. */
  private async reach(user: AuthenticatedUser) {
    const resolve = async (key: string): Promise<string[] | null> =>
      user.permissions.has(key)
        ? this.scope.visibleEmployeeIds(user, this.scope.scopeFor(user, key))
        : [];
    const [view, approve, reimburse] = await Promise.all([
      resolve('expense.view'),
      resolve('expense.approve'),
      resolve('expense.reimburse'),
    ]);
    const mine = user.employeeId ? [user.employeeId] : [];
    const allowed =
      view === null || approve === null || reimburse === null
        ? null
        : [...new Set([...mine, ...view, ...approve, ...reimburse])];
    return { view, approve, reimburse, allowed };
  }

  private async canSee(employeeId: string, user: AuthenticatedUser) {
    if (employeeId === user.employeeId) return true;
    const { allowed } = await this.reach(user);
    return allowed === null || allowed.includes(employeeId);
  }

  private isFinanceRole(user: AuthenticatedUser) {
    return user.systemRoleKey === FINANCE_ROLE;
  }

  private buildWhere(
    query: ExpenseListQuery,
    user: AuthenticatedUser,
    reach: Awaited<ReturnType<ExpensesService['reach']>>,
  ): Prisma.ExpenseWhereInput {
    const and: Prisma.ExpenseWhereInput[] = [{ deletedAt: null }];

    const wanted = query.mine ? (user.employeeId ?? '__none__') : query.employeeId;
    if (wanted) {
      and.push({
        employeeId: reach.allowed === null || reach.allowed.includes(wanted) ? wanted : '__none__',
      });
    } else if (reach.allowed !== null) {
      and.push({ employeeId: { in: reach.allowed } });
    }

    // Other people's drafts are theirs alone.
    and.push({ OR: [{ status: { not: 'DRAFT' } }, { employeeId: user.employeeId ?? '__none__' }] });

    if (query.status) and.push({ status: query.status });
    if (query.reimbursement) and.push({ reimbursementStatus: query.reimbursement });
    if (query.projectId) and.push({ projectId: query.projectId });
    if (query.categoryId) and.push({ categoryId: query.categoryId });
    if (query.from) and.push({ expenseDate: { gte: d(query.from) } });
    if (query.to) and.push({ expenseDate: { lte: d(query.to) } });
    if (query.q) {
      and.push({
        OR: [
          { description: { contains: query.q } },
          { employee: { firstName: { contains: query.q } } },
          { employee: { lastName: { contains: query.q } } },
          { employee: { employeeCode: { contains: query.q } } },
        ],
      });
    }

    const me = user.employeeId ?? '__none__';
    if (query.toDecide) {
      const managerStage: Prisma.ExpenseWhereInput | null =
        user.permissions.has('expense.approve') && !this.isFinanceRole(user)
          ? {
              status: 'PENDING_MANAGER',
              employeeId:
                reach.approve === null
                  ? { not: me }
                  : { in: reach.approve.filter((e) => e !== me) },
            }
          : null;
      const financeStage: Prisma.ExpenseWhereInput | null =
        user.permissions.has('expense.approve') && user.permissions.has('expense.reimburse')
          ? {
              status: 'PENDING_FINANCE',
              employeeId:
                reach.reimburse === null
                  ? { not: me }
                  : { in: reach.reimburse.filter((e) => e !== me) },
              // The second decision must be a different person from the first.
              approvals: {
                none: { stage: 'MANAGER', approverId: user.userId },
              },
            }
          : null;
      const stages = [managerStage, financeStage].filter(
        (s): s is Prisma.ExpenseWhereInput => s !== null,
      );
      and.push(stages.length ? { OR: stages } : { id: '__none__' });
    }
    if (query.toReimburse) {
      and.push(
        user.permissions.has('expense.reimburse')
          ? { status: 'APPROVED', reimbursementStatus: 'PENDING' }
          : { id: '__none__' },
      );
    }
    return { AND: and };
  }

  async list(query: ExpenseListQuery, user: AuthenticatedUser) {
    const reach = await this.reach(user);
    const where = this.buildWhere(query, user, reach);
    const [rows, total, sum] = await Promise.all([
      this.prisma.scoped.expense.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.scoped.expense.count({ where }),
      this.prisma.scoped.expense.aggregate({ where, _sum: { amount: true } }),
    ]);
    const names = await this.approverNames(rows);
    return {
      data: rows.map((r) => this.shape(r, user, reach, names)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        totalAmount: fixed(sum._sum.amount ?? 0),
      },
    };
  }

  async get(id: string, user: AuthenticatedUser) {
    const row = await this.prisma.scoped.expense.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE,
    });
    if (!row || !(await this.canSee(row.employeeId, user))) throw this.notFound();
    // A draft is private to its author.
    if (row.status === 'DRAFT' && row.employeeId !== user.employeeId) throw this.notFound();

    const reach = await this.reach(user);
    const names = await this.approverNames([row]);
    const limit = await this.limits(
      this.prisma.scoped,
      row.employeeId,
      row.category,
      money(row.amount),
      iso(row.expenseDate),
      row.id,
    );
    return { ...this.shape(row, user, reach, names), limitMessages: limit.messages };
  }

  /** Headline numbers for the Expenses page. */
  async summary(user: AuthenticatedUser) {
    const reach = await this.reach(user);
    const sum = async (where: Prisma.ExpenseWhereInput) => {
      const a = await this.prisma.scoped.expense.aggregate({
        where: { deletedAt: null, ...where },
        _sum: { amount: true },
        _count: true,
      });
      return { count: a._count, amount: fixed(a._sum.amount ?? 0) };
    };
    const me = user.employeeId ?? '__none__';
    const toDecide = await this.list(
      { toDecide: true, page: 1, pageSize: 1 } as ExpenseListQuery,
      user,
    );
    return {
      mine: {
        waiting: await sum({
          employeeId: me,
          status: { in: ['PENDING_MANAGER', 'PENDING_FINANCE'] },
        }),
        approvedUnpaid: await sum({
          employeeId: me,
          status: 'APPROVED',
          reimbursementStatus: 'PENDING',
        }),
        reimbursed: await sum({
          employeeId: me,
          status: 'APPROVED',
          reimbursementStatus: 'REIMBURSED',
        }),
        rejected: await sum({ employeeId: me, status: 'REJECTED' }),
        drafts: await sum({ employeeId: me, status: 'DRAFT' }),
      },
      toDecide: { count: toDecide.meta.total, amount: toDecide.meta.totalAmount },
      toReimburse: user.permissions.has('expense.reimburse')
        ? await sum({
            status: 'APPROVED',
            reimbursementStatus: 'PENDING',
            ...(reach.reimburse === null ? {} : { employeeId: { in: reach.reimburse } }),
          })
        : { count: 0, amount: '0.00' },
    };
  }

  private async approverNames(rows: Array<{ approvals: Array<{ approverId: string | null }> }>) {
    const ids = [
      ...new Set(rows.flatMap((r) => r.approvals.map((a) => a.approverId)).filter(Boolean)),
    ] as string[];
    if (ids.length === 0) return new Map<string, string>();
    const users = await this.prisma.scoped.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  private shape(
    row: Row,
    user: AuthenticatedUser,
    reach: Awaited<ReturnType<ExpensesService['reach']>>,
    names: Map<string, string>,
  ) {
    const status = row.status as ExpenseStatusValue;
    const owner = row.employeeId === user.employeeId;
    const inScope = (ids: string[] | null) => ids === null || ids.includes(row.employeeId);
    const managerDone = row.approvals.find((a) => a.stage === 'MANAGER');

    const canDecideManager =
      status === 'PENDING_MANAGER' &&
      !owner &&
      user.permissions.has('expense.approve') &&
      !this.isFinanceRole(user) &&
      inScope(reach.approve);
    const canDecideFinance =
      status === 'PENDING_FINANCE' &&
      !owner &&
      user.permissions.has('expense.approve') &&
      user.permissions.has('expense.reimburse') &&
      inScope(reach.reimburse) &&
      managerDone?.approverId !== user.userId;
    const finance = user.permissions.has('expense.reimburse') && !owner && inScope(reach.reimburse);

    return {
      id: row.id,
      status,
      expenseDate: iso(row.expenseDate),
      amount: fixed(row.amount),
      currency: row.currency,
      isBillable: row.isBillable,
      description: row.description,
      exceededLimit: row.exceededLimit,
      reimbursementStatus: row.reimbursementStatus,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      rejectedAt: row.rejectedAt?.toISOString() ?? null,
      reimbursedAt: row.reimbursedAt?.toISOString() ?? null,
      costPosted: row.costPostedAt !== null,
      employee: {
        id: row.employee.id,
        employeeCode: row.employee.employeeCode,
        fullName: `${row.employee.firstName} ${row.employee.lastName}`,
        office: row.employee.office.shortCode,
      },
      project: row.project,
      category: {
        id: row.category.id,
        name: row.category.name,
        shortCode: row.category.shortCode,
        perClaimLimit: row.category.perClaimLimit ? fixed(row.category.perClaimLimit) : null,
        perMonthLimit: row.category.perMonthLimit ? fixed(row.category.perMonthLimit) : null,
        requiresReceipt: row.category.requiresReceipt,
      },
      receipt: row.receiptDocument,
      awaiting:
        status === 'PENDING_MANAGER' ? 'MANAGER' : status === 'PENDING_FINANCE' ? 'FINANCE' : null,
      approvals: row.approvals.map((a) => ({
        stage: a.stage,
        status: a.status,
        comment: a.comment,
        decidedAt: a.decidedAt?.toISOString() ?? null,
        approver: a.approverId ? (names.get(a.approverId) ?? null) : null,
      })),
      isMine: owner,
      canEdit: owner && expenseEditable(status),
      canSubmit: owner && expenseEditable(status),
      canWithdraw: owner && status === 'PENDING_MANAGER',
      canDecide: canDecideManager || canDecideFinance,
      canReimburse: finance && status === 'APPROVED' && row.reimbursementStatus === 'PENDING',
      canReverse: finance && status === 'APPROVED' && row.reimbursementStatus === 'PENDING',
    };
  }

  // -------------------------------------------------------------------------
  // Decide
  // -------------------------------------------------------------------------

  async decide(id: string, input: ExpenseDecisionInput, user: AuthenticatedUser) {
    const found = await this.prisma.scoped.expense.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE,
    });
    // Out of scope: the claim does not exist for you. Drafts are private.
    if (!found || (found.status === 'DRAFT' && found.employeeId !== user.employeeId)) {
      throw this.notFound();
    }
    if (found.employeeId === user.employeeId) {
      throw new ForbiddenException({
        code: 'SELF_APPROVAL',
        message: 'You cannot decide your own claim. Someone else has to.',
      });
    }
    if (found.status !== 'PENDING_MANAGER' && found.status !== 'PENDING_FINANCE') {
      if (!(await this.canSee(found.employeeId, user))) throw this.notFound();
      throw new ConflictException({
        code: 'NOT_PENDING',
        message: 'That claim has already been decided, or was withdrawn.',
      });
    }
    const reach = await this.reach(user);
    const stage = found.status === 'PENDING_FINANCE' ? 'FINANCE' : 'MANAGER';
    // Someone who can see the claim but has no Finance authority is told which step it is at.
    if (stage === 'FINANCE' && !user.permissions.has('expense.reimburse')) {
      if (!(await this.canSee(found.employeeId, user))) throw this.notFound();
      throw new ForbiddenException({
        code: 'WRONG_STAGE',
        message: 'This claim is waiting for Finance.',
      });
    }
    const ids = stage === 'FINANCE' ? reach.reimburse : reach.approve;
    if (ids !== null && !ids.includes(found.employeeId)) throw this.notFound();

    if (stage === 'MANAGER' && this.isFinanceRole(user)) {
      throw new ForbiddenException({
        code: 'WRONG_STAGE',
        message: 'This claim is waiting for the employee’s manager. Finance decides after them.',
      });
    }
    if (stage === 'FINANCE' && !user.permissions.has('expense.reimburse')) {
      throw new ForbiddenException({
        code: 'WRONG_STAGE',
        message: 'This claim is waiting for Finance.',
      });
    }

    const now = this.clock.now();
    const label = `${found.employee.employeeCode}'s ${found.category.name} claim of ₹${fixed(found.amount)}`;

    const outcome = await this.prisma.scoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM expenses WHERE id = ${id} FOR UPDATE`;
      const row = await tx.expense.findFirstOrThrow({
        where: { id },
        include: { approvals: true },
      });
      const current = row.status === 'PENDING_FINANCE' ? 'FINANCE' : 'MANAGER';
      if (
        (row.status !== 'PENDING_MANAGER' && row.status !== 'PENDING_FINANCE') ||
        current !== stage
      ) {
        throw new ConflictException({
          code: 'NOT_PENDING',
          message: 'That claim has already been decided, or was withdrawn.',
        });
      }
      const managerRow = row.approvals.find((a) => a.stage === 'MANAGER');
      if (stage === 'FINANCE' && managerRow?.approverId === user.userId) {
        throw new ForbiddenException({
          code: 'SAME_APPROVER',
          message: 'You approved the first step. Finance’s decision needs someone else.',
        });
      }

      const stageRow = row.approvals.find((a) => a.stage === stage);
      const decided = {
        status: input.decision,
        approverId: user.userId,
        decidedAt: now,
        comment: input.comment ?? null,
      };
      if (stageRow) {
        await tx.expenseApproval.update({ where: { id: stageRow.id }, data: decided });
      } else {
        await tx.expenseApproval.create({
          data: { expenseId: id, stage, ...decided } as never,
        });
      }

      if (input.decision === 'REJECTED') {
        await tx.expense.update({ where: { id }, data: { status: 'REJECTED', rejectedAt: now } });
        return 'REJECTED' as const;
      }
      if (stage === 'MANAGER') {
        await tx.expenseApproval.create({
          data: { expenseId: id, stage: 'FINANCE', status: 'PENDING' } as never,
        });
        await tx.expense.update({ where: { id }, data: { status: 'PENDING_FINANCE' } });
        return 'TO_FINANCE' as const;
      }

      // Final approval: the claim becomes project cost, exactly once.
      let posted: Date | null = null;
      if (row.projectId) {
        await postExpenseCost(tx as unknown as TxClient, {
          companyId: user.companyId,
          expenseId: id,
          projectId: row.projectId,
          employeeId: row.employeeId,
          postingDate: row.expenseDate,
          amount: fixed(row.amount),
          description: `Approved expense — ${found.category.name}`,
          createdById: user.userId,
        });
        posted = now;
      }
      await tx.expense.update({
        where: { id },
        data: { status: 'APPROVED', approvedAt: now, costPostedAt: posted },
      });
      return 'APPROVED' as const;
    });

    await this.audit.record({
      action: input.decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
      entityType: 'Expense',
      entityId: id,
      summary:
        input.decision === 'REJECTED'
          ? `${stage === 'FINANCE' ? 'Finance' : 'Manager'} rejected ${label}: ${input.comment}`
          : outcome === 'APPROVED'
            ? `Finance approved ${label}${found.projectId ? '; cost posted to the project' : ''}`
            : `Manager approved ${label}; sent to Finance`,
      userId: user.userId,
    });

    if (outcome === 'TO_FINANCE') {
      await this.notify.toApprovers(
        'expense.reimburse',
        found.employeeId,
        'EXPENSE_SUBMITTED',
        {
          title: `${found.employee.firstName} ${found.employee.lastName}'s claim of ₹${fixed(found.amount)} needs Finance approval`,
          body: found.exceededLimit ? 'Flagged: over a category limit.' : found.description,
          linkUrl: '/expenses?tab=approvals',
          entityType: 'Expense',
          entityId: id,
        },
        { exceptEmployeeId: user.employeeId ?? undefined },
      );
    } else {
      await this.notify.toEmployee(
        found.employeeId,
        outcome === 'APPROVED' ? 'EXPENSE_APPROVED' : 'EXPENSE_REJECTED',
        {
          title:
            outcome === 'APPROVED'
              ? `Your ₹${fixed(found.amount)} ${found.category.name} claim was approved`
              : `Your ₹${fixed(found.amount)} ${found.category.name} claim was not approved`,
          body: input.comment ?? undefined,
          linkUrl: '/expenses',
          entityType: 'Expense',
          entityId: id,
        },
      );
    }
    return this.get(id, user);
  }

  /** Each claim is its own transaction: one failing does not stop the rest. */
  async bulkDecide(input: BulkExpenseDecisionInput, user: AuthenticatedUser) {
    const results: Array<{ id: string; ok: boolean; code?: string; message?: string }> = [];
    for (const id of input.ids) {
      try {
        await this.decide(id, { decision: input.decision, comment: input.comment }, user);
        results.push({ id, ok: true });
      } catch (error) {
        const body = (error as { getResponse?: () => unknown }).getResponse?.() as
          { code?: string; message?: string } | undefined;
        results.push({
          id,
          ok: false,
          code: body?.code ?? 'ERROR',
          message: body?.message ?? 'Could not decide.',
        });
      }
    }
    return {
      results,
      done: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };
  }

  // -------------------------------------------------------------------------
  // Reimbursement and reversal (Finance)
  // -------------------------------------------------------------------------

  async reimburse(input: ReimburseInput, user: AuthenticatedUser) {
    const reach = await this.reach(user);
    const results: Array<{ id: string; ok: boolean; code?: string; message?: string }> = [];
    for (const id of input.ids) {
      try {
        const row = await this.prisma.scoped.expense.findFirst({
          where: { id, deletedAt: null },
          include: INCLUDE,
        });
        if (!row || (reach.reimburse !== null && !reach.reimburse.includes(row.employeeId))) {
          throw this.notFound();
        }
        if (row.employeeId === user.employeeId) {
          throw new ForbiddenException({
            code: 'SELF_APPROVAL',
            message: 'You cannot mark your own claim as paid. Someone else has to.',
          });
        }
        const now = this.clock.now();
        await this.prisma.scoped.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM expenses WHERE id = ${id} FOR UPDATE`;
          const fresh = await tx.expense.findFirstOrThrow({ where: { id } });
          if (fresh.status !== 'APPROVED' || fresh.reimbursementStatus !== 'PENDING') {
            throw new ConflictException({
              code: 'NOT_PAYABLE',
              message: 'Only an approved claim that has not been paid can be marked reimbursed.',
            });
          }
          await tx.expense.update({
            where: { id },
            data: { reimbursementStatus: 'REIMBURSED', reimbursedAt: now },
          });
        });
        await this.audit.record({
          action: 'UPDATE',
          entityType: 'Expense',
          entityId: id,
          summary: `Marked ${row.employee.employeeCode}'s ₹${fixed(row.amount)} claim as reimbursed`,
          userId: user.userId,
        });
        await this.notify.toEmployee(row.employeeId, 'EXPENSE_APPROVED', {
          title: `₹${fixed(row.amount)} was reimbursed`,
          body: row.category.name,
          linkUrl: '/expenses',
          entityType: 'Expense',
          entityId: id,
        });
        results.push({ id, ok: true });
      } catch (error) {
        const body = (error as { getResponse?: () => unknown }).getResponse?.() as
          { code?: string; message?: string } | undefined;
        results.push({
          id,
          ok: false,
          code: body?.code ?? 'ERROR',
          message: body?.message ?? 'Could not mark as reimbursed.',
        });
      }
    }
    return {
      results,
      done: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };
  }

  /**
   * Takes an approved, unpaid claim back: its cost posting is reversed on the
   * ledger and the claim returns to the employee as rejected, to correct or drop.
   */
  async reverse(id: string, input: ReverseExpenseInput, user: AuthenticatedUser) {
    const found = await this.prisma.scoped.expense.findFirst({
      where: { id, deletedAt: null },
      include: INCLUDE,
    });
    const reach = await this.reach(user);
    if (!found || (reach.reimburse !== null && !reach.reimburse.includes(found.employeeId))) {
      throw this.notFound();
    }
    if (found.employeeId === user.employeeId) {
      throw new ForbiddenException({
        code: 'SELF_APPROVAL',
        message: 'You cannot reverse your own claim. Someone else has to.',
      });
    }
    const now = this.clock.now();
    const result = await this.prisma.scoped.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM expenses WHERE id = ${id} FOR UPDATE`;
      const row = await tx.expense.findFirstOrThrow({ where: { id } });
      if (row.status !== 'APPROVED') {
        throw new ConflictException({
          code: 'NOT_APPROVED',
          message: 'Only an approved claim can be reversed.',
        });
      }
      if (row.reimbursementStatus === 'REIMBURSED') {
        throw new ConflictException({
          code: 'ALREADY_PAID',
          message:
            'That claim has been paid out. Recover the money outside the app, then adjust the cost.',
        });
      }
      const posted = await reverseExpenseCost(tx as unknown as TxClient, {
        companyId: user.companyId,
        expenseId: id,
        reason: input.reason,
        createdById: user.userId,
      });
      await tx.expenseApproval.updateMany({
        where: { expenseId: id, stage: 'FINANCE' },
        data: { status: 'REJECTED', comment: `Reversed: ${input.reason}`, decidedAt: now },
      });
      await tx.expense.update({
        where: { id },
        data: { status: 'REJECTED', rejectedAt: now, approvedAt: null, costPostedAt: null },
      });
      return posted;
    });
    await this.audit.record({
      action: 'REOPEN',
      entityType: 'Expense',
      entityId: id,
      summary: `Reversed the approved ₹${fixed(found.amount)} claim of ${found.employee.employeeCode}${result.reversed ? '; cost posting reversed' : ''}`,
      reason: input.reason,
      userId: user.userId,
    });
    await this.notify.toEmployee(found.employeeId, 'EXPENSE_REJECTED', {
      title: `Your approved ₹${fixed(found.amount)} claim was reversed`,
      body: input.reason,
      linkUrl: '/expenses',
      entityType: 'Expense',
      entityId: id,
    });
    return this.get(id, user);
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  async exportWorkbook(query: ExpenseListQuery, user: AuthenticatedUser) {
    const reach = await this.reach(user);
    const rows = await this.prisma.scoped.expense.findMany({
      where: this.buildWhere(query, user, reach),
      include: INCLUDE,
      orderBy: [{ expenseDate: 'desc' }],
      take: 5000,
    });
    const names = await this.approverNames(rows);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'OPSVERA';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Expenses', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Code', key: 'code', width: 12 },
      { header: 'Employee', key: 'employee', width: 24 },
      { header: 'Category', key: 'category', width: 18 },
      { header: 'Project', key: 'project', width: 24 },
      { header: 'Amount (INR)', key: 'amount', width: 14, style: { numFmt: '#,##0.00' } },
      { header: 'Billable', key: 'billable', width: 9 },
      { header: 'Status', key: 'status', width: 18 },
      { header: 'Over limit', key: 'over', width: 10 },
      { header: 'Reimbursed', key: 'paid', width: 12 },
      { header: 'Manager', key: 'manager', width: 20 },
      { header: 'Finance', key: 'finance', width: 20 },
      { header: 'Description', key: 'description', width: 40 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const r of rows) {
      const manager = r.approvals.find((a) => a.stage === 'MANAGER');
      const finance = r.approvals.find((a) => a.stage === 'FINANCE');
      sheet.addRow({
        date: iso(r.expenseDate),
        code: r.employee.employeeCode,
        employee: `${r.employee.firstName} ${r.employee.lastName}`,
        category: r.category.name,
        project: r.project?.projectCode ?? '',
        amount: money(r.amount),
        billable: r.isBillable ? 'Yes' : 'No',
        status: r.status.replace('_', ' ').toLowerCase(),
        over: r.exceededLimit ? 'Yes' : '',
        paid: r.reimbursementStatus === 'REIMBURSED' ? 'Yes' : '',
        manager: manager?.approverId ? (names.get(manager.approverId) ?? '') : '',
        finance: finance?.approverId ? (names.get(finance.approverId) ?? '') : '',
        description: r.description ?? '',
      });
    }
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { buffer, fileName: `expenses-${this.today('Asia/Kolkata')}.xlsx` };
  }
}
