import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { ALL_PERMISSIONS, DEFAULT_ROLES, resolveRolePermissions } from '@opsvera/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { runUnscoped } from '../src/prisma/tenant-context';
import { resetDatabase, testPrisma as prisma } from './db';

const PASSWORD = 'Opsvera@2026';
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

/**
 * Step 5: employee records, data scope, field masking, cost-rate history and
 * the bulk importer.
 */
describe('Employees (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;

  const ids = {
    companyId: '',
    officeNgp: '',
    officeRuh: '',
    departmentId: '',
    ceo: { email: 'ceo@people.test', token: '' },
    lead: { email: 'lead@people.test', token: '', employeeId: '' },
    report: { email: 'report@people.test', token: '', employeeId: '' },
    stranger: { employeeId: '' },
  };

  beforeAll(async () => {
    await resetDatabase();
    await seed();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('/api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    server = app.getHttpServer();

    for (const key of ['ceo', 'lead', 'report'] as const) {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: ids[key].email, password: PASSWORD })
        .expect(200);
      ids[key].token = res.body.accessToken;
    }
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  async function seed() {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    await runUnscoped(async () => {
      for (const key of ALL_PERMISSIONS) {
        const [module, ...rest] = key.split('.');
        await prisma.permission.create({
          data: { key, module, action: rest.join('.'), label: key },
        });
      }

      const company = await prisma.company.create({
        data: { name: 'People Test Co', codePrefix: 'PTC', fyStartMonth: 4 },
      });
      ids.companyId = company.id;

      const ngp = await prisma.office.create({
        data: { companyId: company.id, name: 'Nagpur', shortCode: 'NGP', timezone: 'Asia/Kolkata' },
      });
      const ruh = await prisma.office.create({
        data: { companyId: company.id, name: 'Riyadh', shortCode: 'RUH', timezone: 'Asia/Riyadh' },
      });
      ids.officeNgp = ngp.id;
      ids.officeRuh = ruh.id;

      const department = await prisma.department.create({
        data: { companyId: company.id, name: 'BIM Modelling' },
      });
      ids.departmentId = department.id;
      await prisma.designation.create({
        data: { companyId: company.id, name: 'BIM Engineer' },
      });

      const permissionIdByKey = new Map(
        (await prisma.permission.findMany()).map((p) => [p.key, p.id]),
      );
      const roleIds: Record<string, string> = {};
      for (const def of DEFAULT_ROLES) {
        const role = await prisma.role.create({
          data: { companyId: company.id, name: def.name, systemKey: def.systemKey, isSystem: true },
        });
        roleIds[def.systemKey] = role.id;
        await prisma.rolePermission.createMany({
          data: resolveRolePermissions(def).map((g) => ({
            companyId: company.id,
            roleId: role.id,
            permissionId: permissionIdByKey.get(g.key)!,
            dataScope: g.dataScope,
          })),
        });
      }

      async function makePerson(
        code: string,
        first: string,
        email: string | null,
        systemKey: string,
        managerId: string | null,
      ) {
        let userId: string | null = null;
        if (email) {
          const user = await prisma.user.create({
            data: {
              companyId: company.id,
              email,
              passwordHash,
              fullName: first,
              roleId: roleIds[systemKey],
              status: 'ACTIVE',
            },
          });
          userId = user.id;
        }
        const employee = await prisma.employee.create({
          data: {
            companyId: company.id,
            userId,
            employeeCode: code,
            firstName: first,
            lastName: 'Tester',
            joiningDate: d('2024-01-01'),
            officeId: ngp.id,
            managerId,
          },
        });
        await prisma.employeeCostRate.create({
          data: {
            companyId: company.id,
            employeeId: employee.id,
            hourlyRate: '500.00',
            effectiveFrom: d('2024-01-01'),
          },
        });
        return employee.id;
      }

      await makePerson('PTC-001', 'Chief', ids.ceo.email, 'CEO', null);
      ids.lead.employeeId = await makePerson('PTC-002', 'Lead', ids.lead.email, 'TEAM_LEAD', null);
      ids.report.employeeId = await makePerson(
        'PTC-003',
        'Report',
        ids.report.email,
        'EMPLOYEE',
        ids.lead.employeeId,
      );
      // Nobody's report: outside the lead's TEAM scope.
      ids.stranger.employeeId = await makePerson('PTC-004', 'Stranger', null, 'EMPLOYEE', null);
    });
  }

  const asCeo = () => ({ Authorization: `Bearer ${ids.ceo.token}` });
  const asLead = () => ({ Authorization: `Bearer ${ids.lead.token}` });
  const asReport = () => ({ Authorization: `Bearer ${ids.report.token}` });

  describe('data scope', () => {
    it('shows the CEO everyone', async () => {
      const res = await request(server)
        .get('/api/v1/employees?pageSize=50')
        .set(asCeo())
        .expect(200);
      expect(res.body.meta.total).toBe(4);
    });

    it('shows a Team Lead only themselves and their reports', async () => {
      const res = await request(server)
        .get('/api/v1/employees?pageSize=50')
        .set(asLead())
        .expect(200);

      const codes = res.body.data.map((e: { employeeCode: string }) => e.employeeCode).sort();
      expect(codes).toEqual(['PTC-002', 'PTC-003']);
      // Someone outside the team is not merely hidden from the list…
      expect(codes).not.toContain('PTC-004');
    });

    it('404s rather than 403s for a record outside the caller scope', async () => {
      // …they should not be confirmable as existing either.
      await request(server)
        .get(`/api/v1/employees/${ids.stranger.employeeId}`)
        .set(asLead())
        .expect(404);
    });

    it('blocks a plain employee from the directory entirely', async () => {
      const res = await request(server).get('/api/v1/employees').set(asReport()).expect(403);
      expect(res.body.details.missingPermissions).toContain('employee.view');
    });
  });

  describe('field masking', () => {
    it('gives the CEO the cost rate', async () => {
      const res = await request(server)
        .get('/api/v1/employees?pageSize=50')
        .set(asCeo())
        .expect(200);
      expect(res.body.data[0].hourlyRate).toEqual(expect.any(String));
    });

    it('strips the cost rate for a Team Lead, who has no cost.view', async () => {
      const res = await request(server)
        .get('/api/v1/employees?pageSize=50')
        .set(asLead())
        .expect(200);

      for (const row of res.body.data) {
        expect(row).not.toHaveProperty('hourlyRate');
        expect(row).not.toHaveProperty('monthlyAmount');
      }
      // Non-sensitive fields are untouched.
      expect(res.body.data[0].employeeCode).toEqual(expect.any(String));
    });

    it('refuses the cost-rate history endpoint without cost.view', async () => {
      await request(server)
        .get(`/api/v1/employees/${ids.report.employeeId}/cost-rates`)
        .set(asLead())
        .expect(403);
    });
  });

  /**
   * The People CSV is built in the browser from exactly this payload, so what
   * it can contain is decided here. These assertions are the server half of
   * that guarantee; `exportPeople.test.ts` covers the builder itself.
   */
  describe('export payload (what the People CSV is built from)', () => {
    it('gives a Team Lead only their team, with no salary or cost rate', async () => {
      const res = await request(server)
        .get('/api/v1/employees?pageSize=200')
        .set(asLead())
        .expect(200);

      // Scope: self plus direct reports, nobody else.
      const codes = res.body.data.map((e: { employeeCode: string }) => e.employeeCode).sort();
      expect(codes).toEqual(['PTC-002', 'PTC-003']);

      // Masking: the sensitive fields are absent, not null — there is nothing
      // for an export to put in a cell.
      for (const row of res.body.data) {
        expect(row).not.toHaveProperty('hourlyRate');
        expect(row).not.toHaveProperty('monthlyAmount');
        expect(row).not.toHaveProperty('salary');
      }

      // Nothing resembling a rate survives anywhere in the serialised payload.
      const serialised = JSON.stringify(res.body);
      expect(serialised).not.toMatch(/"hourlyRate"/);
      expect(serialised).not.toMatch(/"monthlyAmount"/);
    });

    it('cannot be widened by asking for a bigger page or another office', async () => {
      // A crafted export request must not reach outside the caller's scope.
      const res = await request(server)
        .get(`/api/v1/employees?pageSize=200&officeId=${ids.officeNgp}`)
        .set(asLead())
        .expect(200);

      expect(res.body.meta.total).toBe(2);
      expect(
        res.body.data.some((e: { employeeCode: string }) => e.employeeCode === 'PTC-004'),
      ).toBe(false);
    });

    it('caps the page size, so an export cannot pull an unbounded set', async () => {
      // The export pages at 200 for this reason.
      await request(server).get('/api/v1/employees?pageSize=5000').set(asCeo()).expect(422);
    });

    it('gives the CEO the full list including the sensitive figures', async () => {
      const res = await request(server)
        .get('/api/v1/employees?pageSize=200')
        .set(asCeo())
        .expect(200);

      expect(res.body.meta.total).toBeGreaterThan(2);
      expect(res.body.data[0]).toHaveProperty('hourlyRate');
    });
  });

  describe('cost rate history', () => {
    it('adds a rate and closes off the previous one', async () => {
      await request(server)
        .post(`/api/v1/employees/${ids.report.employeeId}/cost-rates`)
        .set(asCeo())
        .send({ hourlyRate: '650.00', effectiveFrom: '2026-04-01', note: 'Revision' })
        .expect(201);

      const res = await request(server)
        .get(`/api/v1/employees/${ids.report.employeeId}/cost-rates`)
        .set(asCeo())
        .expect(200);

      // Newest first, and the older row now ends where the new one starts.
      expect(res.body).toHaveLength(2);
      expect(res.body[0].effectiveFrom.slice(0, 10)).toBe('2026-04-01');
      expect(res.body[0].effectiveTo).toBeNull();
      expect(res.body[1].effectiveTo.slice(0, 10)).toBe('2026-04-01');
    });

    it('slots a backdated rate between two existing rows', async () => {
      await request(server)
        .post(`/api/v1/employees/${ids.report.employeeId}/cost-rates`)
        .set(asCeo())
        .send({ hourlyRate: '575.00', effectiveFrom: '2025-04-01' })
        .expect(201);

      const res = await request(server)
        .get(`/api/v1/employees/${ids.report.employeeId}/cost-rates`)
        .set(asCeo())
        .expect(200);

      const chain = res.body.map((r: { effectiveFrom: string; effectiveTo: string | null }) => [
        r.effectiveFrom.slice(0, 10),
        r.effectiveTo?.slice(0, 10) ?? null,
      ]);
      // Each row ends exactly where the next begins — no gaps, no overlaps.
      expect(chain).toEqual([
        ['2026-04-01', null],
        ['2025-04-01', '2026-04-01'],
        ['2024-01-01', '2025-04-01'],
      ]);
    });

    it('refuses two rates starting on the same date', async () => {
      const res = await request(server)
        .post(`/api/v1/employees/${ids.report.employeeId}/cost-rates`)
        .set(asCeo())
        .send({ hourlyRate: '999.00', effectiveFrom: '2026-04-01' })
        .expect(409);
      expect(res.body.code).toBe('DUPLICATE');
    });

    it('warns when a backdated rate sits over cost already posted', async () => {
      // Post something to the ledger on 2026-05-01.
      await runUnscoped(async () => {
        const client = await prisma.client.create({
          data: { companyId: ids.companyId, name: 'Ledger Client' },
        });
        const projectType = await prisma.projectType.create({
          data: { companyId: ids.companyId, name: 'Hospital', shortCode: 'HOS' },
        });
        const booking = await prisma.booking.create({
          data: {
            companyId: ids.companyId,
            bookingNumber: 'BK-RATE',
            clientId: client.id,
            projectName: 'Rate test',
            projectTypeId: projectType.id,
            officeId: ids.officeNgp,
            bookingDate: d('2026-01-01'),
            projectValue: '100.00',
            budgetHours: '10.00',
            expectedStartDate: d('2026-01-01'),
            expectedEndDate: d('2026-12-31'),
            status: 'PROJECT_CREATED',
          },
        });
        const project = await prisma.project.create({
          data: {
            companyId: ids.companyId,
            projectCode: 'PTC-26-27-HOS-0001',
            name: 'Rate test',
            bookingId: booking.id,
            clientId: client.id,
            projectTypeId: projectType.id,
            officeId: ids.officeNgp,
            projectValue: '100.00',
            budgetHours: '10.00',
          },
        });
        await prisma.costLedgerEntry.create({
          data: {
            companyId: ids.companyId,
            projectId: project.id,
            employeeId: ids.report.employeeId,
            sourceType: 'TIMESHEET',
            sourceId: 'TS-RATE',
            postingDate: d('2026-05-01'),
            hours: '8.00',
            amount: '5200.00',
          },
        });
      });

      const res = await request(server)
        .post(`/api/v1/employees/${ids.report.employeeId}/cost-rates`)
        .set(asCeo())
        .send({ hourlyRate: '700.00', effectiveFrom: '2026-04-15' })
        .expect(201);

      // A backdated rate does not silently restate posted cost.
      expect(res.body.warning).toMatch(/1 cost ledger entries already exist/);
    });
  });

  describe('reporting line', () => {
    it('refuses an employee reporting to themselves', async () => {
      const res = await request(server)
        .patch(`/api/v1/employees/${ids.report.employeeId}`)
        .set(asCeo())
        .send({ managerId: ids.report.employeeId })
        .expect(400);
      expect(res.body.code).toBe('INVALID_MANAGER');
    });

    it('refuses a loop in the reporting line', async () => {
      // Lead already manages Report, so pointing Lead at Report closes a cycle.
      const res = await request(server)
        .patch(`/api/v1/employees/${ids.lead.employeeId}`)
        .set(asCeo())
        .send({ managerId: ids.report.employeeId })
        .expect(400);
      expect(res.body.message).toMatch(/loop/i);
    });
  });

  describe('creating employees', () => {
    it('rejects a duplicate employee code', async () => {
      const res = await request(server)
        .post('/api/v1/employees')
        .set(asCeo())
        .send({
          employeeCode: 'PTC-001',
          firstName: 'Clash',
          lastName: 'Person',
          joiningDate: '2026-10-01',
          officeId: ids.officeNgp,
          attendanceMethod: 'BOTH',
          status: 'ACTIVE',
        })
        .expect(409);
      expect(res.body.code).toBe('DUPLICATE');
    });

    it('rejects an exit date before the joining date', async () => {
      await request(server)
        .post('/api/v1/employees')
        .set(asCeo())
        .send({
          employeeCode: 'PTC-010',
          firstName: 'Time',
          lastName: 'Traveller',
          joiningDate: '2026-10-01',
          exitDate: '2026-09-01',
          officeId: ids.officeNgp,
          attendanceMethod: 'BOTH',
          status: 'ACTIVE',
        })
        .expect(422);
    });

    it('creates an employee with an opening cost rate dated from joining', async () => {
      const res = await request(server)
        .post('/api/v1/employees')
        .set(asCeo())
        .send({
          employeeCode: 'PTC-011',
          firstName: 'Fresh',
          lastName: 'Joiner',
          joiningDate: '2026-10-01',
          officeId: ids.officeRuh,
          attendanceMethod: 'BOTH',
          status: 'ACTIVE',
          hourlyRate: '640.00',
        })
        .expect(201);

      expect(res.body.employeeCode).toBe('PTC-011');
      expect(res.body.costRates).toHaveLength(1);
      expect(res.body.costRates[0].effectiveFrom.slice(0, 10)).toBe('2026-10-01');
    });
  });

  describe('bulk import', () => {
    async function sheet(rows: Array<Record<string, string>>) {
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('Employees');
      ws.columns = [
        { header: 'Employee Code *', key: 'employeeCode' },
        { header: 'First Name *', key: 'firstName' },
        { header: 'Last Name *', key: 'lastName' },
        { header: 'Work Email', key: 'workEmail' },
        { header: 'Joining Date *', key: 'joiningDate' },
        { header: 'Office Code *', key: 'office' },
        { header: 'Department', key: 'department' },
        { header: 'Manager Code', key: 'managerCode' },
        { header: 'Attendance Method', key: 'attendanceMethod' },
        { header: 'Hourly Cost Rate', key: 'hourlyRate' },
      ];
      for (const row of rows) ws.addRow(row);
      return Buffer.from(await workbook.xlsx.writeBuffer());
    }

    it('serves a template that is a readable workbook', async () => {
      const res = await request(server)
        .get('/api/v1/employees/import/template')
        .set(asCeo())
        // supertest parses bodies as text unless told otherwise; an .xlsx is
        // a zip, so it has to come back as a Buffer.
        .responseType('blob')
        .expect(200);

      expect(res.headers['content-disposition']).toMatch(/\.xlsx/);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as unknown as ExcelJS.Buffer);
      const ws = workbook.getWorksheet('Employees')!;
      expect(ws).toBeDefined();
      // Headers only: an example row in the data sheet would have to be
      // skipped on upload, which risks dropping a real employee.
      expect(ws.rowCount).toBe(1);
      expect(workbook.getWorksheet('Notes')).toBeDefined();
    });

    it('reads every data row, including one that matches the documented example', async () => {
      const file = await sheet([
        // These are the template's own example values.
        {
          employeeCode: 'MOR-011',
          firstName: 'Anita',
          lastName: 'Deshpande',
          joiningDate: '2026-10-01',
          office: 'NGP',
        },
      ]);

      const res = await request(server)
        .post('/api/v1/employees/import')
        .set(asCeo())
        .field('dryRun', 'true')
        .attach('file', file, 'people.xlsx')
        .expect(201);

      expect(res.body.totalRows).toBe(1);
      expect(res.body.errors).toHaveLength(0);
    });

    it('reports row-level errors and writes nothing', async () => {
      const before = await request(server).get('/api/v1/employees?pageSize=1').set(asCeo());

      const file = await sheet([
        {
          employeeCode: 'PTC-001',
          firstName: 'Clash',
          lastName: 'X',
          joiningDate: '2026-10-01',
          office: 'NGP',
        },
        {
          employeeCode: 'PTC-020',
          firstName: '',
          lastName: '',
          joiningDate: '31/02/2026',
          office: 'ZZZ',
          attendanceMethod: 'TELEPATHY',
          hourlyRate: 'lots',
        },
        {
          employeeCode: 'PTC-021',
          firstName: 'Dup',
          lastName: 'A',
          joiningDate: '2026-10-01',
          office: 'NGP',
        },
        {
          employeeCode: 'PTC-021',
          firstName: 'Dup',
          lastName: 'B',
          joiningDate: '2026-10-01',
          office: 'NGP',
          managerCode: 'NOPE-1',
        },
      ]);

      const res = await request(server)
        .post('/api/v1/employees/import')
        .set(asCeo())
        .field('dryRun', 'true')
        .attach('file', file, 'people.xlsx')
        .expect(201);

      const byField = res.body.errors.map((e: { field: string }) => e.field);
      expect(res.body.totalRows).toBe(4);
      expect(byField).toEqual(
        expect.arrayContaining([
          'employeeCode', // already exists, and duplicated in-sheet
          'firstName',
          'lastName',
          'joiningDate', // 31 February is not a real date
          'office',
          'attendanceMethod',
          'hourlyRate',
          'managerCode',
        ]),
      );
      expect(res.body.created).toBe(0);

      const after = await request(server).get('/api/v1/employees?pageSize=1').set(asCeo());
      expect(after.body.meta.total).toBe(before.body.meta.total);
    });

    it('refuses to commit a sheet that has any error', async () => {
      const before = await request(server).get('/api/v1/employees?pageSize=1').set(asCeo());

      const file = await sheet([
        {
          employeeCode: 'PTC-030',
          firstName: 'Fine',
          lastName: 'Row',
          joiningDate: '2026-10-01',
          office: 'NGP',
        },
        {
          employeeCode: 'PTC-031',
          firstName: 'Bad',
          lastName: 'Row',
          joiningDate: '2026-10-01',
          office: 'NOPE',
        },
      ]);

      const res = await request(server)
        .post('/api/v1/employees/import')
        .set(asCeo())
        .field('dryRun', 'false')
        .attach('file', file, 'people.xlsx')
        .expect(201);

      // All or nothing: the valid row is not imported either.
      expect(res.body.created).toBe(0);
      const after = await request(server).get('/api/v1/employees?pageSize=1').set(asCeo());
      expect(after.body.meta.total).toBe(before.body.meta.total);
    });

    it('commits a clean sheet and resolves a manager listed further down', async () => {
      const before = await request(server).get('/api/v1/employees?pageSize=1').set(asCeo());

      const file = await sheet([
        // Manager code points at a row that appears *after* this one.
        {
          employeeCode: 'PTC-040',
          firstName: 'Junior',
          lastName: 'One',
          joiningDate: '2026-10-01',
          office: 'NGP',
          department: 'BIM Modelling',
          managerCode: 'PTC-041',
          hourlyRate: '600.00',
        },
        {
          employeeCode: 'PTC-041',
          firstName: 'Senior',
          lastName: 'Two',
          joiningDate: '01/10/2026',
          office: 'RUH',
          attendanceMethod: 'OFFICE',
        },
      ]);

      const res = await request(server)
        .post('/api/v1/employees/import')
        .set(asCeo())
        .field('dryRun', 'false')
        .attach('file', file, 'people.xlsx')
        .expect(201);

      expect(res.body.created).toBe(2);

      const after = await request(server).get('/api/v1/employees?pageSize=50').set(asCeo());
      expect(after.body.meta.total).toBe(before.body.meta.total + 2);

      const junior = after.body.data.find(
        (e: { employeeCode: string }) => e.employeeCode === 'PTC-040',
      );
      const senior = after.body.data.find(
        (e: { employeeCode: string }) => e.employeeCode === 'PTC-041',
      );
      expect(junior.manager.id).toBe(senior.id);
      // Both date formats are accepted.
      expect(senior.joiningDate.slice(0, 10)).toBe('2026-10-01');
      // The opening rate came across too.
      expect(junior.hourlyRate).toBe('600');
    });

    it('rejects a non-xlsx upload', async () => {
      const res = await request(server)
        .post('/api/v1/employees/import')
        .set(asCeo())
        .field('dryRun', 'true')
        .attach('file', Buffer.from('name,code\nA,1'), 'people.csv')
        .expect(400);
      expect(res.body.code).toBe('UNSUPPORTED_FILE');
    });

    it('requires employee.create to import', async () => {
      const file = await sheet([
        {
          employeeCode: 'PTC-050',
          firstName: 'No',
          lastName: 'Access',
          joiningDate: '2026-10-01',
          office: 'NGP',
        },
      ]);
      await request(server)
        .post('/api/v1/employees/import')
        .set(asLead())
        .field('dryRun', 'true')
        .attach('file', file, 'people.xlsx')
        .expect(403);
    });
  });
});
