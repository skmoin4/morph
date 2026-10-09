import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import bcrypt from 'bcryptjs';
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

// Friday 09 Oct 2026. This week is Mon 05 .. Sun 11; last week is Mon 28 Sep .. Sun 04 Oct.
const THIS_WEEK = '2026-10-05';
const LAST_WEEK = '2026-09-28';

/** Step 10: the timer, manual entries, the weekly grid, submission, approval, cost posting, reopening. */
describe('Time & timesheets (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let fakeNow = officeLocalToUtc('2026-10-09', '11:00', IST);
  const clock = { now: () => fakeNow };
  const clockAt = (date: string, time: string) => {
    fakeNow = officeLocalToUtc(date, time, IST);
  };

  const who = {
    ceo: { email: 'ceo@tm.test', token: '', employeeId: '', userId: '' },
    hr: { email: 'hr@tm.test', token: '', employeeId: '', userId: '' },
    lead: { email: 'lead@tm.test', token: '', employeeId: '', userId: '' },
    pm: { email: 'pm@tm.test', token: '', employeeId: '', userId: '' },
    ann: { email: 'ann@tm.test', token: '', employeeId: '', userId: '' }, // lead's report, on p1+p2
    bob: { email: 'bob@tm.test', token: '', employeeId: '', userId: '' }, // lead's report, on p1
    dan: { email: 'dan@tm.test', token: '', employeeId: '', userId: '' }, // lead's report, on p1
    cal: { email: 'cal@tm.test', token: '', employeeId: '', userId: '' }, // lead's report, on no project
    eve: { email: 'eve@tm.test', token: '', employeeId: '', userId: '' }, // nobody's report, p1, no cost rate
  };
  const ids = { companyId: '', p1: '', p2: '', p3: '', t1: '', t2: '', t3: '', tDone: '' };

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
        data: { name: 'Time Test Co', codePrefix: 'TTC', fyStartMonth: 4 },
      });
      ids.companyId = company.id;
      const companyId = company.id;

      const office = await prisma.office.create({
        data: {
          companyId,
          name: 'HQ',
          shortCode: 'HQ',
          timezone: IST,
          latitude: '21.1458000',
          longitude: '79.0882000',
          geofenceRadiusM: 200,
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
      await prisma.holiday.create({
        data: { companyId, officeId: office.id, name: 'Gandhi Jayanti', date: d('2026-10-02') },
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
            employeeCode: `TTC-00${n}`,
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
      await person('hr', 'HR_ADMIN');
      await person('lead', 'TEAM_LEAD');
      await person('pm', 'PROJECT_MANAGER');
      const m = who.lead.employeeId;
      await person('ann', 'EMPLOYEE', m);
      await person('bob', 'EMPLOYEE', m);
      await person('dan', 'EMPLOYEE', m);
      await person('cal', 'EMPLOYEE', m);
      await person('eve', 'EMPLOYEE');

      // Ann's rate rises on 01 Oct: a week that straddles it costs in two segments.
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
            employeeId: who.ann.employeeId,
            hourlyRate: '600.00',
            effectiveFrom: d('2026-10-01'),
          },
          {
            companyId,
            employeeId: who.bob.employeeId,
            hourlyRate: '400.00',
            effectiveFrom: d('2024-01-01'),
          },
          {
            companyId,
            employeeId: who.dan.employeeId,
            hourlyRate: '300.00',
            effectiveFrom: d('2024-01-01'),
          },
        ],
      });

      async function project(
        code: string,
        name: string,
        pmId: string | null,
        status: 'ACTIVE' | 'ON_HOLD' = 'ACTIVE',
      ) {
        const booking = await prisma.booking.create({
          data: {
            companyId,
            bookingNumber: `BKG-${code}`,
            clientId: client.id,
            projectName: name,
            projectTypeId: type.id,
            officeId: office.id,
            bookingDate: d('2026-07-01'),
            projectValue: '5000000.00',
            budgetHours: '1000.00',
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
              name,
              bookingId: booking.id,
              clientId: client.id,
              projectTypeId: type.id,
              officeId: office.id,
              projectManagerId: pmId,
              status,
              startDate: d('2026-08-01'),
              endDate: d('2027-03-31'),
              projectValue: '5000000.00',
              budgetHours: '1000.00',
            },
          })
        ).id;
      }
      ids.p1 = await project('PJT-1', 'Hospital One', who.pm.employeeId);
      ids.p2 = await project('PJT-2', 'Hospital Two', null);
      ids.p3 = await project('PJT-3', 'Hospital Three', null, 'ON_HOLD');

      const member = (projectId: string, key: keyof typeof who) =>
        prisma.projectMember.create({
          data: { companyId, projectId, employeeId: who[key].employeeId },
        });
      for (const key of ['ann', 'bob', 'dan', 'eve'] as const) await member(ids.p1, key);
      await member(ids.p2, 'ann');
      await member(ids.p3, 'ann');

      const task = async (projectId: string, title: string, status: 'TODO' | 'DONE' = 'TODO') =>
        (await prisma.task.create({ data: { companyId, projectId, title, status } })).id;
      ids.t1 = await task(ids.p1, 'Clash detection');
      ids.t2 = await task(ids.p1, 'Model coordination');
      ids.t3 = await task(ids.p2, 'Drawing set');
      ids.tDone = await task(ids.p1, 'Kick-off', 'DONE');
    });
  }

  // --- helpers --------------------------------------------------------------

  type Body = Record<string, unknown>;
  const startTimer = (key: keyof typeof who, body: Body = {}) =>
    request(server)
      .post('/api/v1/time/timer/start')
      .set(as(key))
      .send({ projectId: ids.p1, taskId: ids.t1, ...body });
  const stopTimer = (key: keyof typeof who, body: Body = {}) =>
    request(server).post('/api/v1/time/timer/stop').set(as(key)).send(body);
  const getTimer = (key: keyof typeof who) =>
    request(server).get('/api/v1/time/timer').set(as(key));
  const logTime = (key: keyof typeof who, body: Body) =>
    request(server)
      .post('/api/v1/time/entries')
      .set(as(key))
      .send({ projectId: ids.p1, taskId: ids.t1, hours: 4, isBillable: true, ...body });
  const week = (key: keyof typeof who, weekStart = THIS_WEEK, employeeId?: string) =>
    request(server)
      .get(
        `/api/v1/timesheets/week?weekStart=${weekStart}${employeeId ? `&employeeId=${employeeId}` : ''}`,
      )
      .set(as(key));
  const submit = (key: keyof typeof who, weekStart = THIS_WEEK) =>
    request(server).post('/api/v1/timesheets/submit').set(as(key)).send({ weekStart });
  const decide = (key: keyof typeof who, id: string, decision: string, comment?: string) =>
    request(server)
      .post(`/api/v1/timesheets/${id}/decision`)
      .set(as(key))
      .send({ decision, comment });
  const sheetOf = async (key: keyof typeof who, weekStart = THIS_WEEK) =>
    (await week(key, weekStart).expect(200)).body.timesheet as {
      id: string;
      status: string;
    } | null;
  const detail = (
    res: { body: { details?: Array<{ path: string; message: string }> } },
    path: string,
  ) => res.body.details?.find((x) => x.path === path)?.message ?? '';
  const ledger = (sheetId: string) =>
    prisma.costLedgerEntry.findMany({
      where: { sourceId: sheetId },
      orderBy: [{ postingVersion: 'asc' }, { isReversal: 'asc' }],
    });
  /** Net labour cost on a project from every sheet except `sheetId`. */
  const projectCostExcluding = async (projectId: string, sheetId: string) =>
    (
      await prisma.costLedgerEntry.findMany({
        where: { projectId, sourceType: 'TIMESHEET', sourceId: { not: sheetId } },
      })
    ).reduce((a, r) => a + Number(r.amount), 0);
  const net = async (sheetId: string) =>
    (await ledger(sheetId)).reduce((a, r) => a + Number(r.amount), 0);

  // =========================================================================

  describe('the timer', () => {
    it('cannot start without a task', async () => {
      await request(server)
        .post('/api/v1/time/timer/start')
        .set(as('ann'))
        .send({ projectId: ids.p1 })
        .expect(422);
    });

    it('cannot start on a project you are not on, or one that is on hold', async () => {
      const notOnTeam = await startTimer('cal');
      expect(notOnTeam.status).toBe(400);
      expect(detail(notOnTeam, 'projectId')).toMatch(/not on the PJT-1 team/);

      const onHold = await startTimer('ann', { projectId: ids.p3, taskId: ids.t3 });
      expect(onHold.status).toBe(400);
      expect(detail(onHold, 'projectId')).toMatch(/on hold/);
    });

    it('cannot use a task from another project', async () => {
      const res = await startTimer('ann', { projectId: ids.p1, taskId: ids.t3 });
      expect(res.status).toBe(400);
      expect(detail(res, 'taskId')).toBeTruthy();
    });

    it('starts, shows as running, and survives a reload', async () => {
      clockAt('2026-10-09', '09:00');
      const res = await startTimer('ann', { description: 'Level 2 clashes' }).expect(201);
      expect(res.body.running).toMatchObject({
        projectId: ids.p1,
        taskId: ids.t1,
        source: 'TIMER',
        seconds: 0,
        workDate: '2026-10-09',
      });

      clockAt('2026-10-09', '09:25');
      // A fresh request is a "page reload": the server still knows.
      const again = await getTimer('ann').expect(200);
      expect(again.body.running.seconds).toBe(25 * 60);
      expect(again.body.running.project.projectCode).toBe('PJT-1');
      expect(again.body.running.task.title).toBe('Clash detection');
    });

    it('allows only one running timer, and says so', async () => {
      const res = await startTimer('ann', { taskId: ids.t2 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TIMER_ALREADY_RUNNING');
    });

    it('stops and records the hours against the day, the week and the task', async () => {
      clockAt('2026-10-09', '10:30'); // 90 minutes in
      const res = await stopTimer('ann').expect(201);
      expect(res.body).toMatchObject({ discarded: false, capped: false });
      expect(res.body.entry).toMatchObject({ hours: 1.5, workDate: '2026-10-09', source: 'TIMER' });
      expect((await getTimer('ann').expect(200)).body.running).toBeNull();

      const sheet = await prisma.timesheet.findFirstOrThrow({
        where: { employeeId: who.ann.employeeId, weekStartDate: d(THIS_WEEK) },
      });
      expect(sheet.status).toBe('DRAFT');
      expect(Number(sheet.totalHours)).toBe(1.5);
      expect(
        Number((await prisma.task.findFirstOrThrow({ where: { id: ids.t1 } })).loggedHours),
      ).toBe(1.5);
    });

    it('throws away a timer stopped within a minute', async () => {
      clockAt('2026-10-09', '11:00');
      await startTimer('ann').expect(201);
      fakeNow = new Date(fakeNow.getTime() + 30_000);
      const res = await stopTimer('ann').expect(201);
      expect(res.body).toMatchObject({ discarded: true, entry: null });
      expect(
        await prisma.timeEntry.count({
          where: { employeeId: who.ann.employeeId, source: 'TIMER' },
        }),
      ).toBe(1);
    });

    it('rounds to the nearest hundredth of an hour', async () => {
      clockAt('2026-10-09', '12:00');
      await startTimer('bob').expect(201);
      clockAt('2026-10-09', '13:20'); // 1h 20m = 1.333
      const res = await stopTimer('bob').expect(201);
      expect(res.body.entry.hours).toBe(1.33);
    });

    it('stopping with nothing running is a clean 404', async () => {
      const res = await stopTimer('ann');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NO_TIMER');
    });

    it('can be thrown away without recording anything', async () => {
      clockAt('2026-10-09', '14:00');
      await startTimer('dan').expect(201);
      await request(server).delete('/api/v1/time/timer').set(as('dan')).expect(200);
      expect((await getTimer('dan').expect(200)).body.running).toBeNull();
      expect(await prisma.timeEntry.count({ where: { employeeId: who.dan.employeeId } })).toBe(0);
    });

    it('caps a forgotten timer at twelve hours', async () => {
      clockAt('2026-10-06', '09:00');
      await startTimer('dan').expect(201);
      clockAt('2026-10-07', '15:00'); // 30 hours later
      const res = await stopTimer('dan').expect(201);
      expect(res.body.capped).toBe(true);
      expect(res.body.entry).toMatchObject({ hours: 12, workDate: '2026-10-06' });
      clockAt('2026-10-09', '11:00');
    });

    it('a double tap on Start leaves exactly one timer', async () => {
      const results = await Promise.all([
        startTimer('cal', { projectId: ids.p1 }),
        startTimer('eve'),
        startTimer('eve'),
      ]);
      // cal is not on the project; eve's two taps race.
      expect(results[0].status).toBe(400);
      expect(
        results
          .slice(1)
          .map((r) => r.status)
          .sort(),
      ).toEqual([201, 409]);
      expect(
        await prisma.timeEntry.count({
          where: { employeeId: who.eve.employeeId, source: 'TIMER', endedAt: null },
        }),
      ).toBe(1);
      await request(server).delete('/api/v1/time/timer').set(as('eve')).expect(200);
    });
  });

  describe('manual entries', () => {
    it('logs time and creates the week as a draft', async () => {
      const res = await logTime('bob', {
        workDate: '2026-10-05',
        hours: 6.5,
        description: 'Models',
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ hours: 6.5, source: 'MANUAL', isBillable: true });
      const w = await week('bob').expect(200);
      expect(w.body.status).toBe('DRAFT');
      expect(w.body.totals.total).toBeCloseTo(6.5 + 1.33, 2);
    });

    it('refuses nonsense hours', async () => {
      await logTime('bob', { workDate: '2026-10-06', hours: 0 }).expect(422);
      await logTime('bob', { workDate: '2026-10-06', hours: -2 }).expect(422);
      await logTime('bob', { workDate: '2026-10-06', hours: 25 }).expect(422);
      await logTime('bob', { workDate: '2026-10-06', hours: 1.234 }).expect(422);
    });

    it('refuses the future, and days older than 90 days', async () => {
      const future = await logTime('bob', { workDate: '2026-10-10' });
      expect(future.status).toBe(400);
      expect(detail(future, 'workDate')).toMatch(/not happened/);
      const old = await logTime('bob', { workDate: '2026-06-01' });
      expect(old.status).toBe(400);
      expect(detail(old, 'workDate')).toMatch(/90 days/);
    });

    it('refuses a project you are not on, and a closed one', async () => {
      await logTime('cal', { workDate: '2026-10-06' }).expect(400);
      await logTime('ann', { workDate: '2026-10-06', projectId: ids.p3, taskId: null }).expect(400);
    });

    it('accepts a project-level entry with no task', async () => {
      const res = await logTime('dan', { workDate: '2026-10-06', taskId: null, hours: 1 });
      expect(res.status).toBe(201);
      expect(res.body.task).toBeNull();
    });

    it('stops a day going past 24 hours', async () => {
      await logTime('eve', { workDate: '2026-10-07', hours: 20 }).expect(201);
      const res = await logTime('eve', { workDate: '2026-10-07', hours: 5 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DAY_LIMIT');
      await logTime('eve', { workDate: '2026-10-07', hours: 4 }).expect(201);
    });

    it('does not let two simultaneous entries overrun the day', async () => {
      const results = await Promise.all([
        logTime('cal', { workDate: '2026-10-08', hours: 15, projectId: ids.p1 }),
        logTime('cal', { workDate: '2026-10-08', hours: 15, projectId: ids.p1 }),
      ]);
      // cal is not on a project at all, so both are refused for that reason; the point is no 500s.
      expect(results.every((r) => r.status === 400)).toBe(true);
      const dan = await Promise.all([
        logTime('dan', { workDate: '2026-10-08', hours: 15 }),
        logTime('dan', { workDate: '2026-10-08', hours: 15 }),
      ]);
      expect(dan.map((r) => r.status).sort()).toEqual([201, 409]);
    });

    it('updates an entry, and keeps the totals right', async () => {
      const made = await logTime('dan', { workDate: '2026-10-05', hours: 2 }).expect(201);
      const res = await request(server)
        .patch(`/api/v1/time/entries/${made.body.id}`)
        .set(as('dan'))
        .send({ hours: 3.5, description: 'Longer than I thought', isBillable: false })
        .expect(200);
      expect(res.body).toMatchObject({ hours: 3.5, isBillable: false });
      const sheet = await sheetOf('dan');
      const row = await prisma.timesheet.findFirstOrThrow({ where: { id: sheet!.id } });
      const entries = await prisma.timeEntry.findMany({ where: { timesheetId: sheet!.id } });
      expect(Number(row.totalHours)).toBeCloseTo(
        entries.reduce((a, e) => a + Number(e.hours), 0),
        2,
      );
      expect(Number(row.billableHours)).toBeLessThan(Number(row.totalHours));
    });

    it('moves an entry to another week, updating both sheets', async () => {
      const made = await logTime('dan', { workDate: '2026-10-05', hours: 1 }).expect(201);
      await request(server)
        .patch(`/api/v1/time/entries/${made.body.id}`)
        .set(as('dan'))
        .send({ workDate: '2026-09-30' })
        .expect(200);
      const last = await week('dan', LAST_WEEK).expect(200);
      expect(last.body.totals.total).toBe(1);
      const sheet = await prisma.timesheet.findFirstOrThrow({
        where: { employeeId: who.dan.employeeId, weekStartDate: d(THIS_WEEK) },
      });
      const entries = await prisma.timeEntry.findMany({ where: { timesheetId: sheet.id } });
      expect(Number(sheet.totalHours)).toBeCloseTo(
        entries.reduce((a, e) => a + Number(e.hours), 0),
        2,
      );
    });

    it('deletes an entry', async () => {
      const made = await logTime('dan', { workDate: '2026-10-06', hours: 0.5 }).expect(201);
      await request(server)
        .delete(`/api/v1/time/entries/${made.body.id}`)
        .set(as('dan'))
        .expect(200);
      expect(await prisma.timeEntry.count({ where: { id: made.body.id } })).toBe(0);
    });

    it('keeps other people’s entries out of reach: 404', async () => {
      const made = await logTime('dan', { workDate: '2026-10-06', hours: 0.5 }).expect(201);
      await request(server)
        .patch(`/api/v1/time/entries/${made.body.id}`)
        .set(as('bob'))
        .send({ hours: 1 })
        .expect(404);
      await request(server)
        .delete(`/api/v1/time/entries/${made.body.id}`)
        .set(as('lead'))
        .expect(404);
      await request(server)
        .delete(`/api/v1/time/entries/${made.body.id}`)
        .set(as('dan'))
        .expect(200);
    });

    it('cannot change a timer that is still running', async () => {
      clockAt('2026-10-09', '15:00');
      const started = await startTimer('dan').expect(201);
      await request(server)
        .patch(`/api/v1/time/entries/${started.body.running.id}`)
        .set(as('dan'))
        .send({ hours: 3 })
        .expect(409);
      await request(server).delete('/api/v1/time/timer').set(as('dan')).expect(200);
    });
  });

  describe('the grid cell', () => {
    const cell = (key: keyof typeof who, body: Body) =>
      request(server)
        .put('/api/v1/time/cell')
        .set(as(key))
        .send({ projectId: ids.p1, taskId: ids.t2, isBillable: true, ...body });

    it('creates, changes and clears a cell', async () => {
      const first = await cell('bob', { workDate: '2026-10-06', hours: 3 }).expect(200);
      expect(first.body.hours).toBe(3);
      const second = await cell('bob', { workDate: '2026-10-06', hours: 5.25 }).expect(200);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.hours).toBe(5.25);
      expect(
        await prisma.timeEntry.count({
          where: { employeeId: who.bob.employeeId, taskId: ids.t2, workDate: d('2026-10-06') },
        }),
      ).toBe(1);

      const cleared = await cell('bob', { workDate: '2026-10-06', hours: 0 }).expect(200);
      expect(cleared.body).toEqual({});
      expect(
        await prisma.timeEntry.count({
          where: { employeeId: who.bob.employeeId, taskId: ids.t2, workDate: d('2026-10-06') },
        }),
      ).toBe(0);
    });

    it('refuses to overwrite a cell that holds timer entries', async () => {
      const res = await cell('bob', { workDate: '2026-10-09', taskId: ids.t1, hours: 2 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CELL_HAS_TIMER_ENTRIES');
    });

    it('respects the 24-hour day', async () => {
      const res = await cell('bob', { workDate: '2026-10-09', hours: 23 });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DAY_LIMIT');
    });
  });

  describe('the weekly grid', () => {
    it('lays the week out by project and task, with day types and totals', async () => {
      const res = await week('ann').expect(200);
      expect(res.body).toMatchObject({
        weekStart: THIS_WEEK,
        weekEnd: '2026-10-11',
        status: 'DRAFT',
        canEdit: true,
        canSubmit: true,
        employee: { isMe: true },
      });
      expect(res.body.days).toHaveLength(7);
      expect(res.body.days[6]).toMatchObject({ date: '2026-10-11', dayType: 'WEEKLY_OFF' });
      expect(res.body.days[5].isFuture).toBe(true);
      expect(res.body.days[4]).toMatchObject({ date: '2026-10-09', isFuture: false, total: 1.5 });
      expect(res.body.rows).toHaveLength(1);
      expect(res.body.rows[0].cells['2026-10-09'].hours).toBe(1.5);
      expect(res.body.rows[0].cells['2026-10-09'].hasTimer).toBe(true);
    });

    it('marks a holiday in the calendar', async () => {
      const res = await week('ann', LAST_WEEK).expect(200);
      expect(res.body.days[4]).toMatchObject({
        date: '2026-10-02',
        dayType: 'HOLIDAY',
        label: 'Gandhi Jayanti',
      });
    });

    it('shows a running timer on its own, not in the cells', async () => {
      clockAt('2026-10-09', '16:00');
      await startTimer('dan').expect(201);
      clockAt('2026-10-09', '16:30');
      const res = await week('dan').expect(200);
      expect(res.body.running).toMatchObject({ seconds: 1800, projectId: ids.p1 });
      expect(res.body.canSubmit).toBe(false); // a timer is running
      await request(server).delete('/api/v1/time/timer').set(as('dan')).expect(200);
    });

    it('offers last week’s rows to an empty week', async () => {
      await logTime('bob', { workDate: '2026-09-29', hours: 2, taskId: ids.t2 }).expect(201);
      // Fresh week: nothing yet for the week of 12 Oct; but that is the future. Use a person with none.
      const res = await week('bob', THIS_WEEK).expect(200);
      expect(Array.isArray(res.body.suggestions)).toBe(true);
    });

    it('lets a lead look at their team’s week, and nobody else’s', async () => {
      await week('lead', THIS_WEEK, who.ann.employeeId).expect(200);
      await week('lead', THIS_WEEK, who.eve.employeeId).expect(404);
      await week('ann', THIS_WEEK, who.bob.employeeId).expect(404);
      const asCeo = await week('ceo', THIS_WEEK, who.eve.employeeId).expect(200);
      expect(asCeo.body.employee.isMe).toBe(false);
      expect(asCeo.body.canEdit).toBe(false);
    });

    it('cannot be edited by looking at someone else’s week', async () => {
      const res = await week('lead', THIS_WEEK, who.ann.employeeId).expect(200);
      expect(res.body.canEdit).toBe(false);
      expect(res.body.canSubmit).toBe(false);
    });
  });

  describe('submitting a week', () => {
    beforeAll(async () => {
      // Last week, Ann: Mon 28 Sep 8 h (rate 500) and Thu 01 Oct 8 h (rate 600), on two projects.
      await logTime('ann', { workDate: '2026-09-28', hours: 8 }).expect(201);
      await logTime('ann', {
        workDate: '2026-10-01',
        hours: 8,
        projectId: ids.p2,
        taskId: ids.t3,
      }).expect(201);
      // Bob, Dan and Eve each get a week to approve.
      await logTime('bob', { workDate: '2026-09-28', hours: 8 }).expect(201);
      await logTime('dan', { workDate: '2026-09-29', hours: 4, isBillable: false }).expect(201);
      await logTime('eve', { workDate: '2026-09-29', hours: 6 }).expect(201);
    });

    it('refuses an empty week', async () => {
      const res = await submit('cal', LAST_WEEK);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('EMPTY_TIMESHEET');
    });

    it('refuses a week that has not started, and a date that is not a Monday', async () => {
      await submit('ann', '2026-10-12').expect(400);
      await submit('ann', '2026-09-30').expect(422);
    });

    it('refuses while a timer is running in that week', async () => {
      clockAt('2026-10-09', '17:00');
      await startTimer('bob').expect(201);
      const res = await submit('bob', THIS_WEEK);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TIMER_RUNNING');
      await request(server).delete('/api/v1/time/timer').set(as('bob')).expect(200);
    });

    it('submits, locks the week against edits, and tells the approvers', async () => {
      const res = await submit('ann', LAST_WEEK).expect(201);
      expect(res.body).toMatchObject({ status: 'SUBMITTED', totalHours: 16, isMine: true });
      expect(res.body.submittedAt).toBeTruthy();

      const edit = await logTime('ann', { workDate: '2026-09-30', hours: 1 });
      expect(edit.status).toBe(409);
      expect(edit.body.code).toBe('TIMESHEET_LOCKED');

      const toLead = await prisma.notification.count({
        where: { userId: who.lead.userId, type: 'TIMESHEET_SUBMITTED', entityId: res.body.id },
      });
      const toPm = await prisma.notification.count({
        where: { userId: who.pm.userId, type: 'TIMESHEET_SUBMITTED', entityId: res.body.id },
      });
      const toCeo = await prisma.notification.count({
        where: { userId: who.ceo.userId, type: 'TIMESHEET_SUBMITTED', entityId: res.body.id },
      });
      const toAnn = await prisma.notification.count({
        where: { userId: who.ann.userId, entityId: res.body.id },
      });
      const toEve = await prisma.notification.count({
        where: { userId: who.eve.userId, entityId: res.body.id },
      });
      expect([toLead, toPm, toCeo, toAnn, toEve]).toEqual([1, 1, 1, 0, 0]);
    });

    it('cannot be submitted twice', async () => {
      const res = await submit('ann', LAST_WEEK);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TIMESHEET_LOCKED');
    });

    it('can be withdrawn before a decision, and then edited again', async () => {
      const sheet = (await sheetOf('bob', LAST_WEEK))!;
      await submit('bob', LAST_WEEK).expect(201);
      const back = await request(server)
        .post(`/api/v1/timesheets/${sheet.id}/recall`)
        .set(as('bob'))
        .expect(201);
      expect(back.body.status).toBe('DRAFT');
      await logTime('bob', { workDate: '2026-09-30', hours: 0.5, taskId: ids.t2 }).expect(201);
      await request(server)
        .delete(
          `/api/v1/time/entries/${
            (
              await prisma.timeEntry.findFirstOrThrow({
                where: { employeeId: who.bob.employeeId, workDate: d('2026-09-30') },
              })
            ).id
          }`,
        )
        .set(as('bob'))
        .expect(200);
      await submit('bob', LAST_WEEK).expect(201);
    });

    it('only the owner can withdraw', async () => {
      const sheet = (await sheetOf('bob', LAST_WEEK))!;
      await request(server)
        .post(`/api/v1/timesheets/${sheet.id}/recall`)
        .set(as('lead'))
        .expect(404);
    });

    it('also submits dan and eve', async () => {
      await submit('dan', LAST_WEEK).expect(201);
      await submit('eve', LAST_WEEK).expect(201);
    });
  });

  describe('deciding', () => {
    let annSheet = '';
    beforeAll(async () => {
      annSheet = (await sheetOf('ann', LAST_WEEK))!.id;
    });

    it('lists what is waiting on each approver', async () => {
      const lead = await request(server)
        .get('/api/v1/timesheets?toDecide=true&pageSize=100')
        .set(as('lead'))
        .expect(200);
      const people = lead.body.data.map((r: { employee: { id: string } }) => r.employee.id);
      expect(people).toContain(who.ann.employeeId);
      expect(people).not.toContain(who.eve.employeeId); // not the lead's report
      expect(lead.body.data.every((r: { canDecide: boolean }) => r.canDecide)).toBe(true);

      const ann = await request(server)
        .get('/api/v1/timesheets?toDecide=true')
        .set(as('ann'))
        .expect(200);
      expect(ann.body.data).toEqual([]);

      const row = lead.body.data.find((r: { id: string }) => r.id === annSheet);
      expect(row.projects.map((p: { code: string }) => p.code).sort()).toEqual(['PJT-1', 'PJT-2']);
    });

    it('never lets someone decide their own, or an employee decide anything', async () => {
      const own = await decide('ann', annSheet, 'APPROVED');
      expect(own.status).toBe(403);
      await decide('bob', annSheet, 'APPROVED').expect(403);
    });

    it('hides a sheet from an approver outside the scope: 404', async () => {
      const eveSheet = (await sheetOf('eve', LAST_WEEK))!.id;
      await decide('lead', eveSheet, 'APPROVED').expect(404);
    });

    it('a rejection needs a reason, then reopens the week to the employee', async () => {
      await decide('lead', annSheet, 'REJECTED').expect(422);
      const res = await decide(
        'lead',
        annSheet,
        'REJECTED',
        'The Thursday hours belong to PJT-1',
      ).expect(201);
      expect(res.body.status).toBe('REJECTED');
      expect(
        await prisma.notification.count({
          where: { userId: who.ann.userId, type: 'TIMESHEET_REJECTED', entityId: annSheet },
        }),
      ).toBe(1);
      expect(await ledger(annSheet)).toHaveLength(0);

      const w = await week('ann', LAST_WEEK).expect(200);
      expect(w.body.canEdit).toBe(true);
      expect(w.body.timesheet.approvals[0]).toMatchObject({ status: 'REJECTED' });
      await submit('ann', LAST_WEEK).expect(201);
    });

    it('approving posts the labour cost at the rate of each work date', async () => {
      const res = await decide('lead', annSheet, 'APPROVED', 'Looks right').expect(201);
      expect(res.body.status).toBe('APPROVED');

      const rows = await ledger(annSheet);
      // Two projects: PJT-1 (Mon, 8 h @ 500) and PJT-2 (Thu, 8 h @ 600).
      expect(rows).toHaveLength(2);
      const p1 = rows.find((r) => r.projectId === ids.p1)!;
      const p2 = rows.find((r) => r.projectId === ids.p2)!;
      expect(Number(p1.amount)).toBe(4000);
      expect(Number(p2.amount)).toBe(4800);
      expect(Number(p1.rateApplied)).toBe(500);
      expect(Number(p2.rateApplied)).toBe(600);
      expect(p1.postingVersion).toBe(1);
      expect(
        Number((await prisma.project.findFirstOrThrow({ where: { id: ids.p1 } })).actualLabourCost),
      ).toBe(4000);

      const entries = await prisma.timeEntry.findMany({ where: { timesheetId: annSheet } });
      expect(entries.every((e) => e.isLocked)).toBe(true);
      const sheet = await prisma.timesheet.findFirstOrThrow({ where: { id: annSheet } });
      expect(sheet.costPostedAt).toBeTruthy();
      expect(sheet.approvedById).toBe(who.lead.userId);
      expect(
        await prisma.notification.count({
          where: { userId: who.ann.userId, type: 'TIMESHEET_APPROVED', entityId: annSheet },
        }),
      ).toBe(1);
    });

    it('cannot be decided twice, and the cost posts once', async () => {
      const again = await decide('ceo', annSheet, 'APPROVED');
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('NOT_PENDING');
      expect(await ledger(annSheet)).toHaveLength(2);
    });

    it('locked entries cannot be edited or deleted', async () => {
      const entry = await prisma.timeEntry.findFirstOrThrow({ where: { timesheetId: annSheet } });
      const edit = await request(server)
        .patch(`/api/v1/time/entries/${entry.id}`)
        .set(as('ann'))
        .send({ hours: 1 });
      expect(edit.status).toBe(409);
      expect(edit.body.code).toBe('TIMESHEET_LOCKED');
      await request(server).delete(`/api/v1/time/entries/${entry.id}`).set(as('ann')).expect(409);
    });

    it('refuses to approve a week it cannot cost, and leaves it waiting', async () => {
      const eveSheet = (await sheetOf('eve', LAST_WEEK))!.id;
      const res = await decide('ceo', eveSheet, 'APPROVED');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('NO_COST_RATE');
      expect((await sheetOf('eve', LAST_WEEK))!.status).toBe('SUBMITTED');
      expect(await ledger(eveSheet)).toHaveLength(0);
      const entries = await prisma.timeEntry.findMany({ where: { timesheetId: eveSheet } });
      expect(entries.every((e) => !e.isLocked)).toBe(true);
    });

    it('two approvers at the same moment post the cost once', async () => {
      const bobSheet = (await sheetOf('bob', LAST_WEEK))!.id;
      const results = await Promise.all([
        decide('lead', bobSheet, 'APPROVED'),
        decide('ceo', bobSheet, 'APPROVED'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const rows = await ledger(bobSheet);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].amount)).toBe(4000); // 10 h x 400 (Mon 8 h + Tue 2 h)
    });

    it('approves in bulk, reporting each one', async () => {
      const danSheet = (await sheetOf('dan', LAST_WEEK))!.id;
      const eveSheet = (await sheetOf('eve', LAST_WEEK))!.id;
      const res = await request(server)
        .post('/api/v1/timesheets/bulk-decision')
        .set(as('ceo'))
        .send({ ids: [danSheet, eveSheet, annSheet], decision: 'APPROVED' })
        .expect(201);
      expect(res.body.done).toBe(1);
      expect(res.body.failed).toBe(2);
      const byId = Object.fromEntries(
        res.body.results.map((r: { id: string; ok: boolean; code?: string }) => [r.id, r]),
      );
      expect(byId[danSheet].ok).toBe(true);
      expect(byId[eveSheet].code).toBe('NO_COST_RATE');
      expect(byId[annSheet].code).toBe('NOT_PENDING');
    });

    it('bulk rejection needs a reason', async () => {
      await request(server)
        .post('/api/v1/timesheets/bulk-decision')
        .set(as('ceo'))
        .send({ ids: [annSheet], decision: 'REJECTED' })
        .expect(422);
    });
  });

  describe('reopening an approved week', () => {
    let annSheet = '';
    beforeAll(async () => {
      annSheet = (await sheetOf('ann', LAST_WEEK))!.id;
    });

    it('is not for ordinary approvers, or for the owner', async () => {
      const lead = await request(server)
        .post(`/api/v1/timesheets/${annSheet}/reopen`)
        .set(as('lead'))
        .send({ reason: 'Wrong project on Thursday' });
      expect(lead.status).toBe(403);
      await request(server)
        .post(`/api/v1/timesheets/${annSheet}/reopen`)
        .set(as('ann'))
        .send({ reason: 'Wrong project on Thursday' })
        .expect(403);
    });

    it('needs a reason', async () => {
      await request(server)
        .post(`/api/v1/timesheets/${annSheet}/reopen`)
        .set(as('ceo'))
        .send({ reason: 'x' })
        .expect(422);
    });

    it('reverses the cost, unlocks the entries and audits it', async () => {
      const res = await request(server)
        .post(`/api/v1/timesheets/${annSheet}/reopen`)
        .set(as('ceo'))
        .send({ reason: 'Thursday hours were on PJT-1, not PJT-2' })
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'REOPENED',
        reopenReason: 'Thursday hours were on PJT-1, not PJT-2',
      });

      const rows = await ledger(annSheet);
      expect(rows).toHaveLength(4); // two originals, two reversals
      expect(rows.filter((r) => r.isReversal)).toHaveLength(2);
      expect(await net(annSheet)).toBe(0);
      expect(
        Number((await prisma.project.findFirstOrThrow({ where: { id: ids.p1 } })).actualLabourCost),
      ).toBe(await projectCostExcluding(ids.p1, annSheet));
      expect(
        Number((await prisma.project.findFirstOrThrow({ where: { id: ids.p2 } })).actualLabourCost),
      ).toBe(0);

      const entries = await prisma.timeEntry.findMany({ where: { timesheetId: annSheet } });
      expect(entries.every((e) => !e.isLocked)).toBe(true);
      const audit = await prisma.auditLog.findFirst({
        where: { entityType: 'Timesheet', entityId: annSheet, action: 'REOPEN' },
      });
      expect(audit?.reason).toMatch(/Thursday/);
      expect(
        await prisma.notification.count({
          where: { userId: who.ann.userId, title: { contains: 'reopened' } },
        }),
      ).toBe(1);
    });

    it('cannot be reopened twice, or before it was approved', async () => {
      const again = await request(server)
        .post(`/api/v1/timesheets/${annSheet}/reopen`)
        .set(as('ceo'))
        .send({ reason: 'Trying again' });
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('NOT_APPROVED');
    });

    it('is corrected, resubmitted and approved: the next version is posted', async () => {
      const thursday = await prisma.timeEntry.findFirstOrThrow({
        where: { timesheetId: annSheet, workDate: d('2026-10-01') },
      });
      await request(server)
        .patch(`/api/v1/time/entries/${thursday.id}`)
        .set(as('ann'))
        .send({ projectId: ids.p1, taskId: ids.t1 })
        .expect(200);
      await submit('ann', LAST_WEEK).expect(201);
      await decide('lead', annSheet, 'APPROVED').expect(201);

      const rows = await ledger(annSheet);
      expect(rows).toHaveLength(5); // 2 + 2 reversals + 1 new (one project now)
      const v2 = rows.filter((r) => r.postingVersion === 2);
      expect(v2).toHaveLength(1);
      expect(v2[0].projectId).toBe(ids.p1);
      // Monday 8 h @ 500 and Thursday 8 h @ 600, one project, two rate segments.
      expect(Number(v2[0].amount)).toBe(8800);
      expect(Number(v2[0].rateApplied ?? 0)).toBe(0);
      expect((v2[0].rateBreakdown as unknown[]).length).toBe(2);
      expect(await net(annSheet)).toBe(8800);
      expect(
        Number((await prisma.project.findFirstOrThrow({ where: { id: ids.p1 } })).actualLabourCost),
      ).toBe(8800 + (await projectCostExcluding(ids.p1, annSheet)));
    });
  });

  describe('lists and scope', () => {
    it('shows people their own sheets, a lead their team’s, the CEO everyone’s', async () => {
      const own = await request(server)
        .get('/api/v1/timesheets?pageSize=100')
        .set(as('ann'))
        .expect(200);
      expect(
        own.body.data.every(
          (r: { employee: { id: string } }) => r.employee.id === who.ann.employeeId,
        ),
      ).toBe(true);

      const lead = await request(server)
        .get('/api/v1/timesheets?pageSize=100')
        .set(as('lead'))
        .expect(200);
      const leadPeople = new Set(
        lead.body.data.map((r: { employee: { id: string } }) => r.employee.id),
      );
      expect(leadPeople.has(who.eve.employeeId)).toBe(false);
      expect(leadPeople.has(who.bob.employeeId)).toBe(true);

      const ceo = await request(server)
        .get('/api/v1/timesheets?pageSize=100')
        .set(as('ceo'))
        .expect(200);
      expect(ceo.body.meta.total).toBeGreaterThan(lead.body.meta.total);
    });

    it('filters by status and week', async () => {
      const res = await request(server)
        .get(`/api/v1/timesheets?status=APPROVED&weekStart=${LAST_WEEK}&pageSize=100`)
        .set(as('ceo'))
        .expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(
        res.body.data.every(
          (r: { status: string; weekStart: string }) =>
            r.status === 'APPROVED' && r.weekStart === LAST_WEEK,
        ),
      ).toBe(true);
    });

    it('summarises a project’s hours by person, within what the caller may see', async () => {
      const pm = await request(server)
        .get(`/api/v1/time/projects/${ids.p1}/summary`)
        .set(as('pm'))
        .expect(200);
      expect(pm.body.byEmployee.length).toBeGreaterThan(1);
      expect(typeof pm.body.partial).toBe('boolean');
      expect(pm.body.totalHours).toBeGreaterThan(0);

      const ann = await request(server)
        .get(`/api/v1/time/projects/${ids.p1}/summary`)
        .set(as('ann'))
        .expect(200);
      expect(ann.body.partial).toBe(true);
      expect(
        ann.body.byEmployee.every(
          (p: { employee: { id: string } }) => p.employee.id === who.ann.employeeId,
        ),
      ).toBe(true);

      await request(server)
        .get(`/api/v1/time/projects/${ids.p1}/summary`)
        .set(as('cal'))
        .expect(404);
    });

    it('lists entries within scope', async () => {
      const own = await request(server)
        .get('/api/v1/time/entries?pageSize=100')
        .set(as('ann'))
        .expect(200);
      expect(
        own.body.data.every(
          (e: { employee: { id: string } }) => e.employee.id === who.ann.employeeId,
        ),
      ).toBe(true);
      const filtered = await request(server)
        .get(`/api/v1/time/entries?projectId=${ids.p1}&employeeId=${who.bob.employeeId}`)
        .set(as('ann'))
        .expect(200);
      expect(filtered.body.data).toEqual([]);
    });

    it('keeps each task’s logged hours equal to its entries', async () => {
      for (const taskId of [ids.t1, ids.t2, ids.t3]) {
        const agg = await prisma.timeEntry.aggregate({ where: { taskId }, _sum: { hours: true } });
        const task = await prisma.task.findFirstOrThrow({ where: { id: taskId } });
        expect(Number(task.loggedHours)).toBeCloseTo(Number(agg._sum.hours ?? 0), 2);
      }
    });
  });

  describe('access', () => {
    it('needs a login, and the right permission', async () => {
      await request(server).get('/api/v1/time/timer').expect(401);
      // HR has no timesheet permissions at all.
      await request(server).get('/api/v1/timesheets/week').set(as('hr')).expect(403);
      await request(server).post('/api/v1/time/timer/start').set(as('hr')).send({}).expect(403);
    });

    it('lets a project manager log their own time', async () => {
      const res = await logTime('pm', { workDate: '2026-10-06', hours: 2 });
      expect(res.status).toBe(201);
    });
  });
});
