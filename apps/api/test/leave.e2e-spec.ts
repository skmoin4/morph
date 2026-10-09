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

/** Step 9: leave types, balances, applying, one- and two-level approval, attendance effect. */
describe('Leave (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  // Monday 05 Oct 2026, mid-morning in India.
  const fakeNow = officeLocalToUtc('2026-10-05', '11:00', IST);
  const clock = { now: () => fakeNow };

  const who = {
    ceo: { email: 'ceo@lv.test', token: '', employeeId: '', userId: '' },
    hr: { email: 'hr@lv.test', token: '', employeeId: '', userId: '' },
    lead: { email: 'lead@lv.test', token: '', employeeId: '', userId: '' },
    ann: { email: 'ann@lv.test', token: '', employeeId: '', userId: '' }, // reports to lead
    bob: { email: 'bob@lv.test', token: '', employeeId: '', userId: '' }, // reports to lead
    cal: { email: 'cal@lv.test', token: '', employeeId: '', userId: '' }, // reports to lead
    nia: { email: 'nia@lv.test', token: '', employeeId: '', userId: '' }, // reports to lead
    eve: { email: 'eve@lv.test', token: '', employeeId: '', userId: '' }, // nobody's report
    joe: { email: 'joe@lv.test', token: '', employeeId: '', userId: '' }, // joined 01 Jul 2026
    pam: { email: 'pam@lv.test', token: '', employeeId: '', userId: '' }, // project manager
    fin: { email: 'fin@lv.test', token: '', employeeId: '', userId: '' }, // finance
  };
  const ids = { companyId: '', hq: '', cl: '', el: '', sl: '', lop: '' };

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
        data: { name: 'Leave Test Co', codePrefix: 'LTC', fyStartMonth: 4 },
      });
      ids.companyId = company.id;
      const companyId = company.id;

      ids.hq = (
        await prisma.office.create({
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
        })
      ).id;
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
      await prisma.attendancePolicy.create({
        data: {
          companyId,
          name: 'Default',
          graceMinutes: 10,
          lateMarkAfterMinutes: 0,
          halfDayBelowHours: '4.00',
          fullDayMinimumHours: '8.00',
          overtimeAfterHours: '9.00',
          earlyExitBeforeMinutes: 15,
          lateMarksPerHalfDay: 3,
          isDefault: true,
        },
      });
      await prisma.holiday.create({
        data: { companyId, officeId: ids.hq, name: 'Test Holiday', date: d('2026-10-08') },
      });

      const type = async (data: Record<string, unknown>) =>
        (await prisma.leaveType.create({ data: { companyId, ...data } as never })).id;
      ids.cl = await type({
        name: 'Casual Leave',
        shortCode: 'CL',
        yearlyQuota: '12.00',
        approvalFlow: 'SINGLE_LEVEL',
        colorToken: 'blue',
      });
      ids.el = await type({
        name: 'Earned Leave',
        shortCode: 'EL',
        yearlyQuota: '18.00',
        carryForward: true,
        maxCarryForward: '10.00',
        approvalFlow: 'TEAM_LEAD_THEN_MANAGER',
        colorToken: 'green',
      });
      ids.sl = await type({
        name: 'Sick Leave',
        shortCode: 'SL',
        yearlyQuota: '8.00',
        approvalFlow: 'SINGLE_LEVEL',
        colorToken: 'amber',
      });
      ids.lop = await type({
        name: 'Loss of Pay',
        shortCode: 'LOP',
        yearlyQuota: '0.00',
        isPaid: false,
        allowHalfDay: false,
        approvalFlow: 'SINGLE_LEVEL',
        colorToken: 'red',
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
        options: { managerId?: string | null; joined?: string } = {},
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
            employeeCode: `LTC-00${n}`,
            firstName: key,
            lastName: 'Tester',
            joiningDate: d(options.joined ?? '2024-01-01'),
            officeId: ids.hq,
            attendanceMethod: 'BOTH',
            managerId: options.managerId ?? null,
          },
        });
        who[key].employeeId = employee.id;
        who[key].userId = user.id;
      }

      await person('ceo', 'CEO');
      await person('hr', 'HR_ADMIN');
      await person('lead', 'TEAM_LEAD');
      const m = who.lead.employeeId;
      await person('ann', 'EMPLOYEE', { managerId: m });
      await person('bob', 'EMPLOYEE', { managerId: m });
      await person('cal', 'EMPLOYEE', { managerId: m });
      await person('nia', 'EMPLOYEE', { managerId: m });
      await person('eve', 'EMPLOYEE');
      await person('joe', 'EMPLOYEE', { joined: '2026-07-01' });
      await person('pam', 'PROJECT_MANAGER');
      await person('fin', 'FINANCE');

      // Ann ended 2025 with 18 days of Earned Leave unspent: at most 10 carry over.
      await prisma.leaveBalance.create({
        data: {
          companyId,
          employeeId: who.ann.employeeId,
          leaveTypeId: ids.el,
          year: 2025,
          opening: '18.00',
          used: '0.00',
        },
      });
    });
  }

  // --- helpers --------------------------------------------------------------

  type Body = Record<string, unknown>;
  const apply = (key: keyof typeof who, body: Body) =>
    request(server)
      .post('/api/v1/leave/requests')
      .set(as(key))
      .send({ dayPart: 'FULL_DAY', reason: 'Family function', ...body });
  const preview = (key: keyof typeof who, body: Body) =>
    request(server)
      .post('/api/v1/leave/preview')
      .set(as(key))
      .send({ dayPart: 'FULL_DAY', ...body });
  const decide = (key: keyof typeof who, id: string, decision: string, note?: string) =>
    request(server)
      .post(`/api/v1/leave/requests/${id}/decision`)
      .set(as(key))
      .send({ decision, note });
  const cancel = (key: keyof typeof who, id: string, note?: string) =>
    request(server).post(`/api/v1/leave/requests/${id}/cancel`).set(as(key)).send({ note });
  const detail = (
    res: { body: { details?: Array<{ path: string; message: string }> } },
    path: string,
  ) => res.body.details?.find((x) => x.path === path)?.message ?? '';
  const balance = async (key: keyof typeof who, code: string, asKey = key) => {
    const res = await request(server)
      .get(`/api/v1/leave/balances?employeeId=${who[key].employeeId}`)
      .set(as(asKey))
      .expect(200);
    return res.body.balances.find(
      (b: { leaveType: { shortCode: string } }) => b.leaveType.shortCode === code,
    );
  };

  // =========================================================================

  describe('types and balances', () => {
    it('lists the active leave types for the apply form', async () => {
      const res = await request(server).get('/api/v1/leave/types').set(as('ann')).expect(200);
      expect(res.body.map((t: { shortCode: string }) => t.shortCode).sort()).toEqual([
        'CL',
        'EL',
        'LOP',
        'SL',
      ]);
    });

    it('gives a long-standing employee the full quota, without writing anything', async () => {
      const cl = await balance('ann', 'CL');
      expect(cl).toMatchObject({ opening: 12, used: 0, pending: 0, available: 12, year: 2026 });
      expect(await prisma.leaveBalance.count({ where: { year: 2026 } })).toBe(0);
    });

    it('prorates a mid-year joiner, rounded down to the half day', async () => {
      // Joined 01 Jul: 6 of 12 months.
      expect((await balance('joe', 'CL')).opening).toBe(6);
      expect((await balance('joe', 'EL')).opening).toBe(9);
      expect((await balance('joe', 'SL')).opening).toBe(4);
    });

    it('carries forward last year’s unspent balance, up to the cap', async () => {
      const el = await balance('ann', 'EL');
      expect(el.carriedForward).toBe(10);
      expect(el.available).toBe(28);
    });

    it('does not carry a type that has carry forward switched off', async () => {
      await prisma.leaveBalance.create({
        data: {
          companyId: ids.companyId,
          employeeId: who.ann.employeeId,
          leaveTypeId: ids.cl,
          year: 2025,
          opening: '12.00',
        },
      });
      expect((await balance('ann', 'CL')).carriedForward).toBe(0);
    });

    it('shows people only their own balances, and the team lead their team’s', async () => {
      await request(server)
        .get(`/api/v1/leave/balances?employeeId=${who.bob.employeeId}`)
        .set(as('ann'))
        .expect(404);
      await request(server)
        .get(`/api/v1/leave/balances?employeeId=${who.ann.employeeId}`)
        .set(as('lead'))
        .expect(200);
      await request(server)
        .get(`/api/v1/leave/balances?employeeId=${who.eve.employeeId}`)
        .set(as('lead'))
        .expect(404);
      await request(server)
        .get(`/api/v1/leave/balances?employeeId=${who.eve.employeeId}`)
        .set(as('hr'))
        .expect(200);
    });

    it('finance and the project manager can apply for their own leave', async () => {
      await preview('fin', {
        leaveTypeId: ids.cl,
        fromDate: '2026-10-14',
        toDate: '2026-10-14',
      }).expect(201);
      await preview('pam', {
        leaveTypeId: ids.cl,
        fromDate: '2026-10-14',
        toDate: '2026-10-14',
      }).expect(201);
    });
  });

  describe('previewing what a leave costs', () => {
    it('does not charge a weekly off inside the range', async () => {
      // Fri 09 .. Tue 13 Oct: Sunday is free.
      const res = await preview('eve', {
        leaveTypeId: ids.cl,
        fromDate: '2026-10-09',
        toDate: '2026-10-13',
      }).expect(201);
      expect(res.body.totalDays).toBe(4);
      expect(res.body.skipped).toEqual([
        { date: '2026-10-11', reason: 'WEEKLY_OFF', holiday: null },
      ]);
      expect(res.body.balance).toMatchObject({ available: 12, afterRequest: 8 });
    });

    it('does not charge a holiday, and names it', async () => {
      // Wed 07 .. Fri 09, with 08 Oct a holiday.
      const res = await preview('eve', {
        leaveTypeId: ids.cl,
        fromDate: '2026-10-07',
        toDate: '2026-10-09',
      }).expect(201);
      expect(res.body.totalDays).toBe(2);
      expect(res.body.skipped[0]).toMatchObject({ reason: 'HOLIDAY', holiday: 'Test Holiday' });
    });

    it('counts a half day as 0.5', async () => {
      const res = await preview('eve', {
        leaveTypeId: ids.cl,
        fromDate: '2026-10-14',
        toDate: '2026-10-14',
        dayPart: 'SECOND_HALF',
      }).expect(201);
      expect(res.body.totalDays).toBe(0.5);
    });

    it('says when the balance is not enough, without refusing the preview', async () => {
      // Mon 12 .. Sat 24 Oct is 11 working days (one Sunday, no holiday); SL has 8.
      const res = await preview('eve', {
        leaveTypeId: ids.sl,
        fromDate: '2026-10-12',
        toDate: '2026-10-24',
      }).expect(201);
      expect(res.body.totalDays).toBe(12);
      expect(res.body.enoughBalance).toBe(false);
    });

    it('does not limit an unpaid type by a quota', async () => {
      const res = await preview('eve', {
        leaveTypeId: ids.lop,
        fromDate: '2026-10-12',
        toDate: '2026-10-24',
      }).expect(201);
      expect(res.body.enoughBalance).toBe(true);
      expect(res.body.balance.enforced).toBe(false);
    });
  });

  describe('applying: what is refused', () => {
    const base = { leaveTypeId: '' };
    beforeAll(() => {
      base.leaveTypeId = ids.cl;
    });

    it('refuses a range that ends before it starts', async () => {
      const res = await apply('eve', { ...base, fromDate: '2026-10-14', toDate: '2026-10-13' });
      expect(res.status).toBe(422);
      expect(detail(res, 'toDate')).toBeTruthy();
    });

    it('refuses a request that crosses into the next year', async () => {
      const res = await apply('eve', { ...base, fromDate: '2026-12-30', toDate: '2027-01-02' });
      expect(res.status).toBe(422);
      expect(detail(res, 'toDate')).toMatch(/two years/);
    });

    it('refuses a half day over several days', async () => {
      const res = await apply('eve', {
        ...base,
        fromDate: '2026-10-14',
        toDate: '2026-10-15',
        dayPart: 'FIRST_HALF',
      });
      expect(res.status).toBe(422);
      expect(detail(res, 'dayPart')).toBeTruthy();
    });

    it('refuses a half day for a type that does not allow it', async () => {
      const res = await apply('eve', {
        leaveTypeId: ids.lop,
        fromDate: '2026-10-14',
        toDate: '2026-10-14',
        dayPart: 'FIRST_HALF',
      });
      expect(res.status).toBe(400);
      expect(detail(res, 'dayPart')).toMatch(/half day/);
    });

    it('refuses days that are all off', async () => {
      // Sunday 11 Oct on its own.
      const res = await apply('eve', { ...base, fromDate: '2026-10-11', toDate: '2026-10-11' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/weekly offs or holidays/);
    });

    it('refuses a day before the person joined', async () => {
      // Joe joined 01 Jul 2026; "today" is 05 Oct, so 20 Jun is also outside the window.
      await prisma.employee.update({
        where: { id: who.joe.employeeId },
        data: { joiningDate: d('2026-10-01') },
      });
      const res = await apply('joe', { ...base, fromDate: '2026-09-30', toDate: '2026-09-30' });
      expect(res.status).toBe(400);
      expect(detail(res, 'fromDate')).toMatch(/before you joined/);
      await prisma.employee.update({
        where: { id: who.joe.employeeId },
        data: { joiningDate: d('2026-07-01') },
      });
    });

    it('refuses leave older than the back-dating window', async () => {
      const res = await apply('eve', { ...base, fromDate: '2026-08-03', toDate: '2026-08-03' });
      expect(res.status).toBe(400);
      expect(detail(res, 'fromDate')).toMatch(/30 days back/);
    });

    it('refuses a reason that is too short', async () => {
      const res = await apply('eve', {
        ...base,
        fromDate: '2026-10-14',
        toDate: '2026-10-14',
        reason: 'hi',
      });
      expect(res.status).toBe(422);
    });

    it('refuses an inactive or unknown type', async () => {
      const res = await apply('eve', {
        leaveTypeId: 'nope',
        fromDate: '2026-10-14',
        toDate: '2026-10-14',
      });
      expect(res.status).toBe(400);
      expect(detail(res, 'leaveTypeId')).toBeTruthy();
    });

    it('refuses more days than the balance, and says which type to use instead', async () => {
      const res = await apply('eve', {
        leaveTypeId: ids.sl,
        fromDate: '2026-10-12',
        toDate: '2026-10-24',
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INSUFFICIENT_BALANCE');
      expect(res.body.message).toMatch(/unpaid/);
    });

    it('lets an unpaid type go beyond any quota', async () => {
      const res = await apply('eve', {
        leaveTypeId: ids.lop,
        fromDate: '2026-10-12',
        toDate: '2026-10-24',
      });
      expect(res.status).toBe(201);
      // Clean up so later tests have a clear calendar.
      await cancel('eve', res.body.id).expect(201);
    });

    it('refuses a second request that overlaps a live one', async () => {
      const first = await apply('eve', { ...base, fromDate: '2026-10-14', toDate: '2026-10-15' });
      expect(first.status).toBe(201);
      const second = await apply('eve', { ...base, fromDate: '2026-10-15', toDate: '2026-10-16' });
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('LEAVE_OVERLAP');
      await cancel('eve', first.body.id).expect(201);
      // Cancelled leave no longer blocks the dates.
      const third = await apply('eve', { ...base, fromDate: '2026-10-15', toDate: '2026-10-16' });
      expect(third.status).toBe(201);
      await cancel('eve', third.body.id).expect(201);
    });

    it('lets two halves of the same day not overlap — it is refused as one clash', async () => {
      const first = await apply('eve', {
        ...base,
        fromDate: '2026-10-14',
        toDate: '2026-10-14',
        dayPart: 'FIRST_HALF',
      });
      expect(first.status).toBe(201);
      const second = await apply('eve', {
        ...base,
        fromDate: '2026-10-14',
        toDate: '2026-10-14',
        dayPart: 'SECOND_HALF',
      });
      expect(second.status).toBe(409);
      await cancel('eve', first.body.id).expect(201);
    });
  });

  describe('a single-level leave', () => {
    let requestId = '';

    it('waits, and reserves the days as pending', async () => {
      // Fri 02 Oct (past, inside the window).
      const res = await apply('ann', {
        leaveTypeId: ids.cl,
        fromDate: '2026-10-02',
        toDate: '2026-10-02',
      });
      expect(res.status).toBe(201);
      requestId = res.body.id;
      expect(res.body).toMatchObject({
        status: 'PENDING',
        totalDays: 1,
        awaitingLevel: 1,
        isMine: true,
        canDecide: false,
        canCancel: true,
      });
      expect(await balance('ann', 'CL')).toMatchObject({ pending: 1, used: 0, available: 11 });
    });

    it('tells the approvers, and not the applicant', async () => {
      const toLead = await prisma.notification.count({
        where: { userId: who.lead.userId, type: 'LEAVE_SUBMITTED', entityId: requestId },
      });
      const toHr = await prisma.notification.count({
        where: { userId: who.hr.userId, type: 'LEAVE_SUBMITTED', entityId: requestId },
      });
      const toAnn = await prisma.notification.count({
        where: { userId: who.ann.userId, entityId: requestId },
      });
      const toEve = await prisma.notification.count({
        where: { userId: who.eve.userId, entityId: requestId },
      });
      expect(toLead).toBe(1);
      expect(toHr).toBe(1);
      expect(toAnn).toBe(0);
      expect(toEve).toBe(0);
    });

    it('cannot be decided by the applicant, or by someone without the permission', async () => {
      const own = await decide('ann', requestId, 'APPROVED');
      expect(own.status).toBe(403);
      await decide('bob', requestId, 'APPROVED').expect(403);
    });

    it('is approved by the team lead: days move to used and the day becomes leave', async () => {
      const res = await decide('lead', requestId, 'APPROVED', 'Enjoy').expect(201);
      expect(res.body).toMatchObject({ status: 'APPROVED', awaitingLevel: null });
      expect(res.body.level1.approver).toBe('lead Tester');
      expect(await balance('ann', 'CL')).toMatchObject({ pending: 0, used: 1, available: 11 });

      const record = await prisma.attendanceRecord.findFirst({
        where: { employeeId: who.ann.employeeId, attendanceDate: d('2026-10-02') },
      });
      expect(record?.status).toBe('ON_LEAVE');
      expect(Number(record?.dayValue)).toBe(1);
      const stored = await prisma.leaveRequest.findFirst({ where: { id: requestId } });
      expect(stored?.attendanceApplied).toBe(true);

      const note = await prisma.notification.count({
        where: { userId: who.ann.userId, type: 'LEAVE_APPROVED', entityId: requestId },
      });
      expect(note).toBe(1);
    });

    it('cannot be decided twice', async () => {
      const again = await decide('hr', requestId, 'REJECTED', 'Changed my mind');
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('NOT_PENDING');
    });

    it('is audited', async () => {
      const entries = await prisma.auditLog.findMany({
        where: { entityType: 'LeaveRequest', entityId: requestId },
      });
      expect(entries.map((e) => e.action).sort()).toEqual(['APPROVE', 'CREATE']);
    });

    it('cannot be cancelled by the owner once it has started, but can by an approver with a reason', async () => {
      const own = await cancel('ann', requestId);
      expect(own.status).toBe(403);
      expect(own.body.code).toBe('CANNOT_CANCEL');

      const noReason = await cancel('hr', requestId);
      expect(noReason.status).toBe(400);

      await cancel('hr', requestId, 'Applied by mistake, she was at work').expect(201);
      expect(await balance('ann', 'CL')).toMatchObject({ pending: 0, used: 0, available: 12 });
      const record = await prisma.attendanceRecord.findFirst({
        where: { employeeId: who.ann.employeeId, attendanceDate: d('2026-10-02') },
      });
      expect(record?.status).not.toBe('ON_LEAVE');
      const note = await prisma.notification.count({
        where: { userId: who.ann.userId, title: { contains: 'was cancelled' } },
      });
      expect(note).toBe(1);
    });
  });

  describe('rejecting', () => {
    it('needs a reason, and gives the days back', async () => {
      const made = await apply('nia', {
        leaveTypeId: ids.cl,
        fromDate: '2026-10-14',
        toDate: '2026-10-15',
      });
      expect(await balance('nia', 'CL')).toMatchObject({ pending: 2, available: 10 });

      const noNote = await decide('lead', made.body.id, 'REJECTED');
      expect(noNote.status).toBe(422);

      const res = await decide(
        'lead',
        made.body.id,
        'REJECTED',
        'Release week, please move it',
      ).expect(201);
      expect(res.body.status).toBe('REJECTED');
      expect(await balance('nia', 'CL')).toMatchObject({ pending: 0, used: 0, available: 12 });
      const told = await prisma.notification.count({
        where: { userId: who.nia.userId, type: 'LEAVE_REJECTED', entityId: made.body.id },
      });
      expect(told).toBe(1);
    });
  });

  describe('a two-level leave', () => {
    let requestId = '';

    it('needs the team lead first, then a different person', async () => {
      // Mon 19 .. Wed 21 Oct, Earned Leave.
      const made = await apply('bob', {
        leaveTypeId: ids.el,
        fromDate: '2026-10-19',
        toDate: '2026-10-21',
      });
      expect(made.status).toBe(201);
      requestId = made.body.id;
      expect(made.body).toMatchObject({ flow: 'TEAM_LEAD_THEN_MANAGER', awaitingLevel: 1 });

      const first = await decide('lead', requestId, 'APPROVED', 'OK from me').expect(201);
      expect(first.body).toMatchObject({ status: 'PENDING', awaitingLevel: 2 });
      expect(first.body.level1.approver).toBe('lead Tester');
      // Nothing is used yet.
      expect(await balance('bob', 'EL')).toMatchObject({ pending: 3, used: 0 });

      // Second level goes back to the approvers other than the first.
      const toHr = await prisma.notification.count({
        where: {
          userId: who.hr.userId,
          entityId: requestId,
          title: { contains: 'final approval' },
        },
      });
      const toLead = await prisma.notification.count({
        where: {
          userId: who.lead.userId,
          entityId: requestId,
          title: { contains: 'final approval' },
        },
      });
      expect(toHr).toBe(1);
      expect(toLead).toBe(0);
    });

    it('does not let the same person approve both levels', async () => {
      const row = await request(server)
        .get(`/api/v1/leave/requests/${requestId}`)
        .set(as('lead'))
        .expect(200);
      expect(row.body.canDecide).toBe(false);
      const res = await decide('lead', requestId, 'APPROVED');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('SAME_APPROVER');
    });

    it('is finished by the second approver', async () => {
      const res = await decide('hr', requestId, 'APPROVED').expect(201);
      expect(res.body).toMatchObject({ status: 'APPROVED' });
      expect(res.body.level2.approver).toBe('hr Tester');
      expect(await balance('bob', 'EL')).toMatchObject({ pending: 0, used: 3 });
    });

    it('can be rejected at the second level, giving the days back', async () => {
      const made = await apply('cal', {
        leaveTypeId: ids.el,
        fromDate: '2026-10-19',
        toDate: '2026-10-20',
      });
      await decide('lead', made.body.id, 'APPROVED').expect(201);
      await decide('ceo', made.body.id, 'REJECTED', 'Client deadline that week').expect(201);
      expect(await balance('cal', 'EL')).toMatchObject({ pending: 0, used: 0 });
      const row = await request(server)
        .get(`/api/v1/leave/requests/${made.body.id}`)
        .set(as('cal'))
        .expect(200);
      expect(row.body.status).toBe('REJECTED');
      expect(row.body.level2.note).toMatch(/deadline/);
    });

    it('lets HR, who sees everyone, finish a two-level leave in one go', async () => {
      const made = await apply('cal', {
        leaveTypeId: ids.el,
        fromDate: '2026-10-22',
        toDate: '2026-10-22',
      });
      const res = await decide('hr', made.body.id, 'APPROVED').expect(201);
      expect(res.body.status).toBe('APPROVED');
      expect(await balance('cal', 'EL')).toMatchObject({ pending: 0, used: 1 });
    });

    it('an owner may cancel an approved leave that has not started, which restores the balance', async () => {
      const list = await request(server)
        .get('/api/v1/leave/requests?mine=true&status=APPROVED')
        .set(as('cal'))
        .expect(200);
      const mine = list.body.data[0];
      expect(mine.canCancel).toBe(true);
      await cancel('cal', mine.id).expect(201);
      expect(await balance('cal', 'EL')).toMatchObject({ pending: 0, used: 0 });
    });
  });

  describe('who may decide what', () => {
    it('never lets someone approve their own leave, even with the permission for everyone', async () => {
      // The team lead applies; their own approval does not count.
      const made = await apply('lead', {
        leaveTypeId: ids.cl,
        fromDate: '2026-10-14',
        toDate: '2026-10-14',
      });
      expect(made.status).toBe(201);
      const own = await decide('lead', made.body.id, 'APPROVED');
      expect(own.status).toBe(403);
      expect(own.body.code).toBe('SELF_APPROVAL');
      // HR applies for themself: the CEO decides.
      const hrOwn = await apply('hr', {
        leaveTypeId: ids.cl,
        fromDate: '2026-10-14',
        toDate: '2026-10-14',
      });
      expect((await decide('hr', hrOwn.body.id, 'APPROVED')).status).toBe(403);
      await decide('ceo', hrOwn.body.id, 'APPROVED').expect(201);
      await decide('hr', made.body.id, 'APPROVED').expect(201);
    });

    it('hides a request from someone outside the scope: 404, not 403', async () => {
      const made = await apply('eve', {
        leaveTypeId: ids.cl,
        fromDate: '2026-10-28',
        toDate: '2026-10-28',
      });
      await request(server)
        .get(`/api/v1/leave/requests/${made.body.id}`)
        .set(as('lead'))
        .expect(404);
      await decide('lead', made.body.id, 'APPROVED').expect(404);
      await request(server)
        .get(`/api/v1/leave/requests/${made.body.id}`)
        .set(as('ann'))
        .expect(404);
      await cancel('ann', made.body.id).expect(404);
      await request(server).get(`/api/v1/leave/requests/${made.body.id}`).set(as('hr')).expect(200);
      await cancel('eve', made.body.id).expect(201);
    });

    it('lets HR apply for someone, but nobody below HR', async () => {
      const made = await apply('hr', {
        leaveTypeId: ids.cl,
        fromDate: '2026-10-29',
        toDate: '2026-10-29',
        employeeId: who.eve.employeeId,
      });
      expect(made.status).toBe(201);
      expect(made.body.employee.id).toBe(who.eve.employeeId);
      expect(made.body.isMine).toBe(false);
      await cancel('eve', made.body.id).expect(201);

      await apply('lead', {
        leaveTypeId: ids.cl,
        fromDate: '2026-10-29',
        toDate: '2026-10-29',
        employeeId: who.ann.employeeId,
      }).expect(404);
    });
  });

  describe('lists', () => {
    it('shows an employee only their own, the lead their team’s, HR everyone’s', async () => {
      const mine = await request(server)
        .get('/api/v1/leave/requests?pageSize=100')
        .set(as('ann'))
        .expect(200);
      expect(
        mine.body.data.every(
          (r: { employee: { id: string } }) => r.employee.id === who.ann.employeeId,
        ),
      ).toBe(true);

      const lead = await request(server)
        .get('/api/v1/leave/requests?pageSize=100')
        .set(as('lead'))
        .expect(200);
      const leadPeople = new Set(
        lead.body.data.map((r: { employee: { id: string } }) => r.employee.id),
      );
      expect(leadPeople.has(who.eve.employeeId)).toBe(false);
      expect(leadPeople.has(who.bob.employeeId)).toBe(true);

      const hr = await request(server)
        .get('/api/v1/leave/requests?pageSize=100')
        .set(as('hr'))
        .expect(200);
      const hrPeople = new Set(
        hr.body.data.map((r: { employee: { id: string } }) => r.employee.id),
      );
      expect(hrPeople.size).toBeGreaterThan(leadPeople.size);
    });

    it('toDecide returns only what waits on the caller', async () => {
      const made = await apply('ann', {
        leaveTypeId: ids.cl,
        fromDate: '2026-11-03',
        toDate: '2026-11-03',
      });
      const lead = await request(server)
        .get('/api/v1/leave/requests?toDecide=true&pageSize=100')
        .set(as('lead'))
        .expect(200);
      expect(lead.body.data.map((r: { id: string }) => r.id)).toContain(made.body.id);
      expect(lead.body.data.every((r: { canDecide: boolean }) => r.canDecide)).toBe(true);

      // An employee decides nothing.
      const ann = await request(server)
        .get('/api/v1/leave/requests?toDecide=true')
        .set(as('ann'))
        .expect(200);
      expect(ann.body.data).toEqual([]);
      await cancel('ann', made.body.id).expect(201);
    });

    it('filters by status and type', async () => {
      const res = await request(server)
        .get(`/api/v1/leave/requests?status=APPROVED&leaveTypeId=${ids.el}&pageSize=100`)
        .set(as('hr'))
        .expect(200);
      expect(
        res.body.data.every(
          (r: { status: string; leaveType: { id: string } }) =>
            r.status === 'APPROVED' && r.leaveType.id === ids.el,
        ),
      ).toBe(true);
    });
  });

  describe('concurrency', () => {
    it('counts the days once when two approvers click at the same moment', async () => {
      const made = await apply('nia', {
        leaveTypeId: ids.cl,
        fromDate: '2026-11-04',
        toDate: '2026-11-05',
      });
      const results = await Promise.all([
        decide('lead', made.body.id, 'APPROVED'),
        decide('hr', made.body.id, 'APPROVED'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await balance('nia', 'CL')).toMatchObject({ pending: 0, used: 2 });
    });

    it('records one application when Apply is tapped twice', async () => {
      const body = { leaveTypeId: ids.cl, fromDate: '2026-11-10', toDate: '2026-11-10' };
      const results = await Promise.all([apply('eve', body), apply('eve', body)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await balance('eve', 'CL')).toMatchObject({ pending: 1 });
      const ok = results.find((r) => r.status === 201)!;
      await cancel('eve', ok.body.id).expect(201);
      expect(await balance('eve', 'CL')).toMatchObject({ pending: 0 });
    });

    it('does not let two requests together spend more than the balance', async () => {
      // Joe has 4 Sick Leave days; two separate 3-day requests cannot both fit.
      const [a, b] = await Promise.all([
        apply('joe', { leaveTypeId: ids.sl, fromDate: '2026-11-16', toDate: '2026-11-18' }),
        apply('joe', { leaveTypeId: ids.sl, fromDate: '2026-11-23', toDate: '2026-11-25' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const sl = await balance('joe', 'SL');
      expect(sl.pending).toBe(3);
      expect(sl.available).toBe(1);
    });
  });

  describe('the team calendar', () => {
    it('shows approved and waiting leave in the caller’s reach, with holidays', async () => {
      const res = await request(server)
        .get('/api/v1/leave/calendar?from=2026-10-01&to=2026-10-31')
        .set(as('lead'))
        .expect(200);
      const people = new Set(
        res.body.leaves.map((l: { employee: { id: string } }) => l.employee.id),
      );
      expect(people.has(who.bob.employeeId)).toBe(true);
      expect(people.has(who.eve.employeeId)).toBe(false);
      expect(res.body.holidays.map((h: { name: string }) => h.name)).toContain('Test Holiday');
      expect(
        res.body.leaves.every((l: { status: string }) =>
          ['APPROVED', 'PENDING'].includes(l.status),
        ),
      ).toBe(true);
    });

    it('shows HR everyone', async () => {
      const res = await request(server)
        .get('/api/v1/leave/calendar?from=2026-10-01&to=2026-11-30')
        .set(as('hr'))
        .expect(200);
      const people = new Set(
        res.body.leaves.map((l: { employee: { id: string } }) => l.employee.id),
      );
      expect(people.has(who.eve.employeeId) || people.has(who.joe.employeeId)).toBe(true);
    });

    it('refuses a window that is too long or backwards', async () => {
      await request(server)
        .get('/api/v1/leave/calendar?from=2026-01-01&to=2026-12-31')
        .set(as('hr'))
        .expect(400);
      await request(server)
        .get('/api/v1/leave/calendar?from=2026-10-31&to=2026-10-01')
        .set(as('hr'))
        .expect(400);
    });
  });

  describe('team balances', () => {
    it('lists everyone in scope for HR, and only the team for a lead', async () => {
      const hr = await request(server).get('/api/v1/leave/balances/team').set(as('hr')).expect(200);
      const lead = await request(server)
        .get('/api/v1/leave/balances/team')
        .set(as('lead'))
        .expect(200);
      expect(hr.body.data.length).toBeGreaterThan(lead.body.data.length);
      const leadIds = lead.body.data.map((r: { employee: { id: string } }) => r.employee.id);
      expect(leadIds).toContain(who.ann.employeeId);
      expect(leadIds).not.toContain(who.eve.employeeId);
      expect(hr.body.types.length).toBe(4);
    });

    it('an employee sees only themself', async () => {
      const res = await request(server)
        .get('/api/v1/leave/balances/team')
        .set(as('ann'))
        .expect(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('leave in the attendance register', () => {
    it('a half-day leave shows as half a day on the record', async () => {
      // Wed 30 Sep, second half.
      const made = await apply('ann', {
        leaveTypeId: ids.cl,
        fromDate: '2026-09-30',
        toDate: '2026-09-30',
        dayPart: 'SECOND_HALF',
      });
      expect(made.status).toBe(201);
      expect(made.body.totalDays).toBe(0.5);
      await decide('lead', made.body.id, 'APPROVED').expect(201);
      expect(await balance('ann', 'CL')).toMatchObject({ used: 0.5 });
      const record = await prisma.attendanceRecord.findFirst({
        where: { employeeId: who.ann.employeeId, attendanceDate: d('2026-09-30') },
      });
      expect(record).toBeTruthy();
      expect(Number(record?.dayValue)).toBeLessThanOrEqual(0.5);
    });
  });

  describe('access', () => {
    it('needs a login', async () => {
      await request(server).get('/api/v1/leave/types').expect(401);
      await request(server).post('/api/v1/leave/requests').send({}).expect(401);
    });

    it('stops someone who cannot apply (no leave.create)', async () => {
      // Remove the permission from Finance's role for one request.
      const perm = await prisma.permission.findFirstOrThrow({ where: { key: 'leave.create' } });
      const role = await prisma.user.findFirstOrThrow({ where: { email: who.fin.email } });
      const row = await prisma.rolePermission.findFirstOrThrow({
        where: { roleId: role.roleId, permissionId: perm.id },
      });
      await prisma.rolePermission.delete({ where: { id: row.id } });
      // Permissions are cached per token, so log in again.
      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: who.fin.email, password: PASSWORD })
        .expect(200);
      const res = await request(server)
        .post('/api/v1/leave/requests')
        .set({ Authorization: `Bearer ${login.body.accessToken}` })
        .send({
          leaveTypeId: ids.cl,
          fromDate: '2026-10-14',
          toDate: '2026-10-14',
          reason: 'Because',
        });
      expect(res.status).toBe(403);
      await prisma.rolePermission.create({
        data: {
          companyId: ids.companyId,
          roleId: role.roleId,
          permissionId: perm.id,
          dataScope: 'OWN',
        },
      });
    });
  });
});
