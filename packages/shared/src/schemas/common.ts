import { z } from 'zod';

export const cuidSchema = z.string().min(1).max(32);
export const idSchema = z.string().min(1, 'Required');

/** Money arrives as a string so no precision is lost crossing JSON. */
export const moneySchema = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v.toFixed(2) : v.trim()))
  .refine((v) => /^-?\d{1,13}(\.\d{1,2})?$/.test(v), {
    message: 'Must be a number with at most 2 decimal places',
  });

export const hoursSchema = z.coerce.number().min(0).max(24);

/** Calendar date with no time component, as seen in the office time zone. */
export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  /** `field:asc` or `field:desc` */
  sort: z
    .string()
    .regex(/^[a-zA-Z0-9_.]+:(asc|desc)$/, 'Expected field:asc or field:desc')
    .optional(),
  q: z.string().trim().max(200).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const paginatedMeta = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

export function paginatedResponse<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item), meta: paginatedMeta });
}

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const geoPointSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  accuracyM: z.coerce.number().min(0).optional(),
});
export type GeoPoint = z.infer<typeof geoPointSchema>;
