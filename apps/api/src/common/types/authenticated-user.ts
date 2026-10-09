import type { DataScope } from '@opsvera/shared';

/** What the JWT guard puts on the request once a token is verified. */
export interface AuthenticatedUser {
  userId: string;
  companyId: string;
  employeeId: string | null;
  roleId: string;
  roleName: string;
  systemRoleKey: string | null;
  email: string;
  fullName: string;
  officeId: string | null;
  /** Granted permission keys. */
  permissions: Set<string>;
  /** permissionKey -> data scope. */
  scopes: Map<string, DataScope>;
}

export interface AccessTokenPayload {
  /** User id. */
  sub: string;
  /** Company id. */
  cid: string;
  /** Employee id, when the user is linked to one. */
  eid: string | null;
  /** Role id. */
  rid: string;
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: string;
  cid: string;
  /** Refresh token row id, so a rotated token can be revoked by id. */
  jti: string;
  iat?: number;
  exp?: number;
}
