import {
  BadRequestException,
  Body,
  Controller,
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
import { z } from 'zod';
import {
  costRateSchema,
  createEmployeeSchema,
  employeeListQuerySchema,
  EmployeeStatus,
  salarySchema,
  updateEmployeeSchema,
  type CostRateInput,
  type CreateEmployeeInput,
  type EmployeeListQuery,
  type SalaryInput,
  type UpdateEmployeeInput,
} from '@opsvera/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { EmployeesService } from './employees.service';
import { EmployeeImportService } from './employee-import.service';

const setStatusSchema = z.object({ status: z.nativeEnum(EmployeeStatus) });
const importBodySchema = z.object({
  dryRun: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .default(true),
});

/** 5 MB is far more than a staff sheet needs, and keeps a bad upload cheap. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

@ApiTags('employees')
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly importer: EmployeeImportService,
  ) {}

  @Get()
  @RequirePermissions('employee.view')
  @ApiOperation({ summary: 'List employees within your data scope' })
  list(
    @Query(new ZodValidationPipe(employeeListQuerySchema)) query: EmployeeListQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.employees.list(query, user);
  }

  // Declared before ':id' so the literal path is not swallowed by the param.
  @Get('import/template')
  @RequirePermissions('employee.create')
  @ApiOperation({ summary: 'Download the Excel import template' })
  async downloadTemplate(@Res() res: Response) {
    const buffer = await this.importer.buildTemplate();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="opsvera-employee-import.xlsx"');
    res.send(buffer);
  }

  @Post('import')
  @RequirePermissions('employee.create')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Validate (and optionally commit) an employee spreadsheet',
    description:
      'With dryRun=true nothing is written and a row-level error report is returned. ' +
      'With dryRun=false the whole sheet is imported in one transaction, or not at all.',
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async importEmployees(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(importBodySchema)) body: { dryRun: boolean },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'Attach an .xlsx file to import.',
      });
    }
    if (!file.originalname.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_FILE',
        message: 'Only .xlsx files are supported. Export your sheet as Excel and try again.',
      });
    }

    let rows;
    try {
      rows = await this.importer.parse(file.buffer);
    } catch {
      throw new BadRequestException({
        code: 'UNREADABLE_FILE',
        message: 'That file could not be read as a spreadsheet.',
      });
    }

    if (rows.length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_SHEET',
        message: 'No data rows found. Use the template and keep the header row.',
      });
    }

    return this.importer.import({ rows, dryRun: body.dryRun }, user);
  }

  @Get(':id')
  @RequirePermissions('employee.view')
  @ApiOperation({ summary: 'Employee 360: profile, projects, leave, attendance and hours' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.employees.findOne(id, user);
  }

  @Post()
  @RequirePermissions('employee.create')
  @ApiOperation({ summary: 'Add an employee' })
  create(
    @Body(new ZodValidationPipe(createEmployeeSchema)) body: CreateEmployeeInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.employees.create(body, user);
  }

  @Patch(':id')
  @RequirePermissions('employee.edit')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateEmployeeSchema)) body: UpdateEmployeeInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.employees.update(id, body, user);
  }

  @Patch(':id/status')
  @RequirePermissions('employee.edit')
  @ApiOperation({ summary: 'Activate or deactivate; exiting also suspends the login' })
  setStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(setStatusSchema)) body: { status: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.employees.setStatus(id, body.status, user);
  }

  @Post(':id/invite')
  @RequirePermissions('employee.edit')
  @HttpCode(202)
  @ApiOperation({ summary: 'Create the login if needed and email an invitation' })
  invite(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.employees.inviteEmployee(id, user);
  }

  // --- Cost rates (gated by cost.view / cost.edit, not employee.*) ---------

  @Get(':id/cost-rates')
  @RequirePermissions('cost.view')
  @ApiOperation({ summary: 'Cost rate history, newest first' })
  listCostRates(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.employees.listCostRates(id, user);
  }

  @Post(':id/cost-rates')
  @RequirePermissions('cost.edit')
  @ApiOperation({
    summary: 'Add a cost rate effective from a date',
    description:
      'Rates are never edited in place: costing uses the rate effective on the work date, ' +
      'so a new row is added and the previous one is closed off.',
  })
  addCostRate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(costRateSchema)) body: CostRateInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.employees.addCostRate(id, body, user);
  }

  @Get(':id/salaries')
  @RequirePermissions('salary.view')
  listSalaries(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.employees.listSalaries(id, user);
  }

  @Post(':id/salaries')
  @RequirePermissions('salary.edit')
  addSalary(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(salarySchema)) body: SalaryInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.employees.addSalary(id, body, user);
  }
}
