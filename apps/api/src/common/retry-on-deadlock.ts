import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const logger = new Logger('RetryOnDeadlock');

/** MySQL: 1213 deadlock, 1205 lock wait timeout. Both mean "try again". */
const RETRYABLE_MYSQL_CODES = ['1213', '1205'];

function isRetryable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // Prisma surfaces a raw-query failure as P2010 with the driver code in the
    // message, and its own write-conflict code as P2034.
    if (error.code === 'P2034') return true;
    const message = `${error.message} ${JSON.stringify(error.meta ?? {})}`;
    return RETRYABLE_MYSQL_CODES.some((code) => message.includes(code));
  }
  if (error instanceof Error) {
    return RETRYABLE_MYSQL_CODES.some((code) => error.message.includes(code));
  }
  return false;
}

/**
 * Runs `work`, retrying when the database reports a deadlock or lock-wait
 * timeout.
 *
 * Under concurrency these are an expected outcome of row locking, not a fault:
 * MySQL picks a victim and expects it to try again. Everything inside `work`
 * must therefore be safe to repeat — which it is, because the whole
 * confirmation is a single transaction that rolls back entirely on failure.
 */
export async function retryOnDeadlock<T>(
  work: () => Promise<T>,
  options: { attempts?: number; label?: string } = {},
): Promise<T> {
  const attempts = options.attempts ?? 5;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts) throw error;

      // Jittered backoff so the retries do not collide again in lockstep.
      const delay = Math.round(20 * 2 ** (attempt - 1) * (0.5 + Math.random()));
      logger.warn(
        `${options.label ?? 'transaction'} hit a lock conflict (attempt ${attempt}/${attempts}); retrying in ${delay}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
