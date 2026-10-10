import { Module } from '@nestjs/common';
import { BudgetAlertService } from './budget-alert.service';
import { CostController } from './cost.controller';
import { CostService } from './cost.service';

@Module({
  controllers: [CostController],
  providers: [CostService, BudgetAlertService],
  exports: [CostService, BudgetAlertService],
})
export class CostModule {}
