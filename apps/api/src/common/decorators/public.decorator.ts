import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'opsvera:isPublic';

/** Opts a route out of the global JWT guard. Login, refresh, reset password. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
