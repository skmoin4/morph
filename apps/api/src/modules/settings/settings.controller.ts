import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  attendancePolicySchema,
  createOfficeSchema,
  departmentSchema,
  designationSchema,
  expenseCategorySchema,
  holidayListQuerySchema,
  holidaySchema,
  leaveTypeSchema,
  projectTypeSchema,
  settingsListQuerySchema,
  updateCompanySchema,
  updateOfficeSchema,
  type AttendancePolicyInput,
  type DepartmentInput,
  type DesignationInput,
  type ExpenseCategoryInput,
  type HolidayInput,
  type HolidayListQuery,
  type LeaveTypeInput,
  type ProjectTypeInput,
  type SettingsListQuery,
  type UpdateCompanyInput,
} from '@opsvera/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  // --- Company -------------------------------------------------------------

  @Get('company')
  @RequirePermissions('settings.view')
  @ApiOperation({ summary: 'Company profile, financial year and project code pattern' })
  getCompany(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.getCompany(user);
  }

  @Put('company')
  @RequirePermissions('settings.edit')
  @ApiOperation({ summary: 'Update the company profile' })
  updateCompany(
    @Body(new ZodValidationPipe(updateCompanySchema)) body: UpdateCompanyInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.updateCompany(body, user);
  }

  // --- Offices -------------------------------------------------------------

  @Get('offices')
  @RequirePermissions('settings.view')
  @ApiOperation({ summary: 'List offices and job sites' })
  listOffices(@Query(new ZodValidationPipe(settingsListQuerySchema)) query: SettingsListQuery) {
    return this.settings.listOffices(query);
  }

  @Get('offices/:id')
  @RequirePermissions('settings.view')
  getOffice(@Param('id') id: string) {
    return this.settings.getOffice(id);
  }

  @Post('offices')
  @RequirePermissions('settings.create')
  @ApiOperation({ summary: 'Add an office or job site' })
  createOffice(
    @Body(new ZodValidationPipe(createOfficeSchema)) body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.createOffice(body as Record<string, unknown>, user);
  }

  @Patch('offices/:id')
  @RequirePermissions('settings.edit')
  updateOffice(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateOfficeSchema)) body: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.updateOffice(id, body as Record<string, unknown>, user);
  }

  @Delete('offices/:id')
  @RequirePermissions('settings.delete')
  @HttpCode(204)
  deleteOffice(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.deleteOffice(id, user);
  }

  // --- Departments ---------------------------------------------------------

  @Get('departments')
  @RequirePermissions('settings.view')
  listDepartments(@Query(new ZodValidationPipe(settingsListQuerySchema)) query: SettingsListQuery) {
    return this.settings.listDepartments(query);
  }

  @Post('departments')
  @RequirePermissions('settings.create')
  createDepartment(
    @Body(new ZodValidationPipe(departmentSchema)) body: DepartmentInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.createDepartment(body, user);
  }

  @Patch('departments/:id')
  @RequirePermissions('settings.edit')
  updateDepartment(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(departmentSchema.partial())) body: Partial<DepartmentInput>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.updateDepartment(id, body, user);
  }

  @Delete('departments/:id')
  @RequirePermissions('settings.delete')
  @HttpCode(204)
  deleteDepartment(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.deleteDepartment(id, user);
  }

  // --- Designations --------------------------------------------------------

  @Get('designations')
  @RequirePermissions('settings.view')
  listDesignations(
    @Query(new ZodValidationPipe(settingsListQuerySchema)) query: SettingsListQuery,
  ) {
    return this.settings.listDesignations(query);
  }

  @Post('designations')
  @RequirePermissions('settings.create')
  createDesignation(
    @Body(new ZodValidationPipe(designationSchema)) body: DesignationInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.createDesignation(body, user);
  }

  @Patch('designations/:id')
  @RequirePermissions('settings.edit')
  updateDesignation(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(designationSchema.partial())) body: Partial<DesignationInput>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.updateDesignation(id, body, user);
  }

  @Delete('designations/:id')
  @RequirePermissions('settings.delete')
  @HttpCode(204)
  deleteDesignation(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.deleteDesignation(id, user);
  }

  // --- Project types -------------------------------------------------------

  @Get('project-types')
  @RequirePermissions('settings.view')
  @ApiOperation({ summary: 'Project types and the short codes used in project codes' })
  listProjectTypes(
    @Query(new ZodValidationPipe(settingsListQuerySchema)) query: SettingsListQuery,
  ) {
    return this.settings.listProjectTypes(query);
  }

  @Post('project-types')
  @RequirePermissions('settings.create')
  createProjectType(
    @Body(new ZodValidationPipe(projectTypeSchema)) body: ProjectTypeInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.createProjectType(body, user);
  }

  @Patch('project-types/:id')
  @RequirePermissions('settings.edit')
  updateProjectType(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(projectTypeSchema.partial())) body: Partial<ProjectTypeInput>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.updateProjectType(id, body, user);
  }

  @Delete('project-types/:id')
  @RequirePermissions('settings.delete')
  @HttpCode(204)
  deleteProjectType(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.deleteProjectType(id, user);
  }

  // --- Holidays ------------------------------------------------------------

  @Get('holidays')
  @RequirePermissions('settings.view')
  @ApiOperation({ summary: 'Holiday calendar, per office' })
  listHolidays(@Query(new ZodValidationPipe(holidayListQuerySchema)) query: HolidayListQuery) {
    return this.settings.listHolidays(query);
  }

  @Post('holidays')
  @RequirePermissions('settings.create')
  @ApiOperation({ summary: 'Add a holiday to one or more offices' })
  createHoliday(
    @Body(new ZodValidationPipe(holidaySchema)) body: HolidayInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.createHoliday(body, user);
  }

  @Delete('holidays/:id')
  @RequirePermissions('settings.delete')
  @HttpCode(204)
  deleteHoliday(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.deleteHoliday(id, user);
  }

  // --- Attendance policies -------------------------------------------------

  @Get('attendance-policies')
  @RequirePermissions('settings.view')
  @ApiOperation({ summary: 'Grace, half-day, full-day and overtime thresholds' })
  listAttendancePolicies() {
    return this.settings.listAttendancePolicies();
  }

  @Post('attendance-policies')
  @RequirePermissions('settings.create')
  createAttendancePolicy(
    @Body(new ZodValidationPipe(attendancePolicySchema)) body: AttendancePolicyInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.createAttendancePolicy(body, user);
  }

  @Put('attendance-policies/:id')
  @RequirePermissions('settings.edit')
  updateAttendancePolicy(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(attendancePolicySchema)) body: AttendancePolicyInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.updateAttendancePolicy(id, body, user);
  }

  @Delete('attendance-policies/:id')
  @RequirePermissions('settings.delete')
  @HttpCode(204)
  deleteAttendancePolicy(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.deleteAttendancePolicy(id, user);
  }

  // --- Leave types ---------------------------------------------------------

  @Get('leave-types')
  @RequirePermissions('settings.view')
  listLeaveTypes(@Query(new ZodValidationPipe(settingsListQuerySchema)) query: SettingsListQuery) {
    return this.settings.listLeaveTypes(query);
  }

  @Post('leave-types')
  @RequirePermissions('settings.create')
  createLeaveType(
    @Body(new ZodValidationPipe(leaveTypeSchema)) body: LeaveTypeInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.createLeaveType(body, user);
  }

  @Put('leave-types/:id')
  @RequirePermissions('settings.edit')
  updateLeaveType(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(leaveTypeSchema)) body: LeaveTypeInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.updateLeaveType(id, body, user);
  }

  @Delete('leave-types/:id')
  @RequirePermissions('settings.delete')
  @HttpCode(204)
  deleteLeaveType(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.deleteLeaveType(id, user);
  }

  // --- Expense categories --------------------------------------------------

  @Get('expense-categories')
  @RequirePermissions('settings.view')
  listExpenseCategories(
    @Query(new ZodValidationPipe(settingsListQuerySchema)) query: SettingsListQuery,
  ) {
    return this.settings.listExpenseCategories(query);
  }

  @Post('expense-categories')
  @RequirePermissions('settings.create')
  createExpenseCategory(
    @Body(new ZodValidationPipe(expenseCategorySchema)) body: ExpenseCategoryInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.createExpenseCategory(body, user);
  }

  @Patch('expense-categories/:id')
  @RequirePermissions('settings.edit')
  updateExpenseCategory(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(expenseCategorySchema.partial()))
    body: Partial<ExpenseCategoryInput>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settings.updateExpenseCategory(id, body, user);
  }

  @Delete('expense-categories/:id')
  @RequirePermissions('settings.delete')
  @HttpCode(204)
  deleteExpenseCategory(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.settings.deleteExpenseCategory(id, user);
  }
}
