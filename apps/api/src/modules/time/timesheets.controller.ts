import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  bulkTimesheetDecisionSchema,
  reopenTimesheetSchema,
  submitWeekSchema,
  timesheetDecisionSchema,
  timesheetListQuerySchema,
  weekQuerySchema,
  type BulkTimesheetDecisionInput,
  type ReopenTimesheetInput,
  type SubmitWeekInput,
  type TimesheetDecisionInput,
  type TimesheetListQuery,
  type WeekQuery,
} from '@opsvera/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { TimeService } from './time.service';
import { TimesheetsService } from './timesheets.service';

@ApiTags('timesheets')
@Controller('timesheets')
export class TimesheetsController {
  constructor(
    private readonly timesheets: TimesheetsService,
    private readonly time: TimeService,
  ) {}

  @Get('week')
  @RequirePermissions('timesheet.view')
  @ApiOperation({ summary: 'The weekly grid for a person (yours by default)' })
  week(
    @Query(new ZodValidationPipe(weekQuerySchema)) query: WeekQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.time.week(query, user);
  }

  @Get()
  @RequirePermissions('timesheet.view')
  @ApiOperation({ summary: 'Timesheets: yours, your team’s, and those waiting on you' })
  list(
    @Query(new ZodValidationPipe(timesheetListQuerySchema)) query: TimesheetListQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.timesheets.list(query, user);
  }

  @Post('submit')
  @RequirePermissions('timesheet.create')
  submit(
    @Body(new ZodValidationPipe(submitWeekSchema)) body: SubmitWeekInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.timesheets.submit(body, user);
  }

  // Declared before `:id/...` so "bulk-decision" is not read as an id.
  @Post('bulk-decision')
  @RequirePermissions('timesheet.approve')
  @ApiOperation({ summary: 'Approve or reject several timesheets at once' })
  bulk(
    @Body(new ZodValidationPipe(bulkTimesheetDecisionSchema)) body: BulkTimesheetDecisionInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.timesheets.bulkDecide(body, user);
  }

  @Post(':id/recall')
  @RequirePermissions('timesheet.create')
  recall(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.timesheets.recall(id, user);
  }

  @Post(':id/decision')
  @RequirePermissions('timesheet.approve')
  @ApiOperation({ summary: 'Approve (posts labour cost) or reject a submitted timesheet' })
  decide(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(timesheetDecisionSchema)) body: TimesheetDecisionInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.timesheets.decide(id, body, user);
  }

  @Post(':id/reopen')
  @RequirePermissions('timesheet.reopen')
  @ApiOperation({ summary: 'Reopen an approved timesheet; reverses its cost posting' })
  reopen(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reopenTimesheetSchema)) body: ReopenTimesheetInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.timesheets.reopen(id, body, user);
  }
}
