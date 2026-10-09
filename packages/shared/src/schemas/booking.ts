import { z } from 'zod';
import { BillingType, BookingStatus, ConfirmationType, VerbalMode } from '../constants/enums';
import { dateOnlySchema, idSchema, moneySchema, paginationQuerySchema } from './common';

export const bookingBaseSchema = z.object({
  clientId: idSchema,
  clientContactId: idSchema.optional().nullable(),
  projectName: z.string().trim().min(3).max(200),
  projectTypeId: idSchema,
  officeId: idSchema,
  bookingDate: dateOnlySchema,
  projectValue: moneySchema,
  budgetHours: z.coerce.number().min(0).max(1_000_000),
  billingType: z.nativeEnum(BillingType),
  expectedStartDate: dateOnlySchema,
  expectedEndDate: dateOnlySchema,
  scopeDescription: z.string().trim().max(5000).optional().nullable(),
  projectManagerId: idSchema.optional().nullable(),
});

export const createBookingSchema = bookingBaseSchema.refine(
  (v) => v.expectedEndDate >= v.expectedStartDate,
  { message: 'End date must be on or after the start date', path: ['expectedEndDate'] },
);
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const updateBookingSchema = bookingBaseSchema.partial();
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;

/**
 * A booking cannot be confirmed without proof: either an uploaded confirmation
 * email, or a complete verbal note. This discriminated union is the single place
 * that rule is expressed for both API and web.
 */
export const emailConfirmationSchema = z.object({
  type: z.literal(ConfirmationType.EMAIL),
  emailDocumentId: idSchema,
  receivedAt: dateOnlySchema,
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const verbalConfirmationSchema = z.object({
  type: z.literal(ConfirmationType.VERBAL),
  confirmedByName: z.string().trim().min(2, 'Who confirmed this?').max(120),
  confirmedOn: dateOnlySchema,
  mode: z.nativeEnum(VerbalMode),
  summary: z.string().trim().min(20, 'Summarise what was agreed (min 20 chars)').max(4000),
});

export const confirmBookingSchema = z.object({
  confirmation: z.discriminatedUnion('type', [emailConfirmationSchema, verbalConfirmationSchema]),
  poDocumentId: idSchema.optional().nullable(),
  poNumber: z.string().trim().max(80).optional().nullable(),
});
export type ConfirmBookingInput = z.infer<typeof confirmBookingSchema>;

/** Attaching the email later to a verbal booking, clearing the "Email pending" badge. */
export const attachConfirmationEmailSchema = z.object({
  emailDocumentId: idSchema,
  receivedAt: dateOnlySchema,
  notes: z.string().trim().max(2000).optional().nullable(),
});
export type AttachConfirmationEmailInput = z.infer<typeof attachConfirmationEmailSchema>;

export const cancelBookingSchema = z.object({
  reason: z.string().trim().min(5).max(1000),
});
export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;

export const bookingListQuerySchema = paginationQuerySchema.extend({
  status: z.string().optional(),
  clientId: idSchema.optional(),
  officeId: idSchema.optional(),
  projectTypeId: idSchema.optional(),
  confirmationType: z.nativeEnum(ConfirmationType).optional(),
  emailPending: z.coerce.boolean().optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
export type BookingListQuery = z.infer<typeof bookingListQuerySchema>;

// ---------------------------------------------------------------------------
// Confirmation file rules
// ---------------------------------------------------------------------------

/**
 * What counts as a client confirmation email.
 *
 * `.eml` and `.msg` are what people actually drag out of Outlook; a PDF or a
 * screenshot is what they produce when they cannot. Browsers report `.msg`
 * inconsistently, so the extension is authoritative and the MIME type is only
 * a secondary check.
 */
export const CONFIRMATION_FILE_EXTENSIONS = [
  '.pdf',
  '.eml',
  '.msg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.heic',
] as const;

export const CONFIRMATION_MIME_TYPES = [
  'application/pdf',
  'message/rfc822',
  'application/vnd.ms-outlook',
  'application/octet-stream',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
] as const;

export const CONFIRMATION_MAX_BYTES = 10 * 1024 * 1024;

export function describeConfirmationFileRules(): string {
  return `PDF, image, .eml or .msg — up to ${CONFIRMATION_MAX_BYTES / 1024 / 1024} MB`;
}

/** Shared check so the browser and the API reject the same files. */
export function validateConfirmationFile(file: {
  name: string;
  size: number;
  type?: string;
}): { ok: true } | { ok: false; message: string } {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();

  if (!(CONFIRMATION_FILE_EXTENSIONS as readonly string[]).includes(extension)) {
    return {
      ok: false,
      message: `"${file.name}" is not an accepted file. Use a PDF, an image, or an .eml / .msg email.`,
    };
  }
  if (file.size > CONFIRMATION_MAX_BYTES) {
    return {
      ok: false,
      message: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${
        CONFIRMATION_MAX_BYTES / 1024 / 1024
      } MB.`,
    };
  }
  if (file.size === 0) {
    return { ok: false, message: 'That file is empty.' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

/**
 * A booking that has already produced a project cannot be cancelled: the
 * project carries cost, time and a code that must keep resolving. The project
 * is cancelled instead, and the booking follows from there.
 */
export function canCancelBooking(status: BookingStatus): { allowed: boolean; reason?: string } {
  if (status === BookingStatus.PROJECT_CREATED) {
    return {
      allowed: false,
      reason:
        'This booking already has a project. Cancel the project instead — its code, time and cost have to keep resolving.',
    };
  }
  if (status === BookingStatus.CANCELLED) {
    return { allowed: false, reason: 'This booking is already cancelled.' };
  }
  return { allowed: true };
}

export const approveBookingSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(1000).optional().nullable(),
});
export type ApproveBookingInput = z.infer<typeof approveBookingSchema>;

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export const clientContactSchema = z.object({
  name: z.string().trim().min(2).max(150),
  designation: z.string().trim().max(120).optional().nullable(),
  email: z.string().trim().toLowerCase().email().max(180).optional().nullable().or(z.literal('')),
  phone: z.string().trim().max(30).optional().nullable(),
  isPrimary: z.boolean().optional().default(false),
});
export type ClientContactInput = z.infer<typeof clientContactSchema>;

export const createClientSchema = z.object({
  name: z.string().trim().min(2, 'Give the client a name').max(200),
  clientCode: z.string().trim().max(40).optional().nullable(),
  industry: z.string().trim().max(100).optional().nullable(),
  gstin: z.string().trim().max(20).optional().nullable(),
  website: z.string().trim().max(200).optional().nullable(),
  addressLine1: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  state: z.string().trim().max(100).optional().nullable(),
  country: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
  isActive: z.boolean().optional(),
  contacts: z.array(clientContactSchema).max(20).optional(),
});
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const updateClientSchema = createClientSchema.omit({ contacts: true }).partial();
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const clientListQuerySchema = paginationQuerySchema.extend({
  isActive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
});
export type ClientListQuery = z.infer<typeof clientListQuerySchema>;
