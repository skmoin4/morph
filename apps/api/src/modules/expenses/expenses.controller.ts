import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
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
  bulkExpenseDecisionSchema,
  expenseDecisionSchema,
  expenseListQuerySchema,
  expenseSchema,
  RECEIPT_MAX_BYTES,
  reimburseSchema,
  reverseExpenseSchema,
  updateExpenseSchema,
  type BulkExpenseDecisionInput,
  type ExpenseDecisionInput,
  type ExpenseInput,
  type ExpenseListQuery,
  type ReimburseInput,
  type ReverseExpenseInput,
  type UpdateExpenseInput,
} from '@opsvera/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ExpensesService } from './expenses.service';

@ApiTags('expenses')
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get('lookups')
  @RequirePermissions('expense.create')
  @ApiOperation({ summary: 'Active categories and the projects the caller can claim against' })
  lookups(@CurrentUser() user: AuthenticatedUser) {
    return this.expenses.lookups(user);
  }

  @Get('summary')
  @RequirePermissions('expense.view')
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.expenses.summary(user);
  }

  @Post('receipts')
  @RequirePermissions('expense.create')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a receipt photo or PDF (up to 10 MB)' })
  @UseInterceptors(FileInterceptor('receipt', { limits: { fileSize: RECEIPT_MAX_BYTES } }))
  receipt(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Attach a receipt photo or PDF.',
        details: [{ path: 'receipt', message: 'Attach a receipt photo or PDF.' }],
      });
    }
    return this.expenses.uploadReceipt(
      {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        buffer: file.buffer,
      },
      user,
    );
  }

  @Get('export')
  @RequirePermissions('expense.export')
  @ApiOperation({ summary: 'The filtered claims as an Excel workbook' })
  async export(
    @Query(new ZodValidationPipe(expenseListQuerySchema)) query: ExpenseListQuery,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { buffer, fileName } = await this.expenses.exportWorkbook(query, user);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  @Get()
  @RequirePermissions('expense.view')
  @ApiOperation({ summary: 'Claims: yours, your team’s, and those waiting on you' })
  list(
    @Query(new ZodValidationPipe(expenseListQuerySchema)) query: ExpenseListQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.expenses.list(query, user);
  }

  @Post()
  @RequirePermissions('expense.create')
  @ApiOperation({ summary: 'Draft a claim' })
  create(
    @Body(new ZodValidationPipe(expenseSchema)) body: ExpenseInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.expenses.create(body, user);
  }

  // Declared before the `:id` routes so these words are not read as ids.
  @Post('bulk-decision')
  @RequirePermissions('expense.approve')
  bulk(
    @Body(new ZodValidationPipe(bulkExpenseDecisionSchema)) body: BulkExpenseDecisionInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.expenses.bulkDecide(body, user);
  }

  @Post('reimburse')
  @RequirePermissions('expense.reimburse')
  @ApiOperation({ summary: 'Mark approved claims as reimbursed' })
  reimburse(
    @Body(new ZodValidationPipe(reimburseSchema)) body: ReimburseInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.expenses.reimburse(body, user);
  }

  @Get(':id')
  @RequirePermissions('expense.view')
  get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.expenses.get(id, user);
  }

  @Get(':id/receipt')
  @RequirePermissions('expense.view')
  async receiptFile(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { document, stream } = await this.expenses.openReceipt(id, user);
    res.setHeader('Content-Type', document.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline');
    stream.pipe(res);
  }

  @Patch(':id')
  @RequirePermissions('expense.edit')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateExpenseSchema)) body: UpdateExpenseInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.expenses.update(id, body, user);
  }

  @Delete(':id')
  @RequirePermissions('expense.create')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.expenses.remove(id, user);
  }

  @Post(':id/submit')
  @RequirePermissions('expense.create')
  submit(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.expenses.submit(id, user);
  }

  @Post(':id/withdraw')
  @RequirePermissions('expense.create')
  withdraw(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.expenses.withdraw(id, user);
  }

  @Post(':id/decision')
  @RequirePermissions('expense.approve')
  @ApiOperation({ summary: 'Manager, then Finance: approve or reject' })
  decide(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(expenseDecisionSchema)) body: ExpenseDecisionInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.expenses.decide(id, body, user);
  }

  @Post(':id/reverse')
  @RequirePermissions('expense.reimburse')
  @ApiOperation({ summary: 'Take back an approved, unpaid claim; reverses its cost posting' })
  reverse(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reverseExpenseSchema)) body: ReverseExpenseInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.expenses.reverse(id, body, user);
  }
}
