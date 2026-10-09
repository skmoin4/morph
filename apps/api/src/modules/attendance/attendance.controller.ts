import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  boardQuerySchema,
  dateOnlySchema,
  employeeAttendanceQuerySchema,
  mobilePunchSchema,
  officePunchSchema,
  regularisationDecisionSchema,
  regularisationListQuerySchema,
  regularisationSchema,
  registerQuerySchema,
  SELFIE_MAX_BYTES,
  type BoardQuery,
  type EmployeeAttendanceQuery,
  type MobilePunchInput,
  type OfficePunchInput,
  type RegisterQuery,
  type RegularisationDecisionInput,
  type RegularisationInput,
  type RegularisationListQuery,
} from '@opsvera/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AttendanceExportService } from './attendance-export.service';
import { AttendanceService } from './attendance.service';
import { RegularisationService } from './regularisation.service';

@ApiTags('attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly regularisations: RegularisationService,
    private readonly exporter: AttendanceExportService,
  ) {}

  // --- My day & punching ---------------------------------------------------

  @Get('me/today')
  @RequirePermissions('attendance.view')
  @ApiOperation({
    summary: 'The clock-in card: today’s punches, what is next, and what is allowed',
  })
  meToday(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.attendance.meToday(user, req.ip);
  }

  @Post('punch/mobile')
  @RequirePermissions('attendance.create')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Clock in or out from a phone',
    description:
      'GPS position + a selfie. Judged against the office’s geofence; server time is used.',
  })
  @UseInterceptors(FileInterceptor('selfie', { limits: { fileSize: SELFIE_MAX_BYTES } }))
  punchMobile(
    @Body(new ZodValidationPipe(mobilePunchSchema)) body: MobilePunchInput,
    @UploadedFile() selfie: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attendance.punchMobile(
      body,
      selfie && {
        originalName: selfie.originalname,
        mimeType: selfie.mimetype,
        size: selfie.size,
        buffer: selfie.buffer,
      },
      user,
    );
  }

  @Post('punch/office')
  @RequirePermissions('attendance.create')
  @ApiOperation({
    summary: 'Clock in or out from the office network',
    description: 'Allowed only from an address on the employee’s office allow-list.',
  })
  punchOffice(
    @Body(new ZodValidationPipe(officePunchSchema)) body: OfficePunchInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.attendance.punchOffice(body, user, req.ip);
  }

  // --- Reading -------------------------------------------------------------

  @Get('lookups')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Offices and departments for the filters' })
  lookups() {
    return this.attendance.lookups();
  }

  @Get('board')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Live attendance board for a day' })
  board(
    @Query(new ZodValidationPipe(boardQuerySchema)) query: BoardQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attendance.board(query, user);
  }

  @Get('register')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'Monthly register: a grid of days per employee' })
  register(
    @Query(new ZodValidationPipe(registerQuerySchema)) query: RegisterQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attendance.register(query, user);
  }

  @Get('export')
  @RequirePermissions('attendance.export')
  @ApiOperation({ summary: 'The monthly register as an Excel workbook' })
  async export(
    @Query(new ZodValidationPipe(registerQuerySchema)) query: RegisterQuery,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { buffer, fileName } = await this.exporter.build(query, user);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  @Get('employees/:id')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'One person’s days over a range' })
  employeeRange(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(employeeAttendanceQuerySchema)) query: EmployeeAttendanceQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attendance.employeeRange(id, query.from, query.to, user);
  }

  @Get('employees/:id/days/:date')
  @RequirePermissions('attendance.view')
  @ApiOperation({ summary: 'One day in full: punches, evidence and how it was judged' })
  dayDetail(
    @Param('id') id: string,
    @Param('date', new ZodValidationPipe(dateOnlySchema)) date: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.attendance.dayDetail(id, date, user);
  }

  @Get('punches/:id/selfie')
  @RequirePermissions('attendance.view')
  async selfie(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { document, stream } = await this.attendance.openSelfie(id, user);
    // Images are shown inline in the app; the headers stop them being sniffed
    // into anything else, and the response is not shareable between users.
    res.setHeader('Content-Type', document.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline');
    stream.pipe(res);
  }

  // --- Regularisation ------------------------------------------------------

  @Get('regularisations')
  @RequirePermissions('attendance.view')
  listRegularisations(
    @Query(new ZodValidationPipe(regularisationListQuerySchema)) query: RegularisationListQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.regularisations.list(query, user);
  }

  @Post('regularisations')
  @RequirePermissions('attendance.regularise')
  @ApiOperation({ summary: 'Ask for a day’s clock-in or clock-out to be corrected' })
  createRegularisation(
    @Body(new ZodValidationPipe(regularisationSchema)) body: RegularisationInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.regularisations.create(body, user);
  }

  @Post('regularisations/:id/cancel')
  @RequirePermissions('attendance.regularise')
  cancelRegularisation(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.regularisations.cancel(id, user);
  }

  @Post('regularisations/:id/decision')
  @RequirePermissions('attendance.approve')
  @ApiOperation({ summary: 'Approve or reject a correction' })
  decideRegularisation(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(regularisationDecisionSchema)) body: RegularisationDecisionInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.regularisations.decide(id, body, user);
  }
}
