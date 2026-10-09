import { z } from 'zod';
import { idSchema } from './common';

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .regex(/[a-z]/, 'Needs a lowercase letter')
  .regex(/[A-Z]/, 'Needs an uppercase letter')
  .regex(/\d/, 'Needs a number');

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().optional().default(false),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().min(16),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const acceptInviteSchema = resetPasswordSchema;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Shape returned by GET /auth/me — drives the frontend's permission gating. */
export const sessionUserSchema = z.object({
  id: idSchema,
  companyId: idSchema,
  companyName: z.string(),
  email: z.string().email(),
  fullName: z.string(),
  avatarUrl: z.string().nullable(),
  roleId: idSchema,
  roleName: z.string(),
  employeeId: idSchema.nullable(),
  officeId: idSchema.nullable(),
  officeName: z.string().nullable(),
  officeTimezone: z.string(),
  currency: z.string(),
  permissions: z.array(z.string()),
  /** permissionKey -> data scope, so the UI can hint at what a list will contain. */
  scopes: z.record(z.string()),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;
