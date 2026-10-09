import { prisma, section } from './helpers';
import { seedPermissions, seedRoles } from './rbac';
import { seedOrg } from './org';
import { SEED_PASSWORD, seedPeople } from './people';
import { seedCommercial } from './commercial';
import { seedOperations } from './operations';

/**
 * Seeds one company's worth of realistic data: enough for every Phase 1 screen
 * to show real numbers, and for the core flow (booking -> project -> time ->
 * approval -> cost -> dashboard) to be demonstrable end to end.
 *
 * Idempotent: every step upserts or checks before inserting, so running it
 * twice does not duplicate anything.
 */
async function main() {
  const started = Date.now();

  section('Permissions & roles');
  await seedPermissions();

  section('Company, offices & setup');
  const org = await seedOrg();

  section('Roles');
  const roleIdByKey = await seedRoles(org.companyId);

  section('People');
  const people = await seedPeople(org, roleIdByKey);

  section('Clients, bookings & projects');
  const commercial = await seedCommercial(org, people);

  section('Attendance, time, expenses & cost');
  await seedOperations(org, people, commercial);

  const [projects, ledger] = await Promise.all([
    prisma.project.findMany({
      where: { companyId: org.companyId },
      select: {
        projectCode: true,
        name: true,
        budgetHours: true,
        actualHours: true,
        projectValue: true,
        actualTotalCost: true,
        health: true,
        budgetAlertLevel: true,
      },
      orderBy: { projectCode: 'asc' },
    }),
    prisma.costLedgerEntry.count({ where: { companyId: org.companyId } }),
  ]);

  section('Summary');
  // eslint-disable-next-line no-console
  console.table(
    projects.map((p) => ({
      code: p.projectCode,
      'budget h': Number(p.budgetHours),
      'actual h': Number(p.actualHours),
      'used %': Math.round((Number(p.actualHours) / Number(p.budgetHours)) * 100),
      value: Number(p.projectValue),
      cost: Number(p.actualTotalCost),
      'margin %': Math.round(
        ((Number(p.projectValue) - Number(p.actualTotalCost)) / Number(p.projectValue)) * 100,
      ),
      health: p.health,
      alert: p.budgetAlertLevel,
    })),
  );

  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      `  ${ledger} cost ledger entries`,
      '',
      '  Sign in with any of the seeded accounts:',
      '    rajesh.deshmukh@morengineering.in   CEO / Director',
      '    priya.kulkarni@morengineering.in    HR / Admin',
      '    anil.joshi@morengineering.in        Finance',
      '    sameer.patil@morengineering.in      Project Manager',
      '    vikram.rane@morengineering.in       Team Lead',
      '    amit.chavan@morengineering.in       Employee',
      `  Password for all of them: ${SEED_PASSWORD}`,
      '',
      `  Seeded in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      '',
    ].join('\n'),
  );
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error('\nSeed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
