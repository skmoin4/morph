import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantExtension } from './tenant-extension';

/**
 * The application's database client.
 *
 * Every query made through it is scoped to the company in the current
 * AsyncLocalStorage tenant context. Infrastructure that genuinely spans
 * companies — the nightly attendance job, login before the company is known —
 * wraps its work in `runUnscoped()`.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /** The company-scoped client. All application code uses this. */
  readonly scoped: ReturnType<typeof buildScopedClient>;

  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['warn', 'error'],
    });
    this.scoped = buildScopedClient(this);
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

function buildScopedClient(client: PrismaClient) {
  return client.$extends(tenantExtension);
}

/** The scoped client's type, for injecting into services. */
export type ScopedPrisma = PrismaService['scoped'];

/**
 * The client handed to a `scoped.$transaction(async (tx) => ...)` callback.
 * Derived from the scoped client rather than written out, so it stays correct
 * as the schema and the extension change.
 */
export type ScopedTx = Parameters<Parameters<ScopedPrisma['$transaction']>[0]>[0];

/** Either client — what a service accepts when it may or may not be in a transaction. */
export type ScopedDb = ScopedPrisma | ScopedTx;
