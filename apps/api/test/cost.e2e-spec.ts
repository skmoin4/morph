import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLES,
  officeLocalToUtc,
  resolveRolePermissions,
} from '@opsvera/shared';
import { AppModule } from '../src/app.module';
import { Clock } from '../src/common/clock';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { runUnscoped } from '../src/prisma/tenant-context';
import { resetDatabase, testPrisma as prisma } from './db';

const PASSWORD = 'Opsvera@2026';
const IST = 'Asia/Kolkata';
const d = (v: string) => new Date(`${v}T00:00:00.000Z`);

const WEEK_1 = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];
const WEEK_2 = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'];

/** Step 12: the cost ledger, budget vs actual, budget alerts, adjustments. */
describe('Cost ledger and budget alerts (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  const fakeNow = officeLocalToUtc('2026-10-09', '11:00', IST);
  const clock = { now: () => fakeNow };

  const who = {
    ceo: { email: 'ceo@co.test', token: '', employeeId: '', userId: '' },
    lead: { email: 'lead@co.test', token: '', employeeId: '', userId: '' },
    pm: { email: 'pm@co.test', token: '', employeeId: '', userId: '' },
    fin: { email: 'fin@co.test', token: '', employeeId: '', userId: '' },
    ann: { email: 'ann@co.test', token: '', employeeId: '', userId: '' },
    bob: { email: 'bob@co.test', token: '', employeeId: '', userId: '' },
  };
  const ids = { companyId: '', p1: '', p2: '', t1: '' };

  beforeAll(async () => {
    await resetDatabase();
    await seed();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('/api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    server = app.getHttpServer();
    for (const key of Object.keys(who) as Array<keyof typeof who>) {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: who[key].email, password: PASSWORD })
        .expect(200);
      who[key].token = res.body.accessToken;
    }
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  const as = (key: keyof typeof who) => ({ Authorization: `Bearer ${who[key].token}` });

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
        data: { name: 'Cost Test Co', codePrefix: 'CTC', fyStartMonth: 4 },
      });
      ids.companyId = company.id;
      const companyId = company.id;
      const office = await prisma.office.create({
        data: {
          companyId,
          name: 'HQ',
          shortCode: 'HQ',
          timezone: IST,
          weeklyOffDays: [0],
          allowedIPs: [],
        },
      });
      await prisma.shift.create({
        data: {
          companyId,
          name: 'General',
          startTime: '09:30',
          endTime: '18:30',
          breakMinutes: 60,
          graceMinutes: 10,
          isDefault: true,
        },
      });
      const client = await prisma.client.create({ data: { companyId, name: 'Test Client' } });
      const type = await prisma.projectType.create({
        data: { companyId, name: 'Hospital', shortCode: 'HOS' },
      });
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
      let n = 0;
      async function person(
        key: keyof typeof who,
        systemKey: string,
        managerId: string | null = null,
      ) {
        n += 1;
        const user = await prisma.user.create({
          data: {
            companyId,
            email: who[key].email,
            passwordHash,
            fullName: key,
            roleId: roleIds[systemKey],
            status: 'ACTIVE',
          },
        });
        const employee = await prisma.employee.create({
          data: {
            companyId,
            userId: user.id,
            employeeCode: `CTC-00${n}`,
            firstName: key,
            lastName: 'Tester',
            joiningDate: d('2024-01-01'),
            officeId: office.id,
            attendanceMethod: 'BOTH',
            managerId,
          },
        });
        who[key].employeeId = employee.id;
        who[key].userId = user.id;
      }
      await person('ceo', 'CEO');
      await person('lead', 'TEAM_LEAD');
      await person('pm', 'PROJECT_MANAGER');
      await person('fin', 'FINANCE');
      await person('ann', 'EMPLOYEE', who.lead.employeeId);
      await person('bob', 'EMPLOYEE', who.lead.employeeId);

      await prisma.employeeCostRate.createMany({
        data: [
          {
            companyId,
            employeeId: who.ann.employeeId,
            hourlyRate: '500.00',
            effectiveFrom: d('2024-01-01'),
          },
          {
            companyId,
            employeeId: who.bob.employeeId,
            hourlyRate: '400.00',
            effectiveFrom: d('2024-01-01'),
          },
        ],
      });

      async function project(code: string, pmId: string | null) {
        const booking = await prisma.booking.create({
          data: {
            companyId,
            bookingNumber: `BKG-${code}`,
            clientId: client.id,
            projectName: code,
            projectTypeId: type.id,
            officeId: office.id,
            bookingDate: d('2026-07-01'),
            projectValue: '1000000.00',
            budgetHours: '100.00',
            expectedStartDate: d('2026-08-01'),
            expectedEndDate: d('2027-03-31'),
            status: 'PROJECT_CREATED',
            generatedProjectCode: code,
          },
        });
        return (
          await prisma.project.create({
            data: {
              companyId,
              projectCode: code,
              name: code,
              bookingId: booking.id,
              clientId: client.id,
              projectTypeId: type.id,
              officeId: office.id,
              projectManagerId: pmId,
              projectValue: '1000000.00',
              budgetHours: '100.00',
            },
          })
        ).id;
      }
      ids.p1 = await project('PJT-1', who.pm.employeeId);
      ids.p2 = await project('PJT-2', null);
      for (const key of ['ann', 'bob'] as const) {
        await prisma.projectMember.create({
          data: { companyId, projectId: ids.p1, employeeId: who[key].employeeId },
        });
      }
      ids.t1 = (
        await prisma.task.create({ data: { companyId, projectId: ids.p1, title: 'Modelling' } })
      ).id;
    });
  }

  // --- helpers --------------------------------------------------------------

  /** Logs 8 h a day on the given days, submits that week, and has the CEO approve it. */
  async function approvedWeek(key: keyof typeof who, days: string[], hoursPerDay = 8) {
    for (const day of days) {
      await request(server)
        .post('/api/v1/time/entries')
        .set(as(key))
        .send({
          projectId: ids.p1,
          taskId: ids.t1,
          workDate: day,
          hours: hoursPerDay,
          isBillable: true,
        })
        .expect(201);
    }
    const weekStart = days[0];
    await request(server)
      .post('/api/v1/timesheets/submit')
      .set(as(key))
      .send({ weekStart })
      .expect(201);
    const sheet = await prisma.timesheet.findFirstOrThrow({
      where: { employeeId: who[key].employeeId, weekStartDate: d(weekStart) },
    });
    await request(server)
      .post(`/api/v1/timesheets/${sheet.id}/decision`)
      .set(as('ceo'))
      .send({ decision: 'APPROVED' })
      .expect(201);
    return sheet.id;
  }
  const summary = (key: keyof typeof who, projectId = ids.p1) =>
    request(server).get(`/api/v1/cost/projects/${projectId}/summary`).set(as(key));
  const ledger = (key: keyof typeof who, qs = '', projectId = ids.p1) =>
    request(server).get(`/api/v1/cost/projects/${projectId}/ledger?pageSize=100${qs}`).set(as(key));
  const adjust = (key: keyof typeof who, body: Record<string, unknown>, projectId = ids.p1) =>
    request(server)
      .post(`/api/v1/cost/projects/${projectId}/adjustments`)
      .set(as(key))
      .send({
        kind: 'LABOUR',
        amount: '1000.00',
        hours: 2,
        postingDate: '2026-10-08',
        description: 'Opening balance correction',
        ...body,
      });
  const alertCount = (key: keyof typeof who, type: string) =>
    prisma.notification.count({
      where: { userId: who[key].userId, type: type as never, entityId: ids.p1 },
    });
  const project = () => prisma.project.findFirstOrThrow({ where: { id: ids.p1 } });

  // =========================================================================

  describe('an empty project', () => {
    it('shows no cost, a zero burn, and a ledger that reconciles', async () => {
      const res = await summary('ceo').expect(200);
      expect(res.body).toMatchObject({
        budgetHours: 100,
        actualHours: 0,
        burnPercent: 0,
        alertLevel: 0,
        actualTotalCost: '0.00',
        reconciled: true,
        series: [],
      });
      expect((await ledger('ceo').expect(200)).body.data).toEqual([]);
    });
  });

  describe('postings from approved timesheets', () => {
    let week1 = '';
    it('appear in the ledger with the rate that explains them', async () => {
      week1 = await approvedWeek('ann', WEEK_1); // 40 h at 500
      const res = await ledger('ceo').expect(200);
      expect(res.body.data).toHaveLength(1);
      const row = res.body.data[0];
      expect(row).toMatchObject({
        sourceType: 'TIMESHEET',
        sourceId: week1,
        sourceLabel: 'Timesheet, week of 2026-09-28',
        hours: 40,
        rateApplied: 500,
        amount: '20000.00',
        isReversal: false,
        postingVersion: 1,
        canReverse: false,
        employee: { fullName: 'ann Tester' },
      });
      expect(row.rateBreakdown).toHaveLength(1);
      expect(res.body.meta).toMatchObject({ netAmount: '20000.00', netHours: 40 });
    });

    it('move the budget vs actual, the burn curve and the per-person split', async () => {
      const res = await summary('ceo').expect(200);
      expect(res.body).toMatchObject({
        actualHours: 40,
        burnPercent: 40,
        hoursRemaining: 60,
        actualLabourCost: '20000.00',
        actualTotalCost: '20000.00',
        marginAmount: '980000.00',
        marginPercent: 98,
        costPerHour: '500.00',
        reconciled: true,
        alertLevel: 0,
      });
      expect(res.body.series).toEqual([{ date: '2026-10-04', hours: 40, cost: '20000.00' }]);
      expect(res.body.byEmployee[0]).toMatchObject({ hours: 40, amount: '20000.00' });
      expect(res.body.bySource.TIMESHEET).toEqual({ hours: 40, amount: '20000.00' });
    });

    it('say nothing below 80 %', async () => {
      expect(await alertCount('pm', 'BUDGET_ALERT_80')).toBe(0);
      expect((await project()).budgetAlertLevel).toBe(0);
    });
  });

  describe('budget alerts', () => {
    let week2 = '';
    it('fire once at 80 %, to the people who watch the project’s cost, and mark it at risk', async () => {
      week2 = await approvedWeek('ann', WEEK_2); // another 40 h: 80 h of 100
      const p = await project();
      expect(p.budgetAlertLevel).toBe(80);
      expect(p.health).toBe('AT_RISK');

      const n = (key: keyof typeof who) => alertCount(key, 'BUDGET_ALERT_80');
      // The project manager, the CEO and Finance can see its cost. Employees and the lead cannot.
      expect([await n('pm'), await n('ceo'), await n('fin')]).toEqual([1, 1, 1]);
      expect([await n('ann'), await n('bob'), await n('lead')]).toEqual([0, 0, 0]);
      const note = await prisma.notification.findFirstOrThrow({
        where: { userId: who.pm.userId, type: 'BUDGET_ALERT_80' },
      });
      expect(note.title).toMatch(/PJT-1 has used 80%/);
      expect(note.linkUrl).toBe(`/projects/${ids.p1}?tab=cost`);
    });

    it('do not repeat while the level holds', async () => {
      // A little more time, still under 100: no second 80 % alert.
      await adjust('fin', { hours: 5, amount: '2500.00' }).expect(201);
      expect(await alertCount('pm', 'BUDGET_ALERT_80')).toBe(1);
      expect((await project()).budgetAlertLevel).toBe(80);
      // Undo it to keep the arithmetic simple for what follows.
      const row = (await ledger('fin', '&sourceType=ADJUSTMENT').expect(200)).body.data[0];
      await request(server)
        .post(`/api/v1/cost/entries/${row.id}/reverse`)
        .set(as('fin'))
        .send({ reason: 'Entered by mistake' })
        .expect(201);
    });

    it('drop with a reopening, and fire again on the next crossing', async () => {
      await request(server)
        .post(`/api/v1/timesheets/${week2}/reopen`)
        .set(as('ceo'))
        .send({ reason: 'Wrong task on Wednesday' })
        .expect(201);
      let p = await project();
      expect(p.budgetAlertLevel).toBe(0);
      // The owner corrects nothing here; she simply sends the same week again.
      await request(server)
        .post('/api/v1/timesheets/submit')
        .set(as('ann'))
        .send({ weekStart: WEEK_2[0] })
        .expect(201);
      expect(p.health).toBe('HEALTHY');
      expect(Number(p.actualHours)).toBe(40);

      await request(server)
        .post(`/api/v1/timesheets/${week2}/decision`)
        .set(as('ceo'))
        .send({ decision: 'APPROVED' })
        .expect(201);
      p = await project();
      expect(p.budgetAlertLevel).toBe(80);
      expect(await alertCount('pm', 'BUDGET_ALERT_80')).toBe(2);
    });

    it('fire at 100 % when a correction takes the project past its budget', async () => {
      await adjust('fin', {
        hours: 25,
        amount: '12500.00',
        description: 'Hours worked before time tracking began',
      }).expect(201);
      const p = await project();
      expect(p.budgetAlertLevel).toBe(100);
      expect(p.health).toBe('CRITICAL');
      expect(Number(p.actualHours)).toBe(105);
      expect([
        await alertCount('pm', 'BUDGET_ALERT_100'),
        await alertCount('ceo', 'BUDGET_ALERT_100'),
      ]).toEqual([1, 1]);
      const res = await summary('pm').expect(200);
      expect(res.body).toMatchObject({ burnPercent: 105, alertLevel: 100, hoursRemaining: -5 });
    });

    it('step back down when that correction is reversed', async () => {
      const row = (await ledger('fin', '&sourceType=ADJUSTMENT').expect(200)).body.data.find(
        (r: { isReversal: boolean; reversed: boolean }) => !r.isReversal && !r.reversed,
      );
      expect(row.canReverse).toBe(true);
      await request(server)
        .post(`/api/v1/cost/entries/${row.id}/reverse`)
        .set(as('fin'))
        .send({ reason: 'Counted twice' })
        .expect(201);
      const p = await project();
      expect(p.budgetAlertLevel).toBe(80);
      expect(p.health).toBe('AT_RISK');
      expect(Number(p.actualHours)).toBe(80);
    });
  });

  describe('adjustments', () => {
    it('are ledger rows: signed, explained, and reversible once', async () => {
      const made = await adjust('fin', {
        kind: 'EXPENSE',
        amount: '3000.00',
        hours: undefined,
        description: 'Courier charges not claimed',
      }).expect(201);
      const p = await project();
      expect(Number(p.actualExpenseCost)).toBe(3000);
      const row = (await ledger('fin', '&sourceType=ADJUSTMENT').expect(200)).body.data.find(
        (r: { id: string }) => r.id === made.body.id,
      );
      expect(row).toMatchObject({
        amount: '3000.00',
        hours: null,
        sourceLabel: 'Adjustment',
        canReverse: true,
        postedBy: 'fin',
      });

      await request(server)
        .post(`/api/v1/cost/entries/${row.id}/reverse`)
        .set(as('fin'))
        .send({ reason: 'x' })
        .expect(422);
      await request(server)
        .post(`/api/v1/cost/entries/${row.id}/reverse`)
        .set(as('fin'))
        .send({ reason: 'Charged to the client directly' })
        .expect(201);
      expect(Number((await project()).actualExpenseCost)).toBe(0);
      const again = await request(server)
        .post(`/api/v1/cost/entries/${row.id}/reverse`)
        .set(as('fin'))
        .send({ reason: 'Trying again' });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('ALREADY_REVERSED');
      const audit = await prisma.auditLog.findFirst({
        where: { entityType: 'CostLedgerEntry', entityId: row.id, action: 'REOPEN' },
      });
      expect(audit?.reason).toMatch(/client directly/);
    });

    it('can be negative (a write-off), but never take a total below zero', async () => {
      await adjust('fin', {
        kind: 'EXPENSE',
        amount: '-500.00',
        hours: undefined,
        description: 'Credit note received',
      }).expect((r) => {
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('WOULD_GO_NEGATIVE');
      });
      // Nothing was written.
      const rows = (await ledger('fin', '&sourceType=ADJUSTMENT').expect(200)).body.data;
      expect(rows.some((r: { amount: string }) => r.amount === '-500.00')).toBe(false);
      const stored = await project();
      expect(Number(stored.actualExpenseCost)).toBe(0);
    });

    it('refuse nonsense', async () => {
      await adjust('fin', { amount: '0' }).expect(422);
      await adjust('fin', { description: 'x' }).expect(422);
      await adjust('fin', { kind: 'EXPENSE', hours: 3 }).expect(422);
      const future = await adjust('fin', { postingDate: '2026-10-10' });
      expect(future.status).toBe(400);
      expect(future.body.details[0].path).toBe('postingDate');
    });

    it('cannot reverse a timesheet posting from here', async () => {
      const row = (await ledger('fin', '&sourceType=TIMESHEET').expect(200)).body.data[0];
      const res = await request(server)
        .post(`/api/v1/cost/entries/${row.id}/reverse`)
        .set(as('fin'))
        .send({ reason: 'Not allowed here' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('NOT_REVERSIBLE');
    });

    it('stay consistent when posted at the same moment', async () => {
      const before = Number((await project()).actualExpenseCost);
      const results = await Promise.all([
        adjust('fin', {
          kind: 'EXPENSE',
          amount: '100.00',
          hours: undefined,
          description: 'Concurrent adjustment one',
        }),
        adjust('fin', {
          kind: 'EXPENSE',
          amount: '200.00',
          hours: undefined,
          description: 'Concurrent adjustment two',
        }),
      ]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect(Number((await project()).actualExpenseCost)).toBe(before + 300);
      expect((await summary('fin').expect(200)).body.reconciled).toBe(true);
    });

    it('reversed twice at once, count once', async () => {
      const made = await adjust('fin', {
        kind: 'EXPENSE',
        amount: '700.00',
        hours: undefined,
        description: 'Raced reversal case',
      }).expect(201);
      const before = Number((await project()).actualExpenseCost);
      const results = await Promise.all([
        request(server)
          .post(`/api/v1/cost/entries/${made.body.id}/reverse`)
          .set(as('fin'))
          .send({ reason: 'First of two clicks' }),
        request(server)
          .post(`/api/v1/cost/entries/${made.body.id}/reverse`)
          .set(as('ceo'))
          .send({ reason: 'Second of two clicks' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(Number((await project()).actualExpenseCost)).toBe(before - 700);
    });
  });

  describe('reconciliation', () => {
    it('notices when a project’s running totals drift from the ledger', async () => {
      const original = (await project()).actualTotalCost;
      await prisma.project.update({
        where: { id: ids.p1 },
        data: { actualTotalCost: { increment: '5.00' } },
      });
      const res = await summary('ceo').expect(200);
      expect(res.body.reconciled).toBe(false);
      expect(res.body.drift.join(' ')).toMatch(/Total cost/);
      await prisma.project.update({ where: { id: ids.p1 }, data: { actualTotalCost: original } });
      expect((await summary('ceo').expect(200)).body.reconciled).toBe(true);
    });

    it('the ledger always adds up to the project’s totals', async () => {
      const p = await project();
      const rows = await prisma.costLedgerEntry.findMany({ where: { projectId: ids.p1 } });
      const sum = rows.reduce((a, r) => a + Number(r.amount), 0);
      expect(sum).toBeCloseTo(Number(p.actualTotalCost), 2);
      const hours = rows.reduce((a, r) => a + Number(r.hours ?? 0), 0);
      expect(hours).toBeCloseTo(Number(p.actualHours), 2);
    });
  });

  describe('reading the ledger', () => {
    it('filters by source and person, with net totals', async () => {
      const ts = await ledger('ceo', '&sourceType=TIMESHEET').expect(200);
      expect(ts.body.data.every((r: { sourceType: string }) => r.sourceType === 'TIMESHEET')).toBe(
        true,
      );
      const mine = await ledger('ceo', `&employeeId=${who.ann.employeeId}`).expect(200);
      expect(
        mine.body.data.every(
          (r: { employee: { id: string } }) => r.employee.id === who.ann.employeeId,
        ),
      ).toBe(true);
      const window = await ledger('ceo', '&from=2026-10-04&to=2026-10-04').expect(200);
      expect(window.body.data.length).toBeGreaterThan(0);
      expect(
        window.body.data.every((r: { postingDate: string }) => r.postingDate === '2026-10-04'),
      ).toBe(true);
      const all = await ledger('ceo').expect(200);
      expect(Number(all.body.meta.netAmount)).toBeCloseTo(
        Number((await project()).actualTotalCost),
        2,
      );
    });

    it('marks a reversed posting and its reversal', async () => {
      const rows = (await ledger('ceo').expect(200)).body.data;
      const reversal = rows.find(
        (r: { isReversal: boolean; sourceType: string }) =>
          r.isReversal && r.sourceType === 'TIMESHEET',
      );
      expect(reversal).toBeTruthy(); // from the reopened week
      expect(reversal.amount.startsWith('-')).toBe(true);
      expect(reversal.reversesId).toBeTruthy();
      const original = rows.find((r: { id: string }) => r.id === reversal.reversesId);
      expect(original.reversed).toBe(true);
    });

    it('pages', async () => {
      const page = await request(server)
        .get(`/api/v1/cost/projects/${ids.p1}/ledger?pageSize=2&page=2`)
        .set(as('ceo'))
        .expect(200);
      expect(page.body.data).toHaveLength(2);
      expect(page.body.meta.totalPages).toBeGreaterThan(1);
    });

    it('exports the ledger to Excel', async () => {
      const res = await request(server)
        .get(`/api/v1/cost/projects/${ids.p1}/export`)
        .set(as('fin'))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-disposition']).toMatch(/cost-ledger-PJT-1\.xlsx/);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as unknown as ArrayBuffer);
      const sheet = workbook.getWorksheet('Cost ledger')!;
      expect(sheet.getRow(1).getCell(1).value).toBe('Posting date');
      const total = (await ledger('fin').expect(200)).body.meta.total;
      expect(sheet.rowCount).toBe(total + 1);
    });
  });

  describe('the overview', () => {
    beforeAll(async () => {
      // PJT-2 has a little cost of its own, so there is something to rank.
      await adjust(
        'fin',
        { amount: '4000.00', hours: 10, description: 'Opening cost for PJT-2' },
        ids.p2,
      ).expect(201);
    });

    it('ranks projects by how close they are to their hours budget', async () => {
      const res = await request(server).get('/api/v1/cost/overview').set(as('ceo')).expect(200);
      expect(res.body.data.map((r: { projectCode: string }) => r.projectCode)).toEqual([
        'PJT-1',
        'PJT-2',
      ]);
      expect(res.body.data[0]).toMatchObject({
        projectCode: 'PJT-1',
        alertLevel: 80,
        health: 'AT_RISK',
      });
      expect(res.body.data[1]).toMatchObject({ burnPercent: 10, alertLevel: 0 });
      expect(res.body.meta).toMatchObject({ total: 2, nearBudget: 1, overBudget: 0 });
      expect(Number(res.body.meta.totalCost)).toBeCloseTo(
        res.body.data.reduce(
          (a: number, r: { actualTotalCost: string }) => a + Number(r.actualTotalCost),
          0,
        ),
        2,
      );
    });

    it('filters by alert level and search', async () => {
      const near = await request(server)
        .get('/api/v1/cost/overview?alert=80')
        .set(as('ceo'))
        .expect(200);
      expect(near.body.data.map((r: { projectCode: string }) => r.projectCode)).toEqual(['PJT-1']);
      const none = await request(server)
        .get('/api/v1/cost/overview?alert=100')
        .set(as('ceo'))
        .expect(200);
      expect(none.body.data).toEqual([]);
      const q = await request(server)
        .get('/api/v1/cost/overview?q=PJT-2')
        .set(as('ceo'))
        .expect(200);
      expect(q.body.data).toHaveLength(1);
    });

    it('shows a project manager only their own project', async () => {
      const res = await request(server).get('/api/v1/cost/overview').set(as('pm')).expect(200);
      expect(res.body.data.map((r: { projectCode: string }) => r.projectCode)).toEqual(['PJT-1']);
      await summary('pm', ids.p2).expect(404);
      await ledger('pm', '', ids.p2).expect(404);
    });

    it('exports to Excel for those who may', async () => {
      const res = await request(server)
        .get('/api/v1/cost/export')
        .set(as('fin'))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as unknown as ArrayBuffer);
      expect(workbook.getWorksheet('Project cost')!.rowCount).toBe(3);
      // Without cost.view there is nothing to export.
      await request(server).get('/api/v1/cost/export').set(as('lead')).expect(403);
    });
  });

  describe('access', () => {
    it('needs a login, and the cost permissions', async () => {
      await request(server).get('/api/v1/cost/overview').expect(401);
      await summary('ann').expect(403);
      await summary('lead').expect(403);
      await request(server).get('/api/v1/cost/overview').set(as('bob')).expect(403);
    });

    it('lets only those with cost.edit adjust or reverse', async () => {
      await adjust('pm', {}).expect(403);
      await adjust('lead', {}).expect(403);
      const row = (await ledger('ceo', '&sourceType=ADJUSTMENT').expect(200)).body.data[0];
      await request(server)
        .post(`/api/v1/cost/entries/${row.id}/reverse`)
        .set(as('pm'))
        .send({ reason: 'Not mine to reverse' })
        .expect(403);
      // A project outside the manager's reach does not exist for them, even to read.
      await request(server)
        .post(`/api/v1/cost/projects/${ids.p2}/adjustments`)
        .set(as('pm'))
        .send({})
        .expect(403);
    });

    it('hides a project’s value and margin from someone without those permissions', async () => {
      const perm = await prisma.permission.findFirstOrThrow({ where: { key: 'margin.view' } });
      const role = await prisma.user.findFirstOrThrow({ where: { email: who.pm.email } });
      const grant = await prisma.rolePermission.findFirstOrThrow({
        where: { roleId: role.roleId, permissionId: perm.id },
      });
      await prisma.rolePermission.delete({ where: { id: grant.id } });
      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: who.pm.email, password: PASSWORD })
        .expect(200);
      const res = await request(server)
        .get(`/api/v1/cost/projects/${ids.p1}/summary`)
        .set({ Authorization: `Bearer ${login.body.accessToken}` })
        .expect(200);
      expect(res.body.marginAmount).toBeUndefined();
      expect(res.body.marginPercent).toBeUndefined();
      expect(res.body.actualTotalCost).toBeDefined();
      await prisma.rolePermission.create({
        data: {
          companyId: ids.companyId,
          roleId: role.roleId,
          permissionId: perm.id,
          dataScope: grant.dataScope,
        },
      });
    });
  });
});
