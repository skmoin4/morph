import {
  BadRequestException,
  Controller,
  Get,
  Param,
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
  CONFIRMATION_MAX_BYTES,
  describeConfirmationFileRules,
  validateConfirmationFile,
} from '@opsvera/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { FilesService } from './files.service';

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('confirmations')
  @RequirePermissions('booking.create')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: `Upload a booking confirmation — ${describeConfirmationFileRules()}` })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: CONFIRMATION_MAX_BYTES } }))
  async uploadConfirmation(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('category') category: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: `Attach a file. ${describeConfirmationFileRules()}.`,
      });
    }

    // The same check the browser ran, repeated here because the browser's is a
    // convenience and this one is the rule.
    const verdict = validateConfirmationFile({
      name: file.originalname,
      size: file.size,
      type: file.mimetype,
    });
    if (!verdict.ok) {
      throw new BadRequestException({ code: 'UNSUPPORTED_FILE', message: verdict.message });
    }

    const document = await this.files.store(
      {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        buffer: file.buffer,
      },
      { ownerType: 'BOOKING', category: category ?? 'Client confirmation' },
      user,
    );

    return {
      id: document.id,
      fileName: document.fileName,
      sizeBytes: document.sizeBytes,
      mimeType: document.mimeType,
    };
  }

  @Get(':id')
  @RequirePermissions('booking.view')
  @ApiOperation({ summary: 'Download a stored file' })
  async download(@Param('id') id: string, @Res() res: Response) {
    const { document, stream } = await this.files.openForDownload(id);
    res.setHeader('Content-Type', document.mimeType);
    // `attachment` rather than inline: a stored file is untrusted content and
    // must not be rendered in the app's own origin.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(document.fileName)}"`,
    );
    stream.pipe(res);
  }
}
