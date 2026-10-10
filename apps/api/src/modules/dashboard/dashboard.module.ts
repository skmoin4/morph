import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { LeaveModule } from '../leave/leave.module';
import { TimeModule } from '../time/time.module';
import { DashboardController } from './dashboard.controller';
import { ExecutiveService } from './executive.service';
import { ManagerService } from './manager.service';
import { MyDayService } from './my-day.service';
import { WorkloadService } from './workload.service';

@Module({
  imports: [AttendanceModule, LeaveModule, TimeModule, ExpensesModule],
  controllers: [DashboardController],
  providers: [WorkloadService, ExecutiveService, ManagerService, MyDayService],
  exports: [WorkloadService],
})
export class DashboardModule {}
