import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  idSchema,
  leaveBalanceQuerySchema,
  leaveCalendarQuerySchema,
  leaveCancelSchema,
  leaveDecisionSchema,
  leaveListQuerySchema,
  leavePreviewSchema,
  leaveRequestSchema,
  type LeaveBalanceQuery,
  type LeaveCalendarQuery,
  type LeaveCancelInput,
  type LeaveDecisionInput,
  type LeaveListQuery,
  type LeavePreviewInput,
  type LeaveRequestInput,
} from '@opsvera/shared';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { LeaveService } from './leave.service';

const teamBalanceQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  officeId: idSchema.optional(),
  departmentId: idSchema.optional(),
  q: z.string().trim().max(100).optional(),
});

@ApiTags('leave')
@Controller('leave')
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  @Get('types')
  @RequirePermissions('leave.view')
  @ApiOperation({ summary: 'Active leave types, for the apply form' })
  types() {
    return this.leave.types();
  }

  @Get('balances')
  @RequirePermissions('leave.view')
  @ApiOperation({ summary: 'One person’s balances for a year (yours by default)' })
  balances(
    @Query(new ZodValidationPipe(leaveBalanceQuerySchema)) query: LeaveBalanceQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leave.balances(query, user);
  }

  @Get('balances/team')
  @RequirePermissions('leave.view')
  @ApiOperation({ summary: 'Balances for everyone in the caller’s scope' })
  teamBalances(
    @Query(new ZodValidationPipe(teamBalanceQuerySchema))
    query: z.infer<typeof teamBalanceQuerySchema>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leave.teamBalances(query, user);
  }

  @Get('calendar')
  @RequirePermissions('leave.view')
  @ApiOperation({ summary: 'Team leave calendar for a window, with holidays' })
  calendar(
    @Query(new ZodValidationPipe(leaveCalendarQuerySchema)) query: LeaveCalendarQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leave.calendar(query, user);
  }

  @Post('preview')
  @RequirePermissions('leave.create')
  @ApiOperation({ summary: 'What a leave would cost, before it is applied for' })
  preview(
    @Body(new ZodValidationPipe(leavePreviewSchema)) body: LeavePreviewInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leave.preview(body, user);
  }

  @Post('requests')
  @RequirePermissions('leave.create')
  @ApiOperation({ summary: 'Apply for leave' })
  apply(
    @Body(new ZodValidationPipe(leaveRequestSchema)) body: LeaveRequestInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leave.apply(body, user);
  }

  @Get('requests')
  @RequirePermissions('leave.view')
  @ApiOperation({ summary: 'Leave requests: yours, your team’s, and those waiting on you' })
  list(
    @Query(new ZodValidationPipe(leaveListQuerySchema)) query: LeaveListQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leave.list(query, user);
  }

  @Get('requests/:id')
  @RequirePermissions('leave.view')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.leave.get(id, user);
  }

  @Post('requests/:id/decision')
  @RequirePermissions('leave.approve')
  @ApiOperation({ summary: 'Approve or reject a waiting request' })
  decide(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(leaveDecisionSchema)) body: LeaveDecisionInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leave.decide(id, body, user);
  }

  @Post('requests/:id/cancel')
  @RequirePermissions('leave.view')
  @ApiOperation({ summary: 'Withdraw a request, or take back an approved leave' })
  cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(leaveCancelSchema)) body: LeaveCancelInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leave.cancel(id, body, user);
  }
}
