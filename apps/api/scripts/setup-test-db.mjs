// Creates (if needed) and migrates the test database, then exits. Run before
// Jest so every suite can assume a schema matching prisma/schema.prisma.
//
// The test database is the development one with a `_test` suffix, so a test run
// can never touch development data.
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const base = process.env.DATABASE_URL;
if (!base) {
  console.error('DATABASE_URL is not set — run this through dotenv.');
  process.exit(1);
}

const url = new URL(base);
const devName = decodeURIComponent(url.pathname.replace(/^\//, ''));
const testName = `${devName}_test`;

const adminUrl = new URL(base);
// Connecting with no database selected is what lets us issue CREATE DATABASE.
adminUrl.pathname = '/';

const testUrl = new URL(base);
testUrl.pathname = `/${testName}`;

const scratch = mkdtempSync(path.join(tmpdir(), 'opsvera-test-db-'));
const sqlFile = path.join(scratch, 'create.sql');
writeFileSync(
  sqlFile,
  `CREATE DATABASE IF NOT EXISTS \`${testName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
);

function run(command, env = {}) {
  execSync(command, {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, ...env },
  });
}

run(`npx prisma db execute --url "${adminUrl.toString()}" --file "${sqlFile}"`);
run('npx prisma migrate deploy', { DATABASE_URL: testUrl.toString() });

console.log(`test database ready: ${testName}`);
