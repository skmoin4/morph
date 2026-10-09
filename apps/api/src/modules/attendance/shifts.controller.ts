import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  rosterQuerySchema,
  shiftAssignmentSchema,
  shiftSchema,
  type RosterQuery,
  type ShiftAssignmentInput,
  type ShiftInput,
} from '@opsvera/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ShiftsService } from './shifts.service';

@ApiTags('shifts')
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get()
  @RequirePermissions('shift.view')
  list() {
    return this.shifts.list();
  }

  // Declared before `:id` so these words are not read as shift ids.
  @Get('roster')
  @RequirePermissions('shift.view')
  @ApiOperation({ summary: 'Weekly roster: who works which shift on which day' })
  roster(
    @Query(new ZodValidationPipe(rosterQuerySchema)) query: RosterQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shifts.roster(query, user);
  }

  @Get('lookups')
  @RequirePermissions('shift.create')
  @ApiOperation({ summary: 'People and departments an assignment can be made to' })
  lookups() {
    return this.shifts.lookups();
  }

  @Post()
  @RequirePermissions('shift.create')
  create(
    @Body(new ZodValidationPipe(shiftSchema)) body: ShiftInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shifts.create(body, user);
  }

  @Put(':id')
  @RequirePermissions('shift.edit')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(shiftSchema)) body: ShiftInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shifts.update(id, body, user);
  }

  @Delete(':id')
  @RequirePermissions('shift.delete')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.shifts.remove(id, user);
  }

  @Get(':id/assignments')
  @RequirePermissions('shift.view')
  listAssignments(@Param('id') id: string) {
    return this.shifts.listAssignments(id);
  }

  @Post(':id/assignments')
  @RequirePermissions('shift.create')
  @ApiOperation({
    summary: 'Put a person or a department on this shift from a date',
    description:
      'Ends the assignment that was running the day the new one starts. A temporary change ' +
      '(with an end date) hands back to the previous shift afterwards.',
  })
  assign(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(shiftAssignmentSchema)) body: ShiftAssignmentInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shifts.assign(id, body, user);
  }

  @Delete('assignments/:assignmentId')
  @RequirePermissions('shift.delete')
  @HttpCode(204)
  removeAssignment(
    @Param('assignmentId') assignmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.shifts.removeAssignment(assignmentId, user);
  }
}
