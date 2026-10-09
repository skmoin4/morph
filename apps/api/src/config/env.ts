import { z } from 'zod';

/**
 * The process environment, validated once at boot. Anything missing or
 * malformed fails the start rather than surfacing as a runtime surprise.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  API_PORT: z.coerce.number().int().default(4000),
  API_PREFIX: z.string().default('/api/v1'),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  /**
   * How many reverse proxies sit in front of the API. 0 trusts nobody's
   * X-Forwarded-For. It matters: office-network punches are decided by the
   * caller's IP, and a header anyone can set would let anyone punch "from the
   * office". Set it to the real hop count only when a proxy you control is there.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  /** Background jobs (attendance closing, reminders). Off for tests. */
  JOBS_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),

  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_REFRESH_TTL: z.string().default('7d'),
  COOKIE_DOMAIN: z.string().default('localhost'),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(8).max(15).default(10),

  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: z.coerce.number().int().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().default(0),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_ROOT: z.string().default('./storage'),
  STORAGE_PUBLIC_BASE_URL: z.string().default('http://localhost:4000/api/v1/files'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('ap-south-1'),
  S3_BUCKET: z.string().default('opsvera'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  MAIL_DRIVER: z.enum(['smtp', 'log']).default('smtp'),
  SMTP_HOST: z.string().default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('OPSVERA <no-reply@opsvera.local>'),
});

export type AppEnv = z.infer<typeof envSchema> & { corsOrigins: string[] };

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return {
    ...parsed.data,
    corsOrigins: parsed.data.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
}
