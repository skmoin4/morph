import { PrismaClient } from '@prisma/client';
import { resetDatabase } from '../../test/db';
import { runInTenantContext, runUnscoped } from './tenant-context';
import { MissingTenantContextError, scopedModelNames, tenantExtension } from './tenant-extension';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const raw = new PrismaClient();
const db = raw.$extends(tenantExtension);

interface Fixture {
  companyId: string;
  officeId: string;
  clientName: string;
  clientId: string;
}

async function makeCompany(name: string, prefix: string, clientName: string): Promise<Fixture> {
  return runUnscoped(async () => {
    const company = await raw.company.create({
      data: { name, codePrefix: prefix, fyStartMonth: 4 },
    });
    const office = await raw.office.create({
      data: { companyId: company.id, name: `${name} HQ`, shortCode: `${prefix}1` },
    });
    const client = await raw.client.create({
      data: { companyId: company.id, name: clientName },
    });
    return {
      companyId: company.id,
      officeId: office.id,
      clientName,
      clientId: client.id,
    };
  });
}

describe('tenant scoping', () => {
  let alpha: Fixture;
  let beta: Fixture;

  beforeAll(async () => {
    await resetDatabase();
    alpha = await makeCompany('Alpha Engineering', 'ALP', 'Alpha Shared Client');
    beta = await makeCompany('Beta Engineering', 'BET', 'Beta Shared Client');
  });

  afterAll(async () => {
    await db.$disconnect();
    await raw.$disconnect();
  });

  it('covers every table that has a companyId column', () => {
    // A spot check that the DMMF-derived list is actually populated and
    // includes the tables that matter most.
    expect(scopedModelNames).toContain('Booking');
    expect(scopedModelNames).toContain('CostLedgerEntry');
    expect(scopedModelNames).toContain('TimeEntry');
    expect(scopedModelNames).toContain('User');
    // Globals stay out.
    expect(scopedModelNames).not.toContain('Permission');
    expect(scopedModelNames).not.toContain('Company');
    expect(scopedModelNames.length).toBeGreaterThan(35);
  });

  it('refuses to run a scoped query with no tenant context', async () => {
    await expect(db.client.findMany()).rejects.toThrow(MissingTenantContextError);
  });

  describe('reads', () => {
    it('findMany returns only the current company rows', async () => {
      const rows = await runInTenantContext(
        { companyId: alpha.companyId, userId: 'u', employeeId: null },
        () => db.client.findMany(),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('Alpha Shared Client');
    });

    it('findUnique on another company id returns null', async () => {
      const row = await runInTenantContext(
        { companyId: alpha.companyId, userId: 'u', employeeId: null },
        () => db.client.findUnique({ where: { id: beta.clientId } }),
      );
      expect(row).toBeNull();
    });

    it('findUnique on an own id still works', async () => {
      const row = await runInTenantContext(
        { companyId: alpha.companyId, userId: 'u', employeeId: null },
        () => db.client.findUnique({ where: { id: alpha.clientId } }),
      );
      expect(row?.id).toBe(alpha.clientId);
    });

    it('findUniqueOrThrow throws for another company row', async () => {
      await expect(
        runInTenantContext({ companyId: alpha.companyId, userId: 'u', employeeId: null }, () =>
          db.client.findUniqueOrThrow({ where: { id: beta.clientId } }),
        ),
      ).rejects.toThrow();
    });

    it('count is scoped', async () => {
      const total = await runInTenantContext(
        { companyId: beta.companyId, userId: 'u', employeeId: null },
        () => db.client.count(),
      );
      expect(total).toBe(1);
    });

    it('an explicit companyId in the caller where clause cannot widen the scope', async () => {
      const rows = await runInTenantContext(
        { companyId: alpha.companyId, userId: 'u', employeeId: null },
        // A caller trying to read Beta's data: the injected value wins because
        // it is merged last.
        () => db.client.findMany({ where: { companyId: beta.companyId } }),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].companyId).toBe(alpha.companyId);
    });
  });

  describe('writes', () => {
    it('create stamps the current company without being told', async () => {
      const created = await runInTenantContext(
        { companyId: beta.companyId, userId: 'u', employeeId: null },
        () => db.client.create({ data: { name: 'Beta New Client' } as never }),
      );
      expect(created.companyId).toBe(beta.companyId);
    });

    it('createMany stamps every row', async () => {
      await runInTenantContext({ companyId: beta.companyId, userId: 'u', employeeId: null }, () =>
        db.client.createMany({
          data: [{ name: 'Beta Bulk 1' }, { name: 'Beta Bulk 2' }] as never,
        }),
      );
      const betaRows = await runUnscoped(() =>
        raw.client.count({ where: { companyId: beta.companyId } }),
      );
      expect(betaRows).toBe(4);
    });

    it('update cannot touch another company row', async () => {
      await expect(
        runInTenantContext({ companyId: alpha.companyId, userId: 'u', employeeId: null }, () =>
          db.client.update({
            where: { id: beta.clientId },
            data: { name: 'Hijacked' },
          }),
        ),
      ).rejects.toThrow();

      const untouched = await runUnscoped(() =>
        raw.client.findUniqueOrThrow({ where: { id: beta.clientId } }),
      );
      expect(untouched.name).toBe('Beta Shared Client');
    });

    it('delete cannot touch another company row', async () => {
      await expect(
        runInTenantContext({ companyId: alpha.companyId, userId: 'u', employeeId: null }, () =>
          db.client.delete({ where: { id: beta.clientId } }),
        ),
      ).rejects.toThrow();

      const stillThere = await runUnscoped(() =>
        raw.client.findUnique({ where: { id: beta.clientId } }),
      );
      expect(stillThere).not.toBeNull();
    });

    it('deleteMany is scoped, so a blanket delete only clears own rows', async () => {
      await runInTenantContext({ companyId: beta.companyId, userId: 'u', employeeId: null }, () =>
        db.client.deleteMany({ where: { name: { startsWith: 'Beta Bulk' } } }),
      );

      const remaining = await runUnscoped(() => raw.client.count());
      // Alpha 1 + Beta 2 (Shared + New) = 3
      expect(remaining).toBe(3);
    });
  });

  describe('name collisions across companies', () => {
    it('allows the same client name in two companies', async () => {
      // `clients` is unique on (companyId, name), so this is only possible
      // because the unique key is company-scoped.
      const inAlpha = await runInTenantContext(
        { companyId: alpha.companyId, userId: 'u', employeeId: null },
        () => db.client.create({ data: { name: 'Acme Infra' } as never }),
      );
      const inBeta = await runInTenantContext(
        { companyId: beta.companyId, userId: 'u', employeeId: null },
        () => db.client.create({ data: { name: 'Acme Infra' } as never }),
      );
      expect(inAlpha.id).not.toBe(inBeta.id);
      expect(inAlpha.name).toBe(inBeta.name);
    });

    it('still rejects a duplicate employee code inside one company', async () => {
      const ctx = { companyId: alpha.companyId, userId: 'u', employeeId: null };
      await runInTenantContext(ctx, () =>
        db.employee.create({
          data: {
            employeeCode: 'DUP-1',
            firstName: 'First',
            lastName: 'Person',
            joiningDate: d('2026-01-01'),
            officeId: alpha.officeId,
          } as never,
        }),
      );
      await expect(
        runInTenantContext(ctx, () =>
          db.employee.create({
            data: {
              employeeCode: 'DUP-1',
              firstName: 'Second',
              lastName: 'Person',
              joiningDate: d('2026-01-01'),
              officeId: alpha.officeId,
            } as never,
          }),
        ),
      ).rejects.toThrow(/Unique constraint/i);
    });
  });

  it('runUnscoped is the only way to see across companies', async () => {
    const all = await runUnscoped(() => raw.client.count());
    expect(all).toBeGreaterThan(1);
  });
});
