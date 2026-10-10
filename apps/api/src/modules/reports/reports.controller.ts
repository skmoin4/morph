import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { reportQuerySchema, type ReportQuery } from '@opsvera/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ReportsService } from './reports.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @RequirePermissions('report.view')
  @ApiOperation({ summary: 'The reports this person may run, and the filters each takes' })
  catalog(@CurrentUser() user: AuthenticatedUser) {
    return this.reports.catalog(user);
  }

  @Get(':key')
  @RequirePermissions('report.view')
  @ApiOperation({ summary: 'Run a report and return its rows' })
  run(
    @Param('key') key: string,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reports.run(key, query, user);
  }

  @Get(':key/export')
  @RequirePermissions('report.export')
  @ApiOperation({ summary: 'The same report as an Excel workbook' })
  async export(
    @Param('key') key: string,
    @Query(new ZodValidationPipe(reportQuerySchema)) query: ReportQuery,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { buffer, fileName } = await this.reports.export(key, query, user);
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }
}
