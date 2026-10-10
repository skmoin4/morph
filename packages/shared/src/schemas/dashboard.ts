import { z } from 'zod';
import { idSchema } from './common';

export const dashboardQuerySchema = z.object({
  /** Limit the executive view to one office. */
  officeId: idSchema.optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
