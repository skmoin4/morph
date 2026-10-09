import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: {
    page: number;
    pageSize: number;
    q?: string;
    sort?: string;
    isActive?: boolean;
  }) {
    const where: Prisma.ClientWhereInput = {
      deletedAt: null,
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q } },
              { clientCode: { contains: query.q } },
              { city: { contains: query.q } },
            ],
          }
        : {}),
    };
    const [sortField, sortDirection] = (query.sort ?? 'name:asc').split(':');

    const [data, total] = await Promise.all([
      this.prisma.scoped.client.findMany({
        where,
        include: {
          contacts: { where: { deletedAt: null }, orderBy: { isPrimary: 'desc' } },
          _count: { select: { bookings: true, projects: true } },
        },
        orderBy: { [sortField]: sortDirection as 'asc' | 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.scoped.client.count({ where }),
    ]);

    return {
      data,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async findOne(id: string) {
    const client = await this.prisma.scoped.client.findFirst({
      where: { id, deletedAt: null },
      include: {
        contacts: { where: { deletedAt: null }, orderBy: { isPrimary: 'desc' } },
        bookings: {
          where: { deletedAt: null },
          orderBy: { bookingDate: 'desc' },
          take: 20,
          include: {
            projectType: { select: { shortCode: true } },
            project: { select: { id: true, projectCode: true, status: true } },
          },
        },
        _count: { select: { bookings: true, projects: true } },
      },
    });
    if (!client) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Client not found.' });
    return client;
  }

  async create(input: Record<string, unknown>, user: AuthenticatedUser) {
    await this.assertNameFree(input.name as string);

    const { contacts, ...clientData } = input as { contacts?: unknown[]; [k: string]: unknown };

    const client = await this.prisma.scoped.$transaction(async (tx) => {
      const created = await tx.client.create({
        data: { ...clientData, createdById: user.userId } as never,
      });

      if (Array.isArray(contacts) && contacts.length > 0) {
        await tx.clientContact.createMany({
          data: contacts.map((contact) => ({
            ...(contact as object),
            clientId: created.id,
            createdById: user.userId,
          })) as never,
        });
      }

      await this.audit.record(
        {
          action: 'CREATE',
          entityType: 'Client',
          entityId: created.id,
          summary: `Added client ${created.name}`,
          userId: user.userId,
        },
        tx,
      );
      return created;
    });

    return this.findOne(client.id);
  }

  async update(id: string, input: Record<string, unknown>, user: AuthenticatedUser) {
    const before = await this.findOne(id);
    if (input.name && input.name !== before.name) {
      await this.assertNameFree(input.name as string, id);
    }

    const after = await this.prisma.scoped.client.update({
      where: { id },
      data: input as never,
    });

    await this.audit.recordChange({
      action: 'UPDATE',
      entityType: 'Client',
      entityId: id,
      summary: `Updated client ${after.name}`,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      fields: ['name', 'clientCode', 'industry', 'gstin', 'city', 'state', 'country', 'isActive'],
      userId: user.userId,
    });
    return this.findOne(id);
  }

  async addContact(clientId: string, input: Record<string, unknown>, user: AuthenticatedUser) {
    await this.findOne(clientId);

    // Only one primary contact per client.
    if (input.isPrimary) {
      await this.prisma.scoped.clientContact.updateMany({
        where: { clientId, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const contact = await this.prisma.scoped.clientContact.create({
      data: { ...input, clientId, createdById: user.userId } as never,
    });

    await this.audit.record({
      action: 'CREATE',
      entityType: 'ClientContact',
      entityId: contact.id,
      summary: `Added contact ${contact.name}`,
      userId: user.userId,
    });
    return contact;
  }

  async removeContact(contactId: string, user: AuthenticatedUser) {
    const contact = await this.prisma.scoped.clientContact.findFirst({
      where: { id: contactId, deletedAt: null },
    });
    if (!contact) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Contact not found.' });

    await this.prisma.scoped.clientContact.update({
      where: { id: contactId },
      data: { deletedAt: new Date() },
    });
    await this.audit.record({
      action: 'DELETE',
      entityType: 'ClientContact',
      entityId: contactId,
      summary: `Removed contact ${contact.name}`,
      userId: user.userId,
    });
  }

  async remove(id: string, user: AuthenticatedUser) {
    const client = await this.findOne(id);

    // Bookings and projects reference the client by name in every report.
    if (client._count.bookings > 0 || client._count.projects > 0) {
      throw new ConflictException({
        code: 'IN_USE',
        message: `${client.name} has ${client._count.bookings} bookings and ${client._count.projects} projects. Deactivate them instead.`,
      });
    }

    await this.prisma.scoped.client.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.audit.record({
      action: 'DELETE',
      entityType: 'Client',
      entityId: id,
      summary: `Deleted client ${client.name}`,
      userId: user.userId,
    });
  }

  private async assertNameFree(name: string, excludeId?: string) {
    const clash = await this.prisma.scoped.client.findFirst({
      where: { name, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    if (clash) {
      throw new ConflictException({
        code: 'DUPLICATE',
        message: `A client called "${name}" already exists.`,
        details: { field: 'name' },
      });
    }
  }
}
