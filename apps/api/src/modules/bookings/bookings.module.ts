import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { ProjectCodeService } from './project-code.service';

@Module({
  controllers: [BookingsController],
  providers: [BookingsService, ProjectCodeService],
  exports: [BookingsService, ProjectCodeService],
})
export class BookingsModule {}
