import { BullModule } from '@nestjs/bullmq';
import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AttendanceContextLoader } from './attendance-context';
import { AttendanceController } from './attendance.controller';
import { AttendanceExportService } from './attendance-export.service';
import { AttendanceJobs, AttendanceProcessor, ATTENDANCE_QUEUE } from './attendance.processor';
import { AttendanceService } from './attendance.service';
import { RegularisationService } from './regularisation.service';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

const jobsEnabled = process.env.JOBS_ENABLED !== 'false';

/** Redis-backed queue wiring, left out entirely when jobs are switched off. */
const queueImports: DynamicModule[] = jobsEnabled
  ? [
      BullModule.forRootAsync({
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          connection: {
            host: config.get<string>('REDIS_HOST') ?? '127.0.0.1',
            port: config.get<number>('REDIS_PORT') ?? 6379,
            password: config.get<string>('REDIS_PASSWORD') || undefined,
            db: config.get<number>('REDIS_DB') ?? 0,
            // Do not hang a request, or the boot, waiting on Redis.
            maxRetriesPerRequest: null,
          },
        }),
      }),
      BullModule.registerQueue({ name: ATTENDANCE_QUEUE }),
    ]
  : [];

@Module({
  imports: queueImports,
  controllers: [AttendanceController, ShiftsController],
  providers: [
    AttendanceContextLoader,
    AttendanceService,
    AttendanceExportService,
    RegularisationService,
    ShiftsService,
    ...(jobsEnabled ? [AttendanceJobs, AttendanceProcessor] : []),
  ],
  exports: [AttendanceService, AttendanceContextLoader, RegularisationService],
})
export class AttendanceModule {}
