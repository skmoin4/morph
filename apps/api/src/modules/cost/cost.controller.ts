import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  costAdjustmentSchema,
  costOverviewQuerySchema,
  ledgerQuerySchema,
  reverseEntrySchema,
  type CostAdjustmentInput,
  type CostOverviewQuery,
  type LedgerQuery,
  type ReverseEntryInput,
} from '@opsvera/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CostService } from './cost.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@ApiTags('cost')
@Controller('cost')
export class CostController {
  constructor(private readonly cost: CostService) {}

  @Get('overview')
  @RequirePermissions('cost.view')
  @ApiOperation({ summary: 'Budget vs actual for every project the caller may see' })
  overview(
    @Query(new ZodValidationPipe(costOverviewQuerySchema)) query: CostOverviewQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cost.overview(query, user);
  }

  @Get('export')
  @RequirePermissions('cost.export')
  @ApiOperation({ summary: 'The overview as an Excel workbook' })
  async exportOverview(
    @Query(new ZodValidationPipe(costOverviewQuerySchema)) query: CostOverviewQuery,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { buffer, fileName } = await this.cost.exportOverview(query, user);
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  @Get('projects/:id/summary')
  @RequirePermissions('cost.view')
  @ApiOperation({ summary: 'Budget vs actual, the burn curve, and whether the totals reconcile' })
  summary(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.cost.summary(id, user);
  }

  @Get('projects/:id/ledger')
  @RequirePermissions('cost.view')
  @ApiOperation({ summary: 'Every posting to the project, with the rate that explains it' })
  ledger(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(ledgerQuerySchema)) query: LedgerQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cost.ledger(id, query, user);
  }

  @Get('projects/:id/export')
  @RequirePermissions('cost.export')
  async exportLedger(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { buffer, fileName } = await this.cost.exportLedger(id, user);
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  @Post('projects/:id/adjustments')
  @RequirePermissions('cost.edit')
  @ApiOperation({ summary: 'Post a manual cost adjustment (a ledger row; never an edit)' })
  adjust(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(costAdjustmentSchema)) body: CostAdjustmentInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cost.addAdjustment(id, body, user);
  }

  @Post('entries/:id/reverse')
  @RequirePermissions('cost.edit')
  @ApiOperation({ summary: 'Reverse a manual adjustment' })
  reverse(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reverseEntrySchema)) body: ReverseEntryInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cost.reverseEntry(id, body, user);
  }
}
