import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  moveTaskSchema,
  taskCommentSchema,
  taskListQuerySchema,
  TASK_ATTACHMENT_MAX_BYTES,
  updateTaskSchema,
  type MoveTaskInput,
  type TaskCommentInput,
  type TaskListQuery,
  type UpdateTaskInput,
} from '@opsvera/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { TasksService } from './tasks.service';

@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequirePermissions('task.view')
  @ApiOperation({ summary: 'Tasks on projects in the caller’s data scope' })
  list(
    @Query(new ZodValidationPipe(taskListQuerySchema)) query: TaskListQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasks.list(query, user);
  }

  @Get(':id')
  @RequirePermissions('task.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasks.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermissions('task.edit')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTaskSchema)) body: UpdateTaskInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasks.update(id, body, user);
  }

  @Post(':id/move')
  @RequirePermissions('task.edit')
  @ApiOperation({ summary: 'Kanban drop: change column and position' })
  move(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(moveTaskSchema)) body: MoveTaskInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasks.move(id, body, user);
  }

  @Delete(':id')
  @RequirePermissions('task.delete')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasks.remove(id, user);
  }

  // --- Comments ------------------------------------------------------------

  @Post(':id/comments')
  @RequirePermissions('task.view')
  addComment(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(taskCommentSchema)) body: TaskCommentInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasks.addComment(id, body, user);
  }

  // --- Attachments ---------------------------------------------------------

  @Post(':id/attachments')
  @RequirePermissions('task.edit')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: TASK_ATTACHMENT_MAX_BYTES } }))
  addAttachment(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Attach a file.' });
    }
    return this.tasks.addAttachment(
      id,
      {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        buffer: file.buffer,
      },
      user,
    );
  }

  @Delete(':id/attachments/:attachmentId')
  @RequirePermissions('task.edit')
  removeAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasks.removeAttachment(id, attachmentId, user);
  }

  @Get(':id/attachments/:attachmentId/download')
  @RequirePermissions('task.view')
  async download(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { document, stream } = await this.tasks.openAttachment(id, attachmentId, user);
    res.setHeader('Content-Type', document.mimeType);
    // Untrusted content: always a download, never rendered in the app's origin.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(document.fileName)}"`,
    );
    stream.pipe(res);
  }
}
