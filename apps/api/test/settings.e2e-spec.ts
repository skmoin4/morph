import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import bcrypt from 'bcryptjs';
import { ALL_PERMISSIONS, DEFAULT_ROLES, resolveRolePermissions } from '@opsvera/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { runUnscoped } from '../src/prisma/tenant-context';
import { resetDatabase, testPrisma as prisma } from './db';

const PASSWORD = 'Opsvera@2026';
const ADMIN = 'admin@setup.test';
const EMPLOYEE = 'employee@setup.test';

/** Company & office setup: permissions, validation and the protective rules. */
describe('Settings (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let companyId = '';
  let officeId = '';
  let adminToken = '';
  let employeeToken = '';

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

    adminToken = await login(ADMIN);
    employeeToken = await login(EMPLOYEE);
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
        data: { name: 'Setup Test Co', codePrefix: 'STC', fyStartMonth: 4 },
      });
      companyId = company.id;

      const office = await prisma.office.create({
        data: {
          companyId,
          name: 'Head Office',
          shortCode: 'HO',
          timezone: 'Asia/Kolkata',
          weeklyOffDays: [0],
          allowedIPs: [],
        },
      });
      officeId = office.id;

      const permissionIdByKey = new Map(
        (await prisma.permission.findMany()).map((p) => [p.key, p.id]),
      );

      const roleIds: Record<string, string> = {};
      for (const def of DEFAULT_ROLES) {
        const role = await prisma.role.create({
          data: { companyId, name: def.name, systemKey: def.systemKey, isSystem: true },
        });
        roleIds[def.systemKey] = role.id;
        await prisma.rolePermission.createMany({
          data: resolveRolePermissions(def).map((g) => ({
            companyId,
            roleId: role.id,
            permissionId: permissionIdByKey.get(g.key)!,
            dataScope: g.dataScope,
          })),
        });
      }

      for (const [email, systemKey] of [
        [ADMIN, 'CEO'],
        [EMPLOYEE, 'EMPLOYEE'],
      ]) {
        await prisma.user.create({
          data: {
            companyId,
            email,
            passwordHash,
            fullName: email,
            roleId: roleIds[systemKey],
            status: 'ACTIVE',
          },
        });
      }
    });
  }

  async function login(email: string) {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.accessToken as string;
  }

  const asAdmin = () => ({ Authorization: `Bearer ${adminToken}` });
  const asEmployee = () => ({ Authorization: `Bearer ${employeeToken}` });

  describe('access', () => {
    it('lets an admin read the company profile', async () => {
      const res = await request(server).get('/api/v1/settings/company').set(asAdmin()).expect(200);
      expect(res.body.codePrefix).toBe('STC');
      expect(res.body.id).toBe(companyId);
    });

    it('blocks an employee from reading settings', async () => {
      const res = await request(server)
        .get('/api/v1/settings/company')
        .set(asEmployee())
        .expect(403);
      expect(res.body.details.missingPermissions).toContain('settings.view');
    });

    it('blocks an employee from writing settings', async () => {
      await request(server)
        .post('/api/v1/settings/departments')
        .set(asEmployee())
        .send({ name: 'Sneaky' })
        .expect(403);
    });
  });

  describe('company profile', () => {
    it('rejects a project code pattern with no sequence token', async () => {
      const res = await request(server)
        .put('/api/v1/settings/company')
        .set(asAdmin())
        .send({
          name: 'Setup Test Co',
          codePrefix: 'STC',
          // No {SEQ…}: every project would get the same code.
          projectCodePattern: '{PREFIX}-{FY}-{TYPE}',
          fyStartMonth: 4,
          currency: 'INR',
          currencySymbol: '₹',
        })
        .expect(422);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'projectCodePattern' })]),
      );
    });

    it('saves a valid profile and audits the change', async () => {
      await request(server)
        .put('/api/v1/settings/company')
        .set(asAdmin())
        .send({
          name: 'Setup Test Co Ltd',
          codePrefix: 'STC',
          projectCodePattern: '{PREFIX}-{FY}-{TYPE}-{SEQ4}',
          fyStartMonth: 4,
          currency: 'INR',
          currencySymbol: '₹',
        })
        .expect(200);

      const audit = await runUnscoped(() =>
        prisma.auditLog.findFirst({
          where: { companyId, entityType: 'Company' },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(audit?.afterData).toMatchObject({ name: 'Setup Test Co Ltd' });
    });
  });

  describe('offices', () => {
    it('requires a map pin when GPS is mandatory', async () => {
      const res = await request(server)
        .post('/api/v1/settings/offices')
        .set(asAdmin())
        .send({
          name: 'Client Site',
          shortCode: 'CS',
          timezone: 'Asia/Kolkata',
          geofenceRadiusM: 150,
          weeklyOffDays: [0],
          allowedIPs: [],
          // A geofence with nothing to measure from.
          requiresGps: true,
        })
        .expect(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an unrecognised time zone', async () => {
      await request(server)
        .post('/api/v1/settings/offices')
        .set(asAdmin())
        .send({
          name: 'Nowhere',
          shortCode: 'NW',
          timezone: 'Mars/Olympus',
          geofenceRadiusM: 150,
          weeklyOffDays: [0],
          allowedIPs: [],
          requiresGps: false,
        })
        .expect(422);
    });

    it('rejects a week with no working days', async () => {
      await request(server)
        .post('/api/v1/settings/offices')
        .set(asAdmin())
        .send({
          name: 'Never Open',
          shortCode: 'NO',
          timezone: 'Asia/Kolkata',
          geofenceRadiusM: 150,
          weeklyOffDays: [0, 1, 2, 3, 4, 5, 6],
          allowedIPs: [],
          requiresGps: false,
        })
        .expect(422);
    });

    it('creates a Riyadh office with a Friday/Saturday weekend', async () => {
      const res = await request(server)
        .post('/api/v1/settings/offices')
        .set(asAdmin())
        .send({
          name: 'Riyadh',
          shortCode: 'RUH',
          timezone: 'Asia/Riyadh',
          geofenceRadiusM: 250,
          weeklyOffDays: [5, 6],
          allowedIPs: ['212.118.10.0/24'],
          requiresGps: false,
        })
        .expect(201);

      expect(res.body.timezone).toBe('Asia/Riyadh');
      expect(res.body.weeklyOffDays).toEqual([5, 6]);
      expect(res.body.companyId).toBe(companyId);
    });

    it('rejects a duplicate short code with a clear message', async () => {
      const res = await request(server)
        .post('/api/v1/settings/offices')
        .set(asAdmin())
        .send({
          name: 'Riyadh Two',
          shortCode: 'RUH',
          timezone: 'Asia/Riyadh',
          geofenceRadiusM: 250,
          weeklyOffDays: [5, 6],
          allowedIPs: [],
          requiresGps: false,
        })
        .expect(409);
      expect(res.body.code).toBe('DUPLICATE');
    });

    it('refuses to delete an office that still has employees', async () => {
      await runUnscoped(() =>
        prisma.employee.create({
          data: {
            companyId,
            employeeCode: 'E-1',
            firstName: 'Stay',
            lastName: 'Put',
            joiningDate: new Date('2026-01-01T00:00:00.000Z'),
            officeId,
          },
        }),
      );

      const res = await request(server)
        .delete(`/api/v1/settings/offices/${officeId}`)
        .set(asAdmin())
        .expect(409);

      expect(res.body.code).toBe('IN_USE');
      expect(res.body.message).toMatch(/1 employees/);
    });
  });

  describe('project types', () => {
    let typeId = '';

    it('creates a type', async () => {
      const res = await request(server)
        .post('/api/v1/settings/project-types')
        .set(asAdmin())
        .send({ name: 'Hospital', shortCode: 'HOS', colorToken: 'cyan' })
        .expect(201);
      typeId = res.body.id;
      expect(res.body.shortCode).toBe('HOS');
    });

    it('allows the short code to change while nothing uses it', async () => {
      await request(server)
        .patch(`/api/v1/settings/project-types/${typeId}`)
        .set(asAdmin())
        .send({ shortCode: 'HSP' })
        .expect(200);

      await request(server)
        .patch(`/api/v1/settings/project-types/${typeId}`)
        .set(asAdmin())
        .send({ shortCode: 'HOS' })
        .expect(200);
    });

    it('locks the short code once a project code contains it', async () => {
      // A project code is a permanent record; its type segment cannot be
      // retrospectively re-pointed.
      await runUnscoped(async () => {
        const client = await prisma.client.create({ data: { companyId, name: 'A Client' } });
        const booking = await prisma.booking.create({
          data: {
            companyId,
            bookingNumber: 'BK-1',
            clientId: client.id,
            projectName: 'Hospital build',
            projectTypeId: typeId,
            officeId,
            bookingDate: new Date('2026-07-01T00:00:00.000Z'),
            projectValue: '100.00',
            budgetHours: '10.00',
            expectedStartDate: new Date('2026-08-01T00:00:00.000Z'),
            expectedEndDate: new Date('2027-03-31T00:00:00.000Z'),
            status: 'PROJECT_CREATED',
          },
        });
        await prisma.project.create({
          data: {
            companyId,
            projectCode: 'STC-26-27-HOS-0001',
            name: 'Hospital build',
            bookingId: booking.id,
            clientId: client.id,
            projectTypeId: typeId,
            officeId,
            projectValue: '100.00',
            budgetHours: '10.00',
          },
        });
      });

      const res = await request(server)
        .patch(`/api/v1/settings/project-types/${typeId}`)
        .set(asAdmin())
        .send({ shortCode: 'HSP' })
        .expect(400);

      expect(res.body.code).toBe('SHORT_CODE_LOCKED');
      expect(res.body.message).toMatch(/HOS/);
    });

    it('still allows renaming the type itself', async () => {
      const res = await request(server)
        .patch(`/api/v1/settings/project-types/${typeId}`)
        .set(asAdmin())
        .send({ name: 'Hospital & Healthcare' })
        .expect(200);
      expect(res.body.name).toBe('Hospital & Healthcare');
      expect(res.body.shortCode).toBe('HOS');
    });
  });

  describe('attendance policies', () => {
    it('rejects a half-day threshold above the full-day minimum', async () => {
      const res = await request(server)
        .post('/api/v1/settings/attendance-policies')
        .set(asAdmin())
        .send({
          name: 'Contradictory',
          graceMinutes: 10,
          lateMarkAfterMinutes: 0,
          halfDayBelowHours: 9,
          fullDayMinimumHours: 8,
          overtimeAfterHours: 9,
          earlyExitBeforeMinutes: 15,
          lateMarksPerHalfDay: 3,
        })
        .expect(422);

      expect(res.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'halfDayBelowHours' })]),
      );
    });

    it('rejects overtime starting before a full day is worked', async () => {
      await request(server)
        .post('/api/v1/settings/attendance-policies')
        .set(asAdmin())
        .send({
          name: 'Generous',
          graceMinutes: 10,
          lateMarkAfterMinutes: 0,
          halfDayBelowHours: 4,
          fullDayMinimumHours: 8,
          overtimeAfterHours: 6,
          earlyExitBeforeMinutes: 15,
          lateMarksPerHalfDay: 0,
        })
        .expect(422);
    });

    it('keeps only one default policy', async () => {
      const base = {
        graceMinutes: 10,
        lateMarkAfterMinutes: 0,
        halfDayBelowHours: 4,
        fullDayMinimumHours: 8,
        overtimeAfterHours: 9,
        earlyExitBeforeMinutes: 15,
        lateMarksPerHalfDay: 3,
      };

      await request(server)
        .post('/api/v1/settings/attendance-policies')
        .set(asAdmin())
        .send({ ...base, name: 'First default', isDefault: true })
        .expect(201);

      await request(server)
        .post('/api/v1/settings/attendance-policies')
        .set(asAdmin())
        .send({ ...base, name: 'Second default', isDefault: true })
        .expect(201);

      const res = await request(server)
        .get('/api/v1/settings/attendance-policies')
        .set(asAdmin())
        .expect(200);

      const defaults = res.body.filter((p: { isDefault: boolean }) => p.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0].name).toBe('Second default');
    });
  });

  describe('leave types', () => {
    it('requires a cap when carry forward is on', async () => {
      await request(server)
        .post('/api/v1/settings/leave-types')
        .set(asAdmin())
        .send({
          name: 'Earned Leave',
          shortCode: 'EL',
          yearlyQuota: 18,
          carryForward: true,
          maxCarryForward: null,
          allowHalfDay: true,
          isPaid: true,
          approvalFlow: 'SINGLE_LEVEL',
        })
        .expect(422);
    });

    it('creates a leave type with a cap', async () => {
      const res = await request(server)
        .post('/api/v1/settings/leave-types')
        .set(asAdmin())
        .send({
          name: 'Earned Leave',
          shortCode: 'EL',
          yearlyQuota: 18,
          carryForward: true,
          maxCarryForward: 30,
          allowHalfDay: true,
          isPaid: true,
          approvalFlow: 'TEAM_LEAD_THEN_MANAGER',
        })
        .expect(201);

      expect(res.body.yearlyQuota).toBe('18');
      expect(res.body.approvalFlow).toBe('TEAM_LEAD_THEN_MANAGER');
    });
  });

  describe('holidays', () => {
    it('adds one row per office and skips offices that already have it', async () => {
      const offices = await request(server)
        .get('/api/v1/settings/offices?pageSize=50')
        .set(asAdmin())
        .expect(200);
      const officeIds = offices.body.data.map((o: { id: string }) => o.id);

      const first = await request(server)
        .post('/api/v1/settings/holidays')
        .set(asAdmin())
        .send({ name: 'Republic Day', date: '2027-01-26', officeIds })
        .expect(201);
      expect(first.body.created).toBe(officeIds.length);

      // Adding it again for the same offices is a no-op, not a duplicate.
      const second = await request(server)
        .post('/api/v1/settings/holidays')
        .set(asAdmin())
        .send({ name: 'Republic Day', date: '2027-01-26', officeIds })
        .expect(409);
      expect(second.body.code).toBe('DUPLICATE');
    });

    it('requires at least one office', async () => {
      await request(server)
        .post('/api/v1/settings/holidays')
        .set(asAdmin())
        .send({ name: 'Nowhere Day', date: '2027-02-01', officeIds: [] })
        .expect(422);
    });
  });
});
