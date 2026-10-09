import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BookingStatus,
  canCancelBooking,
  type ApproveBookingInput,
  type AttachConfirmationEmailInput,
  type BookingListQuery,
  type CancelBookingInput,
  type ConfirmBookingInput,
  type CreateBookingInput,
  type UpdateBookingInput,
} from '@opsvera/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { runUnscoped } from '../../prisma/tenant-context';
import { AuditService } from '../audit/audit.service';
import { ProjectCodeService } from './project-code.service';
import { retryOnDeadlock } from '../../common/retry-on-deadlock';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly codes: ProjectCodeService,
  ) {}

  // -------------------------------------------------------------------------
  // Policy
  // -------------------------------------------------------------------------

  /** The company's booking policy, which the client has not finalised. */
  async policy(companyId: string) {
    const company = await runUnscoped(() =>
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
    );
    return {
      createRoleIds: (company.bookingCreateRoleIds as string[]) ?? [],
      confirmRoleIds: (company.bookingConfirmRoleIds as string[]) ?? [],
      requiresApproval: company.bookingRequiresApproval,
      verbalEmailGraceDays: company.verbalEmailGraceDays,
      codePrefix: company.codePrefix,
      pattern: company.projectCodePattern,
      fyStartMonth: company.fyStartMonth,
    };
  }

  /**
   * Role allow-lists narrow the permission, they never widen it.
   *
   * An empty list means "the permission alone decides", which is the Phase 1
   * default. A non-empty list means the user must also hold one of those roles.
   */
  private assertRoleAllowed(
    allowedRoleIds: string[],
    user: AuthenticatedUser,
    action: 'create' | 'confirm',
  ) {
    if (allowedRoleIds.length === 0) return;
    if (allowedRoleIds.includes(user.roleId)) return;

    throw new ForbiddenException({
      code: action === 'create' ? 'BOOKING_CREATE_ROLE' : 'BOOKING_CONFIRM_ROLE',
      message:
        action === 'create'
          ? 'Your role is not on the list allowed to create bookings. An administrator can change this in Settings.'
          : 'Your role is not on the list allowed to confirm bookings. An administrator can change this in Settings.',
    });
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  async list(query: BookingListQuery, user: AuthenticatedUser) {
    const where: Prisma.BookingWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status as BookingStatus } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.officeId ? { officeId: query.officeId } : {}),
      ...(query.projectTypeId ? { projectTypeId: query.projectTypeId } : {}),
      // Both filters are ANDed: spreading the same `confirmation` key twice
      // would let the later one silently replace the earlier.
      ...(query.confirmationType || query.emailPending
        ? {
            AND: [
              ...(query.confirmationType
                ? [{ confirmation: { type: query.confirmationType } }]
                : []),
              // "Email pending": confirmed verbally, email not attached yet.
              ...(query.emailPending
                ? [{ confirmation: { type: 'VERBAL' as const, emailDocumentId: null } }]
                : []),
            ],
          }
        : {}),
      ...(query.from || query.to
        ? {
            bookingDate: {
              ...(query.from ? { gte: d(query.from) } : {}),
              ...(query.to ? { lte: d(query.to) } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { bookingNumber: { contains: query.q } },
              { projectName: { contains: query.q } },
              { generatedProjectCode: { contains: query.q } },
              { client: { name: { contains: query.q } } },
            ],
          }
        : {}),
    };

    const [sortField, sortDirection] = (query.sort ?? 'bookingDate:desc').split(':');

    const [rows, total] = await Promise.all([
      this.prisma.scoped.booking.findMany({
        where,
        include: this.listInclude(),
        orderBy: { [sortField]: sortDirection as 'asc' | 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.scoped.booking.count({ where }),
    ]);

    // From the caller's own company, not from the first row — an empty page
    // (no bookings yet, or filters that match nothing) has no row to read it from.
    const graceDays = (await this.policy(user.companyId)).verbalEmailGraceDays;

    return {
      data: rows.map((row) => this.decorate(row, graceDays)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  /**
   * Offices and project types for the register's filters and the booking form.
   *
   * The settings endpoints need `settings.view`, which a Project Manager does
   * not have — yet they can open the register. This is the narrow read they
   * need, and nothing more.
   */
  async lookups() {
    const [offices, projectTypes] = await Promise.all([
      this.prisma.scoped.office.findMany({
        where: { isActive: true },
        select: { id: true, name: true, shortCode: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.scoped.projectType.findMany({
        where: { isActive: true },
        select: { id: true, name: true, shortCode: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { offices, projectTypes };
  }

  /** Headline counts for the register's KPI row and the Home page. */
  async summary(user: AuthenticatedUser) {
    const policy = await this.policy(user.companyId);
    const live = { deletedAt: null };
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [draft, awaitingApproval, projectCreated, cancelled, activeProjects, bookedThisMonth] =
      await Promise.all([
        this.prisma.scoped.booking.count({ where: { ...live, status: BookingStatus.DRAFT } }),
        this.prisma.scoped.booking.count({
          where: { ...live, status: BookingStatus.CONFIRMED, approvalStatus: 'PENDING' },
        }),
        this.prisma.scoped.booking.count({
          where: { ...live, status: BookingStatus.PROJECT_CREATED },
        }),
        this.prisma.scoped.booking.count({ where: { ...live, status: BookingStatus.CANCELLED } }),
        this.prisma.scoped.booking.count({
          where: { ...live, status: BookingStatus.PROJECT_CREATED, project: { status: 'ACTIVE' } },
        }),
        this.prisma.scoped.booking.aggregate({
          where: {
            ...live,
            status: { not: BookingStatus.CANCELLED },
            bookingDate: { gte: monthStart },
          },
          _count: true,
          _sum: { projectValue: true },
        }),
      ]);

    const pending = await this.prisma.scoped.booking.findMany({
      where: {
        ...live,
        status: { not: BookingStatus.CANCELLED },
        confirmation: { type: 'VERBAL', emailDocumentId: null },
      },
      select: { confirmation: { select: { confirmedOn: true } } },
    });
    const emailPending = pending.length;
    const emailOverdue =
      policy.verbalEmailGraceDays > 0
        ? pending.filter((row) => {
            const on = row.confirmation?.confirmedOn;
            return on && (Date.now() - on.getTime()) / 86_400_000 > policy.verbalEmailGraceDays;
          }).length
        : 0;

    return {
      draft,
      awaitingApproval,
      projectCreated,
      cancelled,
      activeProjects,
      emailPending,
      emailOverdue,
      bookedThisMonth: {
        count: bookedThisMonth._count,
        // Stripped by the masking interceptor without `project.value.view`.
        projectValue: bookedThisMonth._sum.projectValue?.toString() ?? '0',
      },
      requiresApproval: policy.requiresApproval,
    };
  }

  /**
   * What the next project code would look like, without consuming a number.
   *
   * Only a preview: another booking may be confirmed first, so the code a
   * confirmation actually issues can differ. The UI says so.
   */
  async codePreview(id: string, user: AuthenticatedUser) {
    const booking = await this.requireBooking(id);
    const policy = await this.policy(user.companyId);
    const projectType = await this.prisma.scoped.projectType.findFirstOrThrow({
      where: { id: booking.projectTypeId },
    });

    if (booking.generatedProjectCode) {
      return {
        code: booking.generatedProjectCode,
        issued: true,
        requiresApproval: policy.requiresApproval,
      };
    }

    const code = await this.codes.preview(this.prisma.scoped, {
      companyId: user.companyId,
      codePrefix: policy.codePrefix,
      pattern: policy.pattern,
      fyStartMonth: policy.fyStartMonth,
      bookingDate: booking.bookingDate.toISOString().slice(0, 10),
      typeShortCode: projectType.shortCode,
    });
    return { code, issued: false, requiresApproval: policy.requiresApproval };
  }

  async findOne(id: string, user: AuthenticatedUser) {
    const booking = await this.prisma.scoped.booking.findFirst({
      where: { id, deletedAt: null },
      include: {
        ...this.listInclude(),
        confirmation: { include: { emailDocument: true, poDocument: true } },
      },
    });
    if (!booking) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Booking not found.' });
    }

    const policy = await this.policy(user.companyId);
    return {
      ...this.decorate(booking, policy.verbalEmailGraceDays),
      policy: {
        requiresApproval: policy.requiresApproval,
        verbalEmailGraceDays: policy.verbalEmailGraceDays,
      },
    };
  }

  private listInclude() {
    return {
      client: { select: { id: true, name: true } },
      clientContact: { select: { id: true, name: true, email: true } },
      projectType: { select: { id: true, name: true, shortCode: true, colorToken: true } },
      office: { select: { id: true, name: true, shortCode: true } },
      confirmation: true,
      project: { select: { id: true, projectCode: true, status: true } },
    };
  }

  /**
   * Adds the derived state the UI needs: the lifecycle stage, whether a verbal
   * booking is still waiting on its email, and whether that wait is overdue.
   */
  private decorate(
    booking: Prisma.BookingGetPayload<{ include: ReturnType<BookingsService['listInclude']> }>,
    graceDays: number,
  ) {
    const confirmation = booking.confirmation;
    const emailPending = confirmation?.type === 'VERBAL' && !confirmation.emailDocumentId;

    let emailOverdueDays: number | null = null;
    if (emailPending && graceDays > 0 && confirmation?.confirmedOn) {
      const elapsed = Math.floor((Date.now() - confirmation.confirmedOn.getTime()) / 86_400_000);
      // A reminder, never a block.
      if (elapsed > graceDays) emailOverdueDays = elapsed - graceDays;
    }

    return {
      ...booking,
      emailPending,
      emailOverdueDays,
      lifecycleStage: this.lifecycleStage(booking),
      canCancel: canCancelBooking(booking.status as BookingStatus),
    };
  }

  /** Index into the five-stage stepper the UI renders. */
  private lifecycleStage(booking: { status: string; project: unknown; confirmation: unknown }) {
    if (booking.status === BookingStatus.CANCELLED) return 0;
    if (booking.project) return 4;
    if (booking.status === BookingStatus.CONFIRMED) return 2;
    if (booking.confirmation) return 1;
    return 0;
  }

  // -------------------------------------------------------------------------
  // Create & update
  // -------------------------------------------------------------------------

  async create(input: CreateBookingInput, user: AuthenticatedUser) {
    const policy = await this.policy(user.companyId);
    this.assertRoleAllowed(policy.createRoleIds, user, 'create');

    const booking = await this.createWithNextNumber(input, policy.fyStartMonth, user);

    await this.audit.record({
      action: 'CREATE',
      entityType: 'Booking',
      entityId: booking.id,
      summary: `Created booking ${booking.bookingNumber} for ${input.projectName}`,
      after: input,
      userId: user.userId,
    });

    return this.findOne(booking.id, user);
  }

  /**
   * Creates the booking, retrying if two people get the same number.
   *
   * The number is a read-then-write, so concurrent creates can compute the
   * same one. Rather than lock a counter table for something this cheap, the
   * unique index is allowed to arbitrate and the loser simply tries again.
   */
  private async createWithNextNumber(
    input: CreateBookingInput,
    fyStartMonth: number,
    user: AuthenticatedUser,
  ) {
    const MAX_ATTEMPTS = 8;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const bookingNumber = await this.nextBookingNumber(input.bookingDate, fyStartMonth);
      try {
        return await this.prisma.scoped.booking.create({
          data: this.bookingData(input, bookingNumber, user) as never,
        });
      } catch (error) {
        const isDuplicateNumber =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!isDuplicateNumber || attempt === MAX_ATTEMPTS) throw error;
        // Someone took that number first; recompute and go again.
      }
    }

    throw new ConflictException({
      code: 'BOOKING_NUMBER_CONTENTION',
      message: 'Too many bookings are being created at once. Try again in a moment.',
    });
  }

  private bookingData(input: CreateBookingInput, bookingNumber: string, user: AuthenticatedUser) {
    return {
      bookingNumber,
      clientId: input.clientId,
      clientContactId: input.clientContactId ?? null,
      projectName: input.projectName,
      projectTypeId: input.projectTypeId,
      officeId: input.officeId,
      bookingDate: d(input.bookingDate),
      projectValue: input.projectValue,
      budgetHours: String(input.budgetHours),
      billingType: input.billingType,
      expectedStartDate: d(input.expectedStartDate),
      expectedEndDate: d(input.expectedEndDate),
      scopeDescription: input.scopeDescription ?? null,
      projectManagerId: input.projectManagerId ?? null,
      status: BookingStatus.DRAFT,
      createdById: user.userId,
    };
  }

  async update(id: string, input: UpdateBookingInput, user: AuthenticatedUser) {
    const before = await this.requireBooking(id);

    // Once a project exists the commercial terms are the project's, not the
    // booking's; editing here would silently diverge the two.
    if (before.status === BookingStatus.PROJECT_CREATED) {
      throw new BadRequestException({
        code: 'BOOKING_LOCKED',
        message:
          'This booking has become a project. Edit the project instead — the booking is now a record of what was agreed.',
      });
    }
    if (before.status === BookingStatus.CANCELLED) {
      throw new BadRequestException({
        code: 'BOOKING_CANCELLED',
        message: 'A cancelled booking cannot be edited.',
      });
    }

    const after = await this.prisma.scoped.booking.update({
      where: { id },
      data: {
        ...input,
        ...(input.bookingDate ? { bookingDate: d(input.bookingDate) } : {}),
        ...(input.expectedStartDate ? { expectedStartDate: d(input.expectedStartDate) } : {}),
        ...(input.expectedEndDate ? { expectedEndDate: d(input.expectedEndDate) } : {}),
        ...(input.budgetHours !== undefined ? { budgetHours: String(input.budgetHours) } : {}),
      } as never,
    });

    await this.audit.recordChange({
      action: 'UPDATE',
      entityType: 'Booking',
      entityId: id,
      summary: `Updated booking ${after.bookingNumber}`,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      fields: [
        'projectName',
        'clientId',
        'projectTypeId',
        'officeId',
        'bookingDate',
        'projectValue',
        'budgetHours',
        'billingType',
        'expectedStartDate',
        'expectedEndDate',
        'projectManagerId',
      ],
      userId: user.userId,
    });

    return this.findOne(id, user);
  }

  // -------------------------------------------------------------------------
  // Confirm — the core transaction
  // -------------------------------------------------------------------------

  /**
   * Confirms a booking and, unless the company requires a second approval,
   * creates its project in the same transaction.
   *
   * The whole sequence is one transaction on purpose: lock the sequence, mint
   * the code, create the project, mark the booking, write the audit row. If any
   * step fails, the code number is released with it — a project can never exist
   * without a booking, and a code can never be issued without a project.
   */
  async confirm(id: string, input: ConfirmBookingInput, user: AuthenticatedUser) {
    const policy = await this.policy(user.companyId);
    this.assertRoleAllowed(policy.confirmRoleIds, user, 'confirm');

    const booking = await this.requireBooking(id);

    if (booking.status === BookingStatus.PROJECT_CREATED) {
      throw new ConflictException({
        code: 'ALREADY_CONFIRMED',
        message: `This booking is already project ${booking.generatedProjectCode}.`,
      });
    }
    if (booking.status === BookingStatus.CANCELLED) {
      throw new BadRequestException({
        code: 'BOOKING_CANCELLED',
        message: 'A cancelled booking cannot be confirmed.',
      });
    }

    // The rule the whole module exists to enforce: no proof, no confirmation.
    // The Zod discriminated union already guarantees one shape or the other is
    // complete; this checks the referenced document actually exists.
    if (input.confirmation.type === 'EMAIL') {
      await this.requireDocument(input.confirmation.emailDocumentId, 'confirmation email');
    }
    if (input.poDocumentId) {
      await this.requireDocument(input.poDocumentId, 'purchase order');
    }

    const projectType = await this.prisma.scoped.projectType.findFirstOrThrow({
      where: { id: booking.projectTypeId },
    });

    // Committed before the transaction opens, so the lock inside it is only
    // ever a plain row lock. See ProjectCodeService.ensureSequence.
    await this.codes.ensureSequence({
      companyId: user.companyId,
      bookingDate: booking.bookingDate.toISOString().slice(0, 10),
      fyStartMonth: policy.fyStartMonth,
    });

    const result = await retryOnDeadlock(
      () =>
        this.prisma.scoped.$transaction(
          async (tx) => {
            // Re-read inside the transaction: two confirmations racing must not
            // both pass the status check above.
            const current = await tx.booking.findFirstOrThrow({ where: { id } });
            if (current.status === BookingStatus.PROJECT_CREATED) {
              throw new ConflictException({
                code: 'ALREADY_CONFIRMED',
                message: 'Another user confirmed this booking a moment ago.',
              });
            }

            await tx.bookingConfirmation.upsert({
              where: { bookingId: id },
              create: this.confirmationData(id, input, user),
              update: this.confirmationData(id, input, user),
            } as never);

            const confirmedAt = new Date();

            // Approval gate: stop here and wait, if the company asks for it.
            if (policy.requiresApproval) {
              const held = await tx.booking.update({
                where: { id },
                data: {
                  status: BookingStatus.CONFIRMED,
                  confirmedAt,
                  confirmedById: user.userId,
                  approvalStatus: 'PENDING',
                },
              });

              await this.audit.record(
                {
                  action: 'CONFIRM',
                  entityType: 'Booking',
                  entityId: id,
                  summary: `Confirmed booking ${held.bookingNumber} (${input.confirmation.type}); awaiting approval before the project is created`,
                  after: { confirmationType: input.confirmation.type, approvalStatus: 'PENDING' },
                  userId: user.userId,
                },
                tx,
              );

              return { booking: held, project: null as { projectCode: string } | null };
            }

            return this.mintAndCreateProject(tx, {
              booking: current,
              typeShortCode: projectType.shortCode,
              policy,
              user,
              confirmationType: input.confirmation.type,
              confirmedAt,
            });
          },
          // The sequence lock serialises concurrent confirmations, so a little
          // extra headroom beyond the 5s default.
          { timeout: 15_000 },
        ),
      { label: `confirm booking ${booking.bookingNumber}` },
    );

    if (result.project) {
      await this.notifyProjectManager(id, result.project.projectCode, user);
    }

    return this.findOne(id, user);
  }

  /** The approval step, when the company has it switched on. */
  async decideApproval(id: string, input: ApproveBookingInput, user: AuthenticatedUser) {
    const booking = await this.requireBooking(id);
    const policy = await this.policy(user.companyId);

    if (!policy.requiresApproval) {
      throw new BadRequestException({
        code: 'APPROVAL_NOT_REQUIRED',
        message: 'Booking approval is switched off for this company.',
      });
    }
    if (booking.approvalStatus !== 'PENDING') {
      throw new BadRequestException({
        code: 'NOT_PENDING',
        message: 'This booking is not waiting for approval.',
      });
    }

    if (input.decision === 'REJECTED') {
      const rejected = await this.prisma.scoped.booking.update({
        where: { id },
        data: {
          approvalStatus: 'REJECTED',
          approvedAt: new Date(),
          approvedById: user.userId,
          approvalNote: input.note ?? null,
          // Back to draft so it can be corrected and re-submitted.
          status: BookingStatus.DRAFT,
        },
      });
      await this.audit.record({
        action: 'REJECT',
        entityType: 'Booking',
        entityId: id,
        summary: `Rejected booking ${rejected.bookingNumber}: ${input.note ?? 'no reason given'}`,
        userId: user.userId,
      });
      return this.findOne(id, user);
    }

    const projectType = await this.prisma.scoped.projectType.findFirstOrThrow({
      where: { id: booking.projectTypeId },
    });

    await this.codes.ensureSequence({
      companyId: user.companyId,
      bookingDate: booking.bookingDate.toISOString().slice(0, 10),
      fyStartMonth: policy.fyStartMonth,
    });

    const result = await retryOnDeadlock(
      () =>
        this.prisma.scoped.$transaction(
          async (tx) => {
            const current = await tx.booking.findFirstOrThrow({ where: { id } });
            if (current.status === BookingStatus.PROJECT_CREATED) {
              throw new ConflictException({
                code: 'ALREADY_CONFIRMED',
                message: 'This booking already has a project.',
              });
            }
            await tx.booking.update({
              where: { id },
              data: {
                approvalStatus: 'APPROVED',
                approvedAt: new Date(),
                approvedById: user.userId,
                approvalNote: input.note ?? null,
              },
            });
            return this.mintAndCreateProject(tx, {
              booking: current,
              typeShortCode: projectType.shortCode,
              policy,
              user,
              confirmationType: 'APPROVAL',
              confirmedAt: current.confirmedAt ?? new Date(),
            });
          },
          { timeout: 15_000 },
        ),
      { label: `approve booking ${booking.bookingNumber}` },
    );

    if (result.project) {
      await this.notifyProjectManager(id, result.project.projectCode, user);
    }
    return this.findOne(id, user);
  }

  /** Mints the code and creates the project. Always inside a transaction. */
  private async mintAndCreateProject(
    tx: Parameters<Parameters<PrismaService['scoped']['$transaction']>[0]>[0],
    args: {
      booking: { id: string; bookingNumber: string; [key: string]: unknown };
      typeShortCode: string;
      policy: Awaited<ReturnType<BookingsService['policy']>>;
      user: AuthenticatedUser;
      confirmationType: string;
      confirmedAt: Date;
    },
  ) {
    const booking = args.booking as unknown as Prisma.BookingGetPayload<object>;

    const minted = await this.codes.mint(tx, {
      companyId: args.user.companyId,
      codePrefix: args.policy.codePrefix,
      pattern: args.policy.pattern,
      fyStartMonth: args.policy.fyStartMonth,
      bookingDate: booking.bookingDate.toISOString().slice(0, 10),
      typeShortCode: args.typeShortCode,
    });

    const project = await tx.project.create({
      data: {
        projectCode: minted.projectCode,
        name: booking.projectName,
        bookingId: booking.id,
        clientId: booking.clientId,
        projectTypeId: booking.projectTypeId,
        officeId: booking.officeId,
        projectManagerId: booking.projectManagerId,
        status: 'ACTIVE',
        health: 'HEALTHY',
        startDate: booking.expectedStartDate,
        endDate: booking.expectedEndDate,
        // Carried over from the booking, exactly as agreed.
        projectValue: booking.projectValue,
        budgetHours: booking.budgetHours,
        billingType: booking.billingType,
        description: booking.scopeDescription,
        createdById: args.user.userId,
      } as never,
    });

    const updated = await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.PROJECT_CREATED,
        confirmedAt: args.confirmedAt,
        confirmedById: booking.confirmedById ?? args.user.userId,
        generatedProjectCode: minted.projectCode,
      },
    });

    await this.audit.record(
      {
        action: 'CONFIRM',
        entityType: 'Booking',
        entityId: booking.id,
        summary: `Confirmed booking ${updated.bookingNumber} and created project ${minted.projectCode}`,
        after: {
          confirmationType: args.confirmationType,
          projectCode: minted.projectCode,
          sequence: minted.sequence,
          financialYear: minted.fyLabel,
          projectId: project.id,
        },
        userId: args.user.userId,
      },
      tx,
    );

    return { booking: updated, project };
  }

  private confirmationData(bookingId: string, input: ConfirmBookingInput, user: AuthenticatedUser) {
    const base = {
      bookingId,
      poDocumentId: input.poDocumentId ?? null,
      poNumber: input.poNumber ?? null,
      createdById: user.userId,
    };

    if (input.confirmation.type === 'EMAIL') {
      return {
        ...base,
        type: 'EMAIL' as const,
        emailDocumentId: input.confirmation.emailDocumentId,
        emailReceivedAt: d(input.confirmation.receivedAt),
        notes: input.confirmation.notes ?? null,
        confirmedByName: null,
        confirmedOn: null,
        verbalMode: null,
        verbalSummary: null,
      };
    }

    return {
      ...base,
      type: 'VERBAL' as const,
      confirmedByName: input.confirmation.confirmedByName,
      confirmedOn: d(input.confirmation.confirmedOn),
      verbalMode: input.confirmation.mode,
      verbalSummary: input.confirmation.summary,
      emailDocumentId: null,
      emailReceivedAt: null,
    };
  }

  // -------------------------------------------------------------------------
  // Attach a late email, and cancellation
  // -------------------------------------------------------------------------

  /** Clears the "Email pending" badge on a verbal booking. */
  async attachConfirmationEmail(
    id: string,
    input: AttachConfirmationEmailInput,
    user: AuthenticatedUser,
  ) {
    const booking = await this.requireBooking(id);
    const confirmation = await this.prisma.scoped.bookingConfirmation.findUnique({
      where: { bookingId: id },
    });

    if (!confirmation) {
      throw new BadRequestException({
        code: 'NOT_CONFIRMED',
        message: 'This booking has no confirmation yet.',
      });
    }
    if (confirmation.emailDocumentId) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_ATTACHED',
        message: 'A confirmation email is already attached.',
      });
    }

    await this.requireDocument(input.emailDocumentId, 'confirmation email');

    await this.prisma.scoped.bookingConfirmation.update({
      where: { bookingId: id },
      data: {
        emailDocumentId: input.emailDocumentId,
        emailReceivedAt: d(input.receivedAt),
        notes: input.notes ?? confirmation.notes,
      },
    });

    await this.audit.record({
      action: 'UPDATE',
      entityType: 'Booking',
      entityId: id,
      summary: `Attached the confirmation email to ${booking.bookingNumber}; it was confirmed verbally`,
      after: { emailDocumentId: input.emailDocumentId, receivedAt: input.receivedAt },
      userId: user.userId,
    });

    return this.findOne(id, user);
  }

  /**
   * Cancels a booking.
   *
   * Blocked once a project exists: the project carries a code, time and cost
   * that have to keep resolving, so the project is cancelled instead and the
   * booking follows from there.
   */
  async cancel(id: string, input: CancelBookingInput, user: AuthenticatedUser) {
    const booking = await this.prisma.scoped.booking.findFirst({
      where: { id, deletedAt: null },
      include: { project: { select: { id: true, projectCode: true, status: true } } },
    });
    if (!booking) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Booking not found.' });
    }

    const verdict = canCancelBooking(booking.status as BookingStatus);
    if (!verdict.allowed) {
      throw new ConflictException({
        code:
          booking.status === BookingStatus.PROJECT_CREATED ? 'PROJECT_EXISTS' : 'ALREADY_CANCELLED',
        message: verdict.reason!,
        details: booking.project
          ? {
              projectId: booking.project.id,
              projectCode: booking.project.projectCode,
              // Tells the UI exactly where to send the user.
              action: 'CANCEL_PROJECT',
            }
          : undefined,
      });
    }

    const cancelled = await this.prisma.scoped.booking.update({
      where: { id },
      data: {
        status: BookingStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: input.reason,
      },
    });

    await this.audit.record({
      action: 'UPDATE',
      entityType: 'Booking',
      entityId: id,
      summary: `Cancelled booking ${cancelled.bookingNumber}`,
      reason: input.reason,
      before: { status: booking.status },
      after: { status: BookingStatus.CANCELLED },
      userId: user.userId,
    });

    return this.findOne(id, user);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async requireBooking(id: string) {
    const booking = await this.prisma.scoped.booking.findFirst({
      where: { id, deletedAt: null },
    });
    if (!booking) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Booking not found.' });
    }
    return booking;
  }

  private async requireDocument(documentId: string, label: string) {
    const document = await this.prisma.scoped.document.findFirst({
      where: { id: documentId, deletedAt: null },
    });
    if (!document) {
      throw new BadRequestException({
        code: 'DOCUMENT_NOT_FOUND',
        message: `The ${label} could not be found. Upload it again.`,
      });
    }
    return document;
  }

  /** Booking numbers are per company per financial year, like project codes. */
  private async nextBookingNumber(bookingDate: string, fyStartMonth: number) {
    const [year, month] = bookingDate.split('-').map(Number);
    const fyStartYear = month >= fyStartMonth ? year : year - 1;
    const label = `${String(fyStartYear % 100).padStart(2, '0')}${String((fyStartYear + 1) % 100).padStart(2, '0')}`;

    const latest = await this.prisma.scoped.booking.findFirst({
      where: { bookingNumber: { startsWith: `BKG-${label}-` } },
      orderBy: { bookingNumber: 'desc' },
      select: { bookingNumber: true },
    });

    const next = latest ? Number(latest.bookingNumber.split('-').pop()) + 1 : 1;
    return `BKG-${label}-${String(next).padStart(4, '0')}`;
  }

  private async notifyProjectManager(
    bookingId: string,
    projectCode: string,
    user: AuthenticatedUser,
  ) {
    const booking = await this.prisma.scoped.booking.findFirst({ where: { id: bookingId } });
    if (!booking?.projectManagerId) return;

    // `projectManagerId` holds an Employee id but is not a Prisma relation, so
    // the employee is looked up directly.
    const manager = await this.prisma.scoped.employee.findFirst({
      where: { id: booking.projectManagerId, deletedAt: null },
      select: { userId: true },
    });

    const managerUserId = manager?.userId;
    if (!managerUserId || managerUserId === user.userId) return;

    await this.prisma.scoped.notification.create({
      data: {
        userId: managerUserId,
        type: 'BOOKING_CONFIRMED',
        title: `${projectCode} is ready to plan`,
        body: `${booking.projectName} has been confirmed and the project created.`,
        linkUrl: `/bookings/${bookingId}`,
        entityType: 'Booking',
        entityId: bookingId,
      } as never,
    });
  }
}
