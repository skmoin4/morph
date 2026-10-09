import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@opsvera/shared';

export const PERMISSIONS_KEY = 'opsvera:permissions';

/**
 * Requires every listed permission key. The guard enforces it; the frontend
 * only hides what the user cannot use.
 */
export const RequirePermissions = (...keys: PermissionKey[]) => SetMetadata(PERMISSIONS_KEY, keys);
