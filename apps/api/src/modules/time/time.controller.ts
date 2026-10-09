import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  idSchema,
  startTimerSchema,
  stopTimerSchema,
  timeCellSchema,
  timeEntriesQuerySchema,
  timeEntrySchema,
  updateTimeEntrySchema,
  type StartTimerInput,
  type StopTimerInput,
  type TimeCellInput,
  type TimeEntriesQuery,
  type TimeEntryInput,
  type UpdateTimeEntryInput,
} from '@opsvera/shared';
import { z } from 'zod';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { TimeService } from './time.service';

const projectQuerySchema = z.object({ projectId: idSchema });

@ApiTags('time')
@Controller('time')
export class TimeController {
  constructor(private readonly time: TimeService) {}

  // --- Lookups --------------------------------------------------------------

  @Get('lookups/projects')
  @RequirePermissions('timesheet.create')
  @ApiOperation({ summary: 'Projects the caller can log time against' })
  projects(@CurrentUser() user: AuthenticatedUser) {
    return this.time.projects(user);
  }

  @Get('lookups/tasks')
  @RequirePermissions('timesheet.create')
  @ApiOperation({ summary: 'Open tasks on a project, the caller’s own first' })
  tasks(
    @Query(new ZodValidationPipe(projectQuerySchema)) query: { projectId: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.time.tasksFor(query.projectId, user);
  }

  // --- The timer ------------------------------------------------------------

  @Get('timer')
  @RequirePermissions('timesheet.create')
  @ApiOperation({ summary: 'The running timer, if any — it survives a page reload' })
  timer(@CurrentUser() user: AuthenticatedUser) {
    return this.time.timer(user);
  }

  @Post('timer/start')
  @RequirePermissions('timesheet.create')
  start(
    @Body(new ZodValidationPipe(startTimerSchema)) body: StartTimerInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.time.startTimer(body, user);
  }

  @Post('timer/stop')
  @RequirePermissions('timesheet.create')
  stop(
    @Body(new ZodValidationPipe(stopTimerSchema)) body: StopTimerInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.time.stopTimer(body, user);
  }

  @Delete('timer')
  @RequirePermissions('timesheet.create')
  @ApiOperation({ summary: 'Throw the running timer away without recording it' })
  discard(@CurrentUser() user: AuthenticatedUser) {
    return this.time.discardTimer(user);
  }

  // --- Entries --------------------------------------------------------------

  @Get('entries')
  @RequirePermissions('timesheet.view')
  @ApiOperation({ summary: 'Time entries within the caller’s scope' })
  entries(
    @Query(new ZodValidationPipe(timeEntriesQuerySchema)) query: TimeEntriesQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.time.listEntries(query, user);
  }

  @Post('entries')
  @RequirePermissions('timesheet.create')
  @ApiOperation({ summary: 'Log time by hand' })
  create(
    @Body(new ZodValidationPipe(timeEntrySchema)) body: TimeEntryInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.time.createEntry(body, user);
  }

  @Patch('entries/:id')
  @RequirePermissions('timesheet.edit')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTimeEntrySchema)) body: UpdateTimeEntryInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.time.updateEntry(id, body, user);
  }

  @Delete('entries/:id')
  @RequirePermissions('timesheet.edit')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.time.deleteEntry(id, user);
  }

  @Put('cell')
  @RequirePermissions('timesheet.create')
  @ApiOperation({ summary: 'Set one cell of the weekly grid; 0 clears it' })
  cell(
    @Body(new ZodValidationPipe(timeCellSchema)) body: TimeCellInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.time.setCell(body, user);
  }

  @Get('projects/:projectId/summary')
  @RequirePermissions('timesheet.view')
  @ApiOperation({ summary: 'Hours on a project by person and task' })
  projectSummary(@Param('projectId') projectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.time.projectSummary(projectId, user);
  }
}
