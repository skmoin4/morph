import { z } from 'zod';
import { DataScope } from '../constants/enums';
import { ALL_PERMISSIONS } from '../constants/permissions';
import { idSchema, paginationQuerySchema } from './common';

const permissionKeySchema = z
  .string()
  .refine((key) => (ALL_PERMISSIONS as string[]).includes(key), {
    message: 'Unknown permission key',
  });

export const rolePermissionGrantSchema = z.object({
  key: permissionKeySchema,
  dataScope: z.nativeEnum(DataScope),
});
export type RolePermissionGrant = z.infer<typeof rolePermissionGrantSchema>;

export const createRoleSchema = z.object({
  name: z.string().trim().min(2, 'Give the role a name').max(100),
  description: z.string().trim().max(400).optional().nullable(),
  /** The full matrix for the new role; an empty list creates a role that can do nothing. */
  permissions: z.array(rolePermissionGrantSchema).default([]),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(400).optional().nullable(),
  isActive: z.boolean().optional(),
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

/**
 * The permission matrix screen saves the whole grid at once, so the server can
 * diff it in one transaction and write a single audit entry.
 */
export const setRolePermissionsSchema = z.object({
  permissions: z.array(rolePermissionGrantSchema),
});
export type SetRolePermissionsInput = z.infer<typeof setRolePermissionsSchema>;

export const roleListQuerySchema = paginationQuerySchema.extend({
  isActive: z.coerce.boolean().optional(),
});
export type RoleListQuery = z.infer<typeof roleListQuerySchema>;

export const assignRoleSchema = z.object({
  userId: idSchema,
  roleId: idSchema,
});
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;
