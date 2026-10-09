import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  addProjectMemberSchema,
  changeProjectStatusSchema,
  createTaskSchema,
  milestoneSchema,
  projectListQuerySchema,
  updateMilestoneSchema,
  updateProjectMemberSchema,
  updateProjectSchema,
  type AddProjectMemberInput,
  type ChangeProjectStatusInput,
  type CreateTaskInput,
  type MilestoneInput,
  type ProjectListQuery,
  type UpdateMilestoneInput,
  type UpdateProjectInput,
  type UpdateProjectMemberInput,
} from '@opsvera/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ProjectsService } from './projects.service';
import { TasksService } from './tasks.service';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly tasks: TasksService,
  ) {}

  @Get()
  @RequirePermissions('project.view')
  @ApiOperation({ summary: 'Projects in the caller’s data scope' })
  list(
    @Query(new ZodValidationPipe(projectListQuerySchema)) query: ProjectListQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projects.list(query, user);
  }

  // Declared before `:id` so these words are not read as project ids.
  @Get('summary')
  @RequirePermissions('project.view')
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.projects.summary(user);
  }

  @Get('lookups')
  @RequirePermissions('project.edit')
  @ApiOperation({ summary: 'People who can be added to a project team' })
  lookups() {
    return this.projects.lookups();
  }

  @Get(':id')
  @RequirePermissions('project.view')
  @ApiOperation({ summary: 'Project 360: header, booking, team, milestones and task counts' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.projects.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermissions('project.edit')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) body: UpdateProjectInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projects.update(id, body, user);
  }

  @Post(':id/status')
  @RequirePermissions('project.edit')
  @ApiOperation({ summary: 'Put on hold, complete, cancel or reopen a project' })
  changeStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(changeProjectStatusSchema)) body: ChangeProjectStatusInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projects.changeStatus(id, body, user);
  }

  // --- Team ----------------------------------------------------------------

  @Post(':id/members')
  @RequirePermissions('project.edit')
  addMember(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addProjectMemberSchema)) body: AddProjectMemberInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projects.addMember(id, body, user);
  }

  @Patch(':id/members/:memberId')
  @RequirePermissions('project.edit')
  updateMember(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body(new ZodValidationPipe(updateProjectMemberSchema)) body: UpdateProjectMemberInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projects.updateMember(id, memberId, body, user);
  }

  @Delete(':id/members/:memberId')
  @RequirePermissions('project.edit')
  @ApiOperation({ summary: 'Take someone off the team (their history stays)' })
  removeMember(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projects.removeMember(id, memberId, user);
  }

  // --- Milestones ----------------------------------------------------------

  @Post(':id/milestones')
  @RequirePermissions('project.edit')
  createMilestone(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(milestoneSchema)) body: MilestoneInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projects.createMilestone(id, body, user);
  }

  @Patch(':id/milestones/:milestoneId')
  @RequirePermissions('project.edit')
  updateMilestone(
    @Param('id') id: string,
    @Param('milestoneId') milestoneId: string,
    @Body(new ZodValidationPipe(updateMilestoneSchema)) body: UpdateMilestoneInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projects.updateMilestone(id, milestoneId, body, user);
  }

  @Delete(':id/milestones/:milestoneId')
  @RequirePermissions('project.edit')
  @HttpCode(204)
  deleteMilestone(
    @Param('id') id: string,
    @Param('milestoneId') milestoneId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projects.deleteMilestone(id, milestoneId, user);
  }

  // --- Tasks (creation hangs off the project) ------------------------------

  @Post(':id/tasks')
  @RequirePermissions('task.create')
  createTask(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createTaskSchema)) body: CreateTaskInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasks.create(id, body, user);
  }
}
