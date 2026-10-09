import { z } from 'zod';
import { AttendanceMethod, EmployeeStatus } from '../constants/enums';
import { dateOnlySchema, idSchema, moneySchema, paginationQuerySchema } from './common';

// ---------------------------------------------------------------------------
// Employee record
// ---------------------------------------------------------------------------

const employeeBaseSchema = z.object({
  employeeCode: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'At least 2 characters')
    .max(40)
    .regex(/^[A-Z0-9-/]+$/, 'Letters, numbers, dashes and slashes only'),
  firstName: z.string().trim().min(1, 'Required').max(80),
  lastName: z.string().trim().min(1, 'Required').max(80),
  personalEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(180)
    .optional()
    .nullable()
    .or(z.literal('')),
  workEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email()
    .max(180)
    .optional()
    .nullable()
    .or(z.literal('')),
  phone: z.string().trim().max(30).optional().nullable(),
  dateOfBirth: dateOnlySchema.optional().nullable(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED']).optional().nullable(),
  joiningDate: dateOnlySchema,
  exitDate: dateOnlySchema.optional().nullable(),
  officeId: idSchema,
  departmentId: idSchema.optional().nullable(),
  designationId: idSchema.optional().nullable(),
  managerId: idSchema.optional().nullable(),
  attendanceMethod: z.nativeEnum(AttendanceMethod),
  status: z.nativeEnum(EmployeeStatus),
  addressLine1: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  state: z.string().trim().max(100).optional().nullable(),
  country: z.string().trim().max(100).optional().nullable(),
  emergencyName: z.string().trim().max(120).optional().nullable(),
  emergencyPhone: z.string().trim().max(30).optional().nullable(),
});

export const createEmployeeSchema = employeeBaseSchema
  .extend({
    /** Optional opening cost rate, so a new joiner is immediately costable. */
    hourlyRate: moneySchema.optional().nullable(),
    monthlySalary: moneySchema.optional().nullable(),
    /** Sends the login invitation straight after creating the record. */
    sendInvite: z.boolean().optional().default(false),
  })
  .refine((e) => !e.exitDate || e.exitDate >= e.joiningDate, {
    message: 'Exit date cannot be before the joining date',
    path: ['exitDate'],
  })
  .refine((e) => !e.sendInvite || Boolean(e.workEmail), {
    message: 'A work email is needed to send an invitation',
    path: ['workEmail'],
  });
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = employeeBaseSchema
  .partial()
  .refine((e) => !e.exitDate || !e.joiningDate || e.exitDate >= e.joiningDate, {
    message: 'Exit date cannot be before the joining date',
    path: ['exitDate'],
  });
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const employeeListQuerySchema = paginationQuerySchema.extend({
  officeId: idSchema.optional(),
  departmentId: idSchema.optional(),
  designationId: idSchema.optional(),
  managerId: idSchema.optional(),
  status: z.nativeEnum(EmployeeStatus).optional(),
  attendanceMethod: z.nativeEnum(AttendanceMethod).optional(),
  /** Employees with no linked login. */
  withoutLogin: z.coerce.boolean().optional(),
});
export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;

// ---------------------------------------------------------------------------
// Cost rate & salary history
// ---------------------------------------------------------------------------

/**
 * A new rate row rather than an edit of the old one: costing always uses the
 * rate effective on the *work date*, so history has to stay intact.
 */
export const costRateSchema = z.object({
  hourlyRate: moneySchema,
  effectiveFrom: dateOnlySchema,
  note: z.string().trim().max(400).optional().nullable(),
});
export type CostRateInput = z.infer<typeof costRateSchema>;

export const salarySchema = z.object({
  monthlyAmount: moneySchema,
  effectiveFrom: dateOnlySchema,
  note: z.string().trim().max(400).optional().nullable(),
});
export type SalaryInput = z.infer<typeof salarySchema>;

// ---------------------------------------------------------------------------
// Bulk import
// ---------------------------------------------------------------------------

/** The columns the Excel importer understands, in template order. */
export const IMPORT_COLUMNS = [
  { key: 'employeeCode', header: 'Employee Code', required: true, example: 'MOR-011' },
  { key: 'firstName', header: 'First Name', required: true, example: 'Anita' },
  { key: 'lastName', header: 'Last Name', required: true, example: 'Deshpande' },
  { key: 'workEmail', header: 'Work Email', required: false, example: 'anita@company.in' },
  { key: 'phone', header: 'Phone', required: false, example: '+91 98220 11011' },
  { key: 'joiningDate', header: 'Joining Date', required: true, example: '2026-10-01' },
  { key: 'office', header: 'Office Code', required: true, example: 'NGP' },
  { key: 'department', header: 'Department', required: false, example: 'BIM Modelling' },
  { key: 'designation', header: 'Designation', required: false, example: 'BIM Engineer' },
  { key: 'managerCode', header: 'Manager Code', required: false, example: 'MOR-006' },
  { key: 'attendanceMethod', header: 'Attendance Method', required: false, example: 'BOTH' },
  { key: 'hourlyRate', header: 'Hourly Cost Rate', required: false, example: '650.00' },
  { key: 'monthlySalary', header: 'Monthly Salary', required: false, example: '72000.00' },
] as const;

export type ImportColumnKey = (typeof IMPORT_COLUMNS)[number]['key'];

/** One parsed row from the uploaded sheet. Everything arrives as text. */
export const importRowSchema = z.object({
  rowNumber: z.number().int().min(2),
  employeeCode: z.string().trim().default(''),
  firstName: z.string().trim().default(''),
  lastName: z.string().trim().default(''),
  workEmail: z.string().trim().default(''),
  phone: z.string().trim().default(''),
  joiningDate: z.string().trim().default(''),
  office: z.string().trim().default(''),
  department: z.string().trim().default(''),
  designation: z.string().trim().default(''),
  managerCode: z.string().trim().default(''),
  attendanceMethod: z.string().trim().default(''),
  hourlyRate: z.string().trim().default(''),
  monthlySalary: z.string().trim().default(''),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export const importEmployeesSchema = z.object({
  rows: z.array(importRowSchema).min(1, 'The sheet has no data rows').max(2000),
  /** Validate and report without writing anything. */
  dryRun: z.boolean().default(true),
});
export type ImportEmployeesInput = z.infer<typeof importEmployeesSchema>;

export interface ImportRowError {
  rowNumber: number;
  employeeCode: string;
  field: string;
  message: string;
}

export interface ImportResult {
  dryRun: boolean;
  totalRows: number;
  valid: number;
  created: number;
  errors: ImportRowError[];
}
