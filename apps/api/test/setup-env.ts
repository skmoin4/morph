/**
 * Tests always run against a separate database: the development one with a
 * `_test` suffix. A test run therefore cannot touch development data.
 *
 * DATABASE_URL is already in the environment because the `test` script runs
 * Jest through dotenv-cli — this only rewrites the database name.
 */
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set. Run tests with `pnpm test`.');
}

process.env.DATABASE_URL = url.replace(/\/([^/?]+)(\?|$)/, '/$1_test$2');
process.env.NODE_ENV = 'test';
// Background jobs need Redis and have nothing to do in a test run.
process.env.JOBS_ENABLED = 'false';
