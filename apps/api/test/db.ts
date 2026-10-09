import { PrismaClient } from '@prisma/client';

export const testPrisma = new PrismaClient();

/**
 * Empties every table the tests write to, children first so foreign keys hold.
 * Each suite starts from a clean database rather than relying on seed data.
 */
export async function resetDatabase(): Promise<void> {
  await testPrisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
  const tables = await testPrisma.$queryRaw<Array<{ TABLE_NAME: string }>>`
    SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> '_prisma_migrations'
  `;
  for (const { TABLE_NAME } of tables) {
    await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE \`${TABLE_NAME}\``);
  }
  await testPrisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
}
