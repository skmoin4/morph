import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { runInTenantContext, runUnscoped } from '../../prisma/tenant-context';
import { AttendanceService } from './attendance.service';

export const ATTENDANCE_QUEUE = 'attendance';
const SETTLE_JOB = 'settle-recent-days';
const EVERY_MINUTES = 30;

/**
 * Registers the repeating "settle recent days" job.
 *
 * A failure to reach Redis is logged and survived: attendance reads never
 * depend on this job having run (a day is judged from its punches when nobody
 * has settled it yet), so a missing scheduler costs freshness of the stored
 * records, not correctness of what people see.
 */
@Injectable()
export class AttendanceJobs implements OnModuleInit {
  private readonly logger = new Logger(AttendanceJobs.name);

  constructor(@InjectQueue(ATTENDANCE_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    this.queue.on('error', (error) => this.logger.warn(`Attendance queue: ${error.message}`));
    try {
      await this.queue.add(
        SETTLE_JOB,
        {},
        {
          repeat: { every: EVERY_MINUTES * 60_000 },
          jobId: SETTLE_JOB,
          removeOnComplete: 20,
          removeOnFail: 50,
        },
      );
    } catch (error) {
      this.logger.warn(`Could not schedule attendance settling: ${(error as Error).message}`);
    }
  }
}

/** Settles recent days for every company. Idempotent, so overlap or a retry is harmless. */
@Processor(ATTENDANCE_QUEUE)
export class AttendanceProcessor extends WorkerHost {
  private readonly logger = new Logger(AttendanceProcessor.name);

  constructor(
    private readonly attendance: AttendanceService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job): Promise<number> {
    if (job.name !== SETTLE_JOB) return 0;

    const companies = await runUnscoped(() =>
      this.prisma.company.findMany({ select: { id: true } }),
    );

    let total = 0;
    for (const company of companies) {
      // Each company is processed in its own tenant scope, so one company's
      // failure cannot touch another's rows — or the rest of the run.
      try {
        total += await runInTenantContext(
          { companyId: company.id, userId: 'system:attendance-job', employeeId: null },
          () => this.attendance.settleRecentDays(),
        );
      } catch (error) {
        this.logger.error(`Settling company ${company.id} failed: ${(error as Error).message}`);
      }
    }
    return total;
  }

  @OnWorkerEvent('error')
  onError(error: Error) {
    this.logger.warn(`Attendance worker: ${error.message}`);
  }
}
