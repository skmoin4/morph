import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { TimeController } from './time.controller';
import { TimeService } from './time.service';
import { TimesheetsController } from './timesheets.controller';
import { TimesheetsService } from './timesheets.service';

@Module({
  imports: [AttendanceModule],
  controllers: [TimeController, TimesheetsController],
  providers: [TimeService, TimesheetsService],
  exports: [TimeService, TimesheetsService],
})
export class TimeModule {}
