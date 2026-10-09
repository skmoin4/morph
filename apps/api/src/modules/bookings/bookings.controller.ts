import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  approveBookingSchema,
  attachConfirmationEmailSchema,
  bookingListQuerySchema,
  cancelBookingSchema,
  confirmBookingSchema,
  createBookingSchema,
  updateBookingSchema,
  type ApproveBookingInput,
  type AttachConfirmationEmailInput,
  type BookingListQuery,
  type CancelBookingInput,
  type ConfirmBookingInput,
  type CreateBookingInput,
  type UpdateBookingInput,
} from '@opsvera/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { BookingsService } from './bookings.service';

@ApiTags('bookings')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  @RequirePermissions('booking.view')
  @ApiOperation({ summary: 'Booking register, filterable by status and "email pending"' })
  list(@Query(new ZodValidationPipe(bookingListQuerySchema)) query: BookingListQuery) {
    return this.bookings.list(query);
  }

  @Get(':id')
  @RequirePermissions('booking.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.bookings.findOne(id, user);
  }

  @Post()
  @RequirePermissions('booking.create')
  @ApiOperation({ summary: 'Create a draft booking' })
  create(
    @Body(new ZodValidationPipe(createBookingSchema)) body: CreateBookingInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookings.create(body, user);
  }

  @Patch(':id')
  @RequirePermissions('booking.edit')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBookingSchema)) body: UpdateBookingInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookings.update(id, body, user);
  }

  @Post(':id/confirm')
  @RequirePermissions('booking.confirm')
  @ApiOperation({
    summary: 'Confirm a booking and create its project',
    description:
      'Requires either an uploaded confirmation email or a complete verbal note. ' +
      'Locks the code sequence, mints the project code, creates the project and marks ' +
      'the booking — all in one transaction. If the company requires approval, it stops ' +
      'at CONFIRMED and waits.',
  })
  confirm(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(confirmBookingSchema)) body: ConfirmBookingInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookings.confirm(id, body, user);
  }

  @Post(':id/approval')
  @RequirePermissions('booking.approve')
  @ApiOperation({ summary: 'Approve or reject a confirmed booking (when approval is enabled)' })
  decideApproval(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(approveBookingSchema)) body: ApproveBookingInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookings.decideApproval(id, body, user);
  }

  @Post(':id/confirmation-email')
  @RequirePermissions('booking.edit')
  @ApiOperation({ summary: 'Attach the email to a verbal booking, clearing "Email pending"' })
  attachEmail(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(attachConfirmationEmailSchema)) body: AttachConfirmationEmailInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookings.attachConfirmationEmail(id, body, user);
  }

  @Post(':id/cancel')
  @RequirePermissions('booking.edit')
  @ApiOperation({
    summary: 'Cancel a booking',
    description:
      'Blocked once a project exists — the project is cancelled instead, and the ' +
      'response names it so the UI can point there.',
  })
  cancel(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(cancelBookingSchema)) body: CancelBookingInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.bookings.cancel(id, body, user);
  }
}
