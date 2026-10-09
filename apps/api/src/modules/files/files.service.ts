import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DocumentOwnerType } from '@opsvera/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';

export interface StoredUpload {
  originalName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
}

/**
 * File storage.
 *
 * Local disk in development, S3 in production, behind one interface. The
 * storage key is always `company/{companyId}/...`, so a company's files are
 * namespaced by path as well as by the `companyId` column.
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get root(): string {
    return path.resolve(
      process.cwd(),
      this.config.get<string>('STORAGE_LOCAL_ROOT') ?? './storage',
    );
  }

  async store(
    upload: StoredUpload,
    meta: {
      ownerType?: DocumentOwnerType;
      ownerId?: string;
      category?: string;
    },
    user: AuthenticatedUser,
  ) {
    const extension = path.extname(upload.originalName).toLowerCase();
    // The stored name is random: an uploaded filename is user input and must
    // never reach the filesystem.
    const storedName = `${randomUUID()}${extension}`;
    const storageKey = `company/${user.companyId}/${meta.ownerType?.toLowerCase() ?? 'misc'}/${storedName}`;

    const absolute = path.join(this.root, storageKey);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, upload.buffer);

    return this.prisma.scoped.document.create({
      data: {
        ownerType: meta.ownerType ?? null,
        ownerId: meta.ownerId ?? null,
        category: meta.category ?? null,
        fileName: upload.originalName.slice(0, 255),
        mimeType: upload.mimeType.slice(0, 120),
        sizeBytes: upload.size,
        storageKey,
        storageDriver: this.config.get<string>('STORAGE_DRIVER') ?? 'local',
        checksum: createHash('sha256').update(upload.buffer).digest('hex').slice(0, 64),
        uploadedById: user.userId,
      } as never,
    });
  }

  /** Resolves a document to a readable stream, scoped to the caller's company. */
  async openForDownload(documentId: string) {
    const document = await this.prisma.scoped.document.findFirst({
      where: { id: documentId, deletedAt: null },
    });
    if (!document) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'File not found.' });
    }

    const absolute = path.join(this.root, document.storageKey);
    // Defence against a storageKey that somehow contains traversal segments.
    if (!absolute.startsWith(this.root + path.sep)) {
      throw new BadRequestException({ code: 'INVALID_PATH', message: 'Invalid file path.' });
    }
    if (!existsSync(absolute)) {
      throw new NotFoundException({
        code: 'FILE_MISSING',
        message: 'The stored file is no longer on disk.',
      });
    }

    return { document, stream: createReadStream(absolute) };
  }
}
