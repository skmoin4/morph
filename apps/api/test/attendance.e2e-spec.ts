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
import { AttendanceService } from '../src/modules/attendance/attendance.service';
import { runInTenantContext, runUnscoped } from '../src/prisma/tenant-context';
import { resetDatabase, testPrisma as prisma } from './db';

const PASSWORD = 'Opsvera@2026';
const IST = 'Asia/Kolkata';
const RUH = 'Asia/Riyadh';
const d = (v: string) => new Date(`${v}T00:00:00.000Z`);

// A JPEG's first bytes: enough to pass the "is this really a photo" check.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

// Points near and far from the HQ pin (21.1458, 79.0882).
const NEAR = { latitude: '21.1462', longitude: '79.0885' }; // ~50 m
const FAR = { latitude: '21.1558', longitude: '79.0882' }; // ~1.1 km

/** Step 8: shifts, punching, the rule engine through the API, board, register, regularisation. */
describe('Attendance (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let fakeNow = new Date('2026-10-05T04:00:00.000Z');
  const clock = { now: () => fakeNow };

  /** Sets the server clock to an office-local wall time. */
  const clockAt = (date: string, time: string, tz = IST) => {
    fakeNow = officeLocalToUtc(date, time, tz);
  };

  const who = {
    ceo: { email: 'ceo@at.test', token: '', employeeId: '' },
    hr: { email: 'hr@at.test', token: '', employeeId: '' },
    lead: { email: 'lead@at.test', token: '', employeeId: '' },
    ann: { email: 'ann@at.test', token: '', employeeId: '' }, // BOTH, reports to lead
    bob: { email: 'bob@at.test', token: '', employeeId: '' }, // MOBILE only, reports to lead
    cal: { email: 'cal@at.test', token: '', employeeId: '' }, // OFFICE only, reports to lead
    dee: { email: 'dee@at.test', token: '', employeeId: '' }, // Riyadh
    eve: { email: 'eve@at.test', token: '', employeeId: '' }, // nobody's report
    sam: { email: 'sam@at.test', token: '', employeeId: '' }, // GPS-required client site
    nia: { email: 'nia@at.test', token: '', employeeId: '' }, // night shift, reports to lead
  };
  const ids = {
    companyId: '',
    hq: '',
    site: '',
    ruh: '',
    shiftGeneral: '',
    shiftNight: '',
    shiftRiyadh: '',
  };

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
        data: { name: 'Attendance Test Co', codePrefix: 'ATC', fyStartMonth: 4 },
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
            geofenceMode: 'FLAG',
            weeklyOffDays: [0],
            allowedIPs: ['127.0.0.1', '::1'],
          },
        })
      ).id;
      ids.site = (
        await prisma.office.create({
          data: {
            companyId,
            name: 'Client Site',
            shortCode: 'SITE',
            timezone: IST,
            latitude: '19.0760000',
            longitude: '72.8777000',
            geofenceRadiusM: 120,
            geofenceMode: 'REJECT',
            requiresGps: true,
            weeklyOffDays: [0],
            allowedIPs: [],
          },
        })
      ).id;
      ids.ruh = (
        await prisma.office.create({
          data: {
            companyId,
            name: 'Riyadh',
            shortCode: 'RUH',
            timezone: RUH,
            latitude: '24.7136000',
            longitude: '46.6753000',
            geofenceRadiusM: 250,
            weeklyOffDays: [5, 6],
            allowedIPs: ['212.118.10.0/24'],
          },
        })
      ).id;

      ids.shiftGeneral = (
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
        })
      ).id;
      ids.shiftNight = (
        await prisma.shift.create({
          data: {
            companyId,
            name: 'Night',
            startTime: '22:00',
            endTime: '06:00',
            crossesMidnight: true,
            breakMinutes: 45,
            graceMinutes: 15,
          },
        })
      ).id;
      ids.shiftRiyadh = (
        await prisma.shift.create({
          data: {
            companyId,
            name: 'Riyadh general',
            startTime: '08:00',
            endTime: '17:00',
            breakMinutes: 60,
            graceMinutes: 10,
          },
        })
      ).id;

      await prisma.attendancePolicy.createMany({
        data: [
          {
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
          {
            // The night shift's span is eight hours, so a full day is 7.5.
            companyId,
            shiftId: ids.shiftNight,
            name: 'Night',
            graceMinutes: 15,
            halfDayBelowHours: '4.00',
            fullDayMinimumHours: '7.50',
            overtimeAfterHours: '8.00',
            earlyExitBeforeMinutes: 15,
            lateMarksPerHalfDay: 0,
          },
        ],
      });

      await prisma.holiday.create({
        data: { companyId, officeId: ids.hq, name: 'Test Holiday', date: d('2026-10-08') },
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
        options: {
          officeId?: string;
          method?: 'MOBILE' | 'OFFICE' | 'BOTH';
          managerId?: string | null;
        } = {},
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
            employeeCode: `ATC-00${n}`,
            firstName: key,
            lastName: 'Tester',
            joiningDate: d('2024-01-01'),
            officeId: options.officeId ?? ids.hq,
            attendanceMethod: options.method ?? 'BOTH',
            managerId: options.managerId ?? null,
          },
        });
        who[key].employeeId = employee.id;
      }

      await person('ceo', 'CEO');
      await person('hr', 'HR_ADMIN');
      await person('lead', 'TEAM_LEAD');
      const m = who.lead.employeeId;
      await person('ann', 'EMPLOYEE', { managerId: m });
      await person('bob', 'EMPLOYEE', { managerId: m, method: 'MOBILE' });
      await person('cal', 'EMPLOYEE', { managerId: m, method: 'OFFICE' });
      await person('dee', 'EMPLOYEE', { officeId: ids.ruh });
      await person('eve', 'EMPLOYEE');
      await person('sam', 'EMPLOYEE', { officeId: ids.site });
      await person('nia', 'EMPLOYEE', { managerId: m });

      await prisma.shiftAssignment.createMany({
        data: [
          {
            companyId,
            shiftId: ids.shiftRiyadh,
            employeeId: who.dee.employeeId,
            effectiveFrom: d('2024-01-01'),
          },
          {
            companyId,
            shiftId: ids.shiftNight,
            employeeId: who.nia.employeeId,
            effectiveFrom: d('2024-01-01'),
          },
        ],
      });
    });
  }

  // --- helpers --------------------------------------------------------------

  const officePunch = (who_: keyof typeof who, body: Record<string, unknown> = {}) =>
    request(server).post('/api/v1/attendance/punch/office').set(as(who_)).send(body);

  const mobilePunch = (
    who_: keyof typeof who,
    point: { latitude: string; longitude: string },
    options: { selfie?: Buffer | null; name?: string; accuracyM?: string } = {},
  ) => {
    let req = request(server)
      .post('/api/v1/attendance/punch/mobile')
      .set(as(who_))
      .field('latitude', point.latitude)
      .field('longitude', point.longitude)
      .field('deviceInfo', 'Test phone');
    if (options.accuracyM) req = req.field('accuracyM', options.accuracyM);
    if (options.selfie !== null) {
      req = req.attach('selfie', options.selfie ?? JPEG, options.name ?? 'selfie.jpg');
    }
    return req;
  };

  const today = (key: keyof typeof who) =>
    request(server).get('/api/v1/attendance/me/today').set(as(key));

  /** Runs service code the way the nightly job does: inside a tenant scope. */
  const asJob = <T>(fn: (service: AttendanceService) => Promise<T>) =>
    runInTenantContext({ companyId: ids.companyId, userId: 'system:test', employeeId: null }, () =>
      fn(app.get(AttendanceService)),
    );

  // =========================================================================

  describe('office-network punching', () => {
    it('clocks in from an allowed address, then clocks out', async () => {
      clockAt('2026-10-05', '09:28');
      const first = await officePunch('ann').expect(201);
      expect(first.body.punch.type).toBe('IN');
      expect(first.body.punch.source).toBe('OFFICE_IP');
      expect(first.body.today.clockedIn).toBe(true);
      expect(first.body.today.nextAction).toBe('OUT');
      expect(first.body.today.status).toBe('PRESENT');

      clockAt('2026-10-05', '18:35');
      const second = await officePunch('ann').expect(201);
      expect(second.body.punch.type).toBe('OUT');
      expect(second.body.today.clockedIn).toBe(false);
      expect(second.body.today.nextAction).toBe('IN');
      expect(second.body.today.workedMinutes).toBe(487);
    });

    it('uses the server clock, and keeps a day open while people may still work', async () => {
      const res = await today('ann').expect(200);
      expect(res.body.date).toBe('2026-10-05');
      expect(res.body.office.timezone).toBe(IST);
      expect(res.body.methods).toEqual({ mobile: true, office: true });
      expect(res.body.network.allowed).toBe(true);
      // 18:35 is five minutes after shift end; the day closes four hours later.
      const record = await prisma.attendanceRecord.findFirstOrThrow({
        where: { employeeId: who.ann.employeeId },
      });
      expect(record.isFinal).toBe(false);
      expect(record.status).toBe('PRESENT');
    });

    it('refuses a double tap and a clock-out that is not possible', async () => {
      clockAt('2026-10-06', '09:20');
      await officePunch('bob').expect(403); // MOBILE-only: covered below, proves the guard order
      await officePunch('ann').expect(201);
      clockAt('2026-10-06', '09:20');
      fakeNow = new Date(fakeNow.getTime() + 5_000);
      const res = await officePunch('ann').expect(409);
      expect(res.body.code).toBe('DOUBLE_PUNCH');

      fakeNow = new Date(fakeNow.getTime() + 60_000);
      const out = await officePunch('ann', { type: 'IN' }).expect(409);
      expect(out.body.code).toBe('ALREADY_CLOCKED_IN');
    });

    it('refuses an office punch from an address that is not on the list', async () => {
      clockAt('2026-10-05', '08:05', RUH);
      const res = await officePunch('dee').expect(403);
      expect(res.body.code).toBe('OUTSIDE_NETWORK');
      expect(res.body.message).toMatch(/not one of Riyadh's office addresses/);
      // The refused punch left nothing behind.
      expect(await prisma.punch.count({ where: { employeeId: who.dee.employeeId } })).toBe(0);
    });

    it('respects each person’s attendance method', async () => {
      clockAt('2026-10-07', '09:30');
      const phoneOnly = await officePunch('bob').expect(403);
      expect(phoneOnly.body.code).toBe('METHOD_NOT_ALLOWED');

      const officeOnly = await mobilePunch('cal', NEAR).expect(403);
      expect(officeOnly.body.code).toBe('METHOD_NOT_ALLOWED');
    });

    it('does not accept office punches at a site that requires GPS', async () => {
      clockAt('2026-10-07', '09:30');
      const res = await officePunch('sam').expect(403);
      expect(res.body.code).toBe('GPS_REQUIRED');
    });
  });

  describe('mobile punching', () => {
    it('clocks in with a selfie inside the geofence', async () => {
      clockAt('2026-10-07', '09:31');
      const res = await mobilePunch('bob', NEAR, { accuracyM: '12' }).expect(201);
      expect(res.body.punch.type).toBe('IN');
      expect(res.body.punch.source).toBe('MOBILE_GPS');
      expect(res.body.punch.isFlagged).toBe(false);
      expect(res.body.punch.distanceM).toBeLessThan(100);

      const row = await prisma.punch.findFirstOrThrow({
        where: { employeeId: who.bob.employeeId },
      });
      expect(row.withinGeofence).toBe(true);
      expect(row.selfieDocumentId).toBeTruthy();
    });

    it('lets an outside punch through, flagged, where the office only flags', async () => {
      clockAt('2026-10-07', '09:31');
      const res = await mobilePunch('ann', FAR).expect(201);
      expect(res.body.punch.isFlagged).toBe(true);
      expect(res.body.punch.flagReason).toMatch(/from the site pin \(limit 200 m\)/);

      const board = await request(server)
        .get('/api/v1/attendance/board?date=2026-10-07&flagged=true')
        .set(as('hr'))
        .expect(200);
      expect(board.body.data.map((r: { employeeId: string }) => r.employeeId)).toContain(
        who.ann.employeeId,
      );
    });

    it('refuses an outside punch where the site rejects, with the distance', async () => {
      clockAt('2026-10-07', '09:31');
      const res = await mobilePunch('sam', FAR).expect(422);
      expect(res.body.code).toBe('OUTSIDE_GEOFENCE');
      expect(res.body.message).toMatch(/allowed within 120 m/);
      expect(res.body.details.radiusM).toBe(120);
      expect(await prisma.punch.count({ where: { employeeId: who.sam.employeeId } })).toBe(0);
    });

    it('accepts a punch at the site when the person is actually there', async () => {
      clockAt('2026-10-07', '09:31');
      const res = await mobilePunch('sam', { latitude: '19.0762', longitude: '72.8778' }).expect(
        201,
      );
      expect(res.body.punch.isFlagged).toBe(false);
    });

    it('needs a real selfie', async () => {
      clockAt('2026-10-08', '09:31');
      const none = await mobilePunch('ann', NEAR, { selfie: null }).expect(400);
      expect(none.body.code).toBe('SELFIE_REQUIRED');

      const renamed = await mobilePunch('ann', NEAR, {
        selfie: Buffer.from('this is a pdf, not a picture'),
      }).expect(400);
      expect(renamed.body.code).toBe('UNSUPPORTED_FILE');

      const wrongType = await mobilePunch('ann', NEAR, { name: 'selfie.exe' }).expect(400);
      expect(wrongType.body.code).toBe('UNSUPPORTED_FILE');
    });

    it('refuses coordinates that cannot be real', async () => {
      clockAt('2026-10-08', '09:31');
      await mobilePunch('ann', { latitude: '0', longitude: '0' }).expect(422);
      await mobilePunch('ann', { latitude: '95', longitude: '10' }).expect(422);
      await request(server)
        .post('/api/v1/attendance/punch/mobile')
        .set(as('ann'))
        .attach('selfie', JPEG, 'selfie.jpg')
        .expect(422);
    });

    it('flags a position the phone is not sure about', async () => {
      clockAt('2026-10-09', '09:31');
      const res = await mobilePunch('ann', NEAR, { accuracyM: '800' }).expect(201);
      expect(res.body.punch.flagReason).toMatch(/±800 m/);
    });
  });

  describe('a night shift', () => {
    it('keeps the 06:00 clock-out on the shift that started the evening before', async () => {
      clockAt('2026-10-05', '21:55');
      const inn = await officePunch('nia').expect(201);
      expect(inn.body.punch.attendanceDate).toBe('2026-10-05');

      clockAt('2026-10-06', '06:05');
      const out = await officePunch('nia').expect(201);
      expect(out.body.punch.type).toBe('OUT');
      expect(out.body.punch.attendanceDate).toBe('2026-10-05');

      const records = await prisma.attendanceRecord.findMany({
        where: { employeeId: who.nia.employeeId },
      });
      expect(records).toHaveLength(1);
      expect(records[0].attendanceDate.toISOString().slice(0, 10)).toBe('2026-10-05');
      // 490 minutes at work against the night shift's own 7.5 h full day.
      expect(records[0].status).toBe('PRESENT');
      expect(records[0].isLate).toBe(false);
    });

    it('starts the next night as a new day', async () => {
      clockAt('2026-10-06', '21:57');
      const res = await officePunch('nia').expect(201);
      expect(res.body.punch.attendanceDate).toBe('2026-10-06');
      expect(res.body.punch.type).toBe('IN');
    });
  });

  describe('settling days', () => {
    it('judges a finished day for good, and keeps the result if the policy changes', async () => {
      clockAt('2026-10-06', '12:00'); // well after Monday's 22:35 close
      const written = await asJob((s) => s.settleRecentDays(5));
      expect(written).toBeGreaterThan(0);

      const monday = await prisma.attendanceRecord.findFirstOrThrow({
        where: { employeeId: who.ann.employeeId, attendanceDate: d('2026-10-05') },
      });
      expect(monday.isFinal).toBe(true);
      expect(monday.status).toBe('PRESENT');
      expect(Number(monday.dayValue)).toBe(1);

      // Tighten the policy afterwards: settled history does not move.
      await prisma.attendancePolicy.updateMany({
        where: { name: 'Default' },
        data: { fullDayMinimumHours: '12.00' },
      });
      const detail = await request(server)
        .get(`/api/v1/attendance/employees/${who.ann.employeeId}?from=2026-10-05&to=2026-10-05`)
        .set(as('hr'))
        .expect(200);
      expect(detail.body.days[0].status).toBe('PRESENT');
      await prisma.attendancePolicy.updateMany({
        where: { name: 'Default' },
        data: { fullDayMinimumHours: '8.00' },
      });
    });

    it('marks someone who never punched absent once the day is over, and writes the weekly off', async () => {
      const eveMonday = await prisma.attendanceRecord.findFirstOrThrow({
        where: { employeeId: who.eve.employeeId, attendanceDate: d('2026-10-05') },
      });
      expect(eveMonday.status).toBe('ABSENT');
      expect(eveMonday.isFinal).toBe(true);

      await asJob((s) => s.recomputeRange([who.eve.employeeId], '2026-09-27', '2026-09-27'));
      const sunday = await prisma.attendanceRecord.findFirstOrThrow({
        where: { employeeId: who.eve.employeeId, attendanceDate: d('2026-09-27') },
      });
      expect(sunday.status).toBe('WEEKLY_OFF');
    });

    it('calls Riyadh’s Friday a weekly off and Sunday a working day', async () => {
      clockAt('2026-10-12', '12:00', RUH);
      await asJob((s) =>
        s.recomputeRange([who.dee.employeeId], '2026-10-01', '2026-10-04', { force: true }),
      );
      const rows = await prisma.attendanceRecord.findMany({
        where: { employeeId: who.dee.employeeId },
        orderBy: { attendanceDate: 'asc' },
      });
      const byDate = Object.fromEntries(
        rows.map((r) => [r.attendanceDate.toISOString().slice(0, 10), r.status]),
      );
      expect(byDate['2026-10-02']).toBe('WEEKLY_OFF'); // Friday
      expect(byDate['2026-10-03']).toBe('WEEKLY_OFF'); // Saturday
      expect(byDate['2026-10-04']).toBe('ABSENT'); // Sunday: a working day, nobody came
    });

    it('applies the office holiday', async () => {
      await asJob((s) =>
        s.recomputeRange([who.eve.employeeId], '2026-10-08', '2026-10-08', { force: true }),
      );
      const row = await prisma.attendanceRecord.findFirstOrThrow({
        where: { employeeId: who.eve.employeeId, attendanceDate: d('2026-10-08') },
      });
      expect(row.status).toBe('HOLIDAY');
      expect(row.holidayId).toBeTruthy();
    });
  });

  describe('late marks', () => {
    it('costs half a day on every third late mark, and gives it back when one is corrected', async () => {
      // Three late Mondays for cal, by direct punches.
      const mondays = ['2026-10-12', '2026-10-19', '2026-10-26'];
      for (const date of mondays) {
        await prisma.punch.createMany({
          data: [
            {
              companyId: ids.companyId,
              employeeId: who.cal.employeeId,
              officeId: ids.hq,
              type: 'IN',
              source: 'OFFICE_IP',
              punchedAt: officeLocalToUtc(date, '10:20', IST),
              attendanceDate: d(date),
            },
            {
              companyId: ids.companyId,
              employeeId: who.cal.employeeId,
              officeId: ids.hq,
              type: 'OUT',
              source: 'OFFICE_IP',
              punchedAt: officeLocalToUtc(date, '19:20', IST),
              attendanceDate: d(date),
            },
          ],
        });
      }
      clockAt('2026-10-30', '12:00');
      for (const date of mondays) {
        await asJob((s) => s.recomputeRange([who.cal.employeeId], date, date, { force: true }));
      }

      const rows = await prisma.attendanceRecord.findMany({
        where: { employeeId: who.cal.employeeId, status: 'LATE' },
        orderBy: { attendanceDate: 'asc' },
      });
      expect(rows.map((r) => Number(r.lateMarkDeduction))).toEqual([0, 0, 0.5]);
      expect(rows.every((r) => Number(r.dayValue) === 1)).toBe(true);

      const register = await request(server)
        .get('/api/v1/attendance/register?month=2026-10')
        .set(as('hr'))
        .expect(200);
      const cal = register.body.data.find(
        (r: { employeeId: string }) => r.employeeId === who.cal.employeeId,
      );
      expect(cal.totals.late).toBe(3);
      expect(cal.totals.lateMarkPenaltyDays).toBe(0.5);
    });
  });

  describe('concurrency', () => {
    it('records exactly one clock-in when the same person taps five times at once', async () => {
      clockAt('2026-11-02', '09:30');
      const results = await Promise.all(Array.from({ length: 5 }, () => officePunch('cal')));
      const created = results.filter((r) => r.status === 201);
      const refused = results.filter((r) => r.status === 409);
      expect(created).toHaveLength(1);
      expect(refused).toHaveLength(4);
      expect(
        await prisma.punch.count({
          where: { employeeId: who.cal.employeeId, attendanceDate: d('2026-11-02') },
        }),
      ).toBe(1);
    });
  });

  describe('approved leave', () => {
    it('shows paid leave as leave, and a half day of leave as a half day expected', async () => {
      const leaveType = await prisma.leaveType.create({
        data: {
          companyId: ids.companyId,
          name: 'Casual',
          shortCode: 'CL',
          yearlyQuota: '12.00',
          isPaid: true,
          allowHalfDay: true,
        } as never,
      });
      await prisma.leaveRequest.createMany({
        data: [
          {
            companyId: ids.companyId,
            employeeId: who.eve.employeeId,
            leaveTypeId: leaveType.id,
            fromDate: d('2026-11-03'),
            toDate: d('2026-11-03'),
            dayPart: 'FULL_DAY',
            totalDays: '1.00',
            reason: 'Family function',
            status: 'APPROVED',
          },
          {
            companyId: ids.companyId,
            employeeId: who.eve.employeeId,
            leaveTypeId: leaveType.id,
            fromDate: d('2026-11-04'),
            toDate: d('2026-11-04'),
            dayPart: 'FIRST_HALF',
            totalDays: '0.50',
            reason: 'Appointment',
            status: 'APPROVED',
          },
          {
            // Not approved: must not count.
            companyId: ids.companyId,
            employeeId: who.eve.employeeId,
            leaveTypeId: leaveType.id,
            fromDate: d('2026-11-05'),
            toDate: d('2026-11-05'),
            dayPart: 'FULL_DAY',
            totalDays: '1.00',
            reason: 'Pending',
            status: 'PENDING',
          },
        ] as never,
      });

      clockAt('2026-11-10', '12:00');
      const res = await request(server)
        .get(`/api/v1/attendance/employees/${who.eve.employeeId}?from=2026-11-03&to=2026-11-05`)
        .set(as('hr'))
        .expect(200);
      const byDate = Object.fromEntries(
        res.body.days.map((x: { date: string; status: string; dayValue: number }) => [x.date, x]),
      );
      expect(byDate['2026-11-03']).toMatchObject({ status: 'ON_LEAVE', dayValue: 1 });
      // Half a day off and nobody came in for the other half: the leave credit only.
      expect(byDate['2026-11-04']).toMatchObject({ status: 'ON_LEAVE', dayValue: 0.5 });
      // A request that was never approved is just an absence.
      expect(byDate['2026-11-05'].status).toBe('ABSENT');
    });
  });

  describe('data scope', () => {
    beforeAll(() => clockAt('2026-10-07', '12:00'));

    it('shows HR everyone on the board', async () => {
      const res = await request(server)
        .get('/api/v1/attendance/board?date=2026-10-07&pageSize=100')
        .set(as('hr'))
        .expect(200);
      expect(res.body.summary.total).toBe(10);
    });

    it('shows a Team Lead only their team', async () => {
      const res = await request(server)
        .get('/api/v1/attendance/board?date=2026-10-07&pageSize=100')
        .set(as('lead'))
        .expect(200);
      const ids_ = res.body.data.map((r: { employeeId: string }) => r.employeeId).sort();
      expect(ids_).toEqual(
        [
          who.lead.employeeId,
          who.ann.employeeId,
          who.bob.employeeId,
          who.cal.employeeId,
          who.nia.employeeId,
        ].sort(),
      );
      expect(ids_).not.toContain(who.eve.employeeId);
    });

    it('shows an employee only themselves', async () => {
      const res = await request(server)
        .get('/api/v1/attendance/board?date=2026-10-07')
        .set(as('ann'))
        .expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].employeeId).toBe(who.ann.employeeId);
    });

    it('404s for someone outside the caller’s scope', async () => {
      await request(server)
        .get(`/api/v1/attendance/employees/${who.eve.employeeId}?from=2026-10-05&to=2026-10-07`)
        .set(as('lead'))
        .expect(404);
      await request(server)
        .get(`/api/v1/attendance/employees/${who.ann.employeeId}/days/2026-10-07`)
        .set(as('eve'))
        .expect(404);
    });

    it('applies the same scope to the register and the export', async () => {
      const register = await request(server)
        .get('/api/v1/attendance/register?month=2026-10&pageSize=100')
        .set(as('lead'))
        .expect(200);
      expect(register.body.meta.total).toBe(5);

      // The export asks the same service, so it carries the same scope: a Team
      // Lead's workbook holds their team and nobody else.
      const book = await request(server)
        .get('/api/v1/attendance/export?month=2026-10')
        .set(as('lead'))
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (c: Buffer) => chunks.push(c));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(book.body as never);
      const names: string[] = [];
      workbook.getWorksheet('Register')!.eachRow((row, i) => {
        if (
          i > 1 &&
          typeof row.getCell(2).value === 'string' &&
          String(row.getCell(2).value).endsWith('Tester')
        ) {
          names.push(String(row.getCell(2).value));
        }
      });
      expect(names.sort()).toEqual([
        'ann Tester',
        'bob Tester',
        'cal Tester',
        'lead Tester',
        'nia Tester',
      ]);

      // An employee has no export permission at all.
      await request(server)
        .get('/api/v1/attendance/export?month=2026-10')
        .set(as('ann'))
        .expect(403);
    });

    it('reports where each person is today', async () => {
      const res = await request(server)
        .get('/api/v1/attendance/board?date=2026-10-07&pageSize=100')
        .set(as('hr'))
        .expect(200);
      const byId = Object.fromEntries(
        res.body.data.map((r: { employeeId: string; status: string }) => [r.employeeId, r.status]),
      );
      expect(byId[who.bob.employeeId]).toBe('PRESENT');
      // Midday on the 7th: the day is not over, so Eve is "not in yet", not absent.
      expect(byId[who.eve.employeeId]).toBe('NOT_IN');
    });
  });

  describe('the live board', () => {
    it('says "not in yet", not "absent", while the day is young', async () => {
      clockAt('2026-10-13', '09:00');
      const res = await request(server)
        .get('/api/v1/attendance/board?date=2026-10-13&pageSize=100')
        .set(as('hr'))
        .expect(200);
      expect(res.body.summary.notIn).toBeGreaterThan(0);
      expect(res.body.summary.absent).toBe(0);
    });

    it('counts a clock that is still running', async () => {
      clockAt('2026-10-13', '09:25');
      await officePunch('ann').expect(201);
      clockAt('2026-10-13', '11:25');
      const res = await request(server)
        .get('/api/v1/attendance/board?date=2026-10-13&pageSize=100')
        .set(as('hr'))
        .expect(200);
      const ann = res.body.data.find(
        (r: { employeeId: string }) => r.employeeId === who.ann.employeeId,
      );
      expect(ann.clockedIn).toBe(true);
      expect(ann.workedMinutes).toBe(120);
      expect(ann.status).toBe('PRESENT');
    });

    it('filters by status and office', async () => {
      const res = await request(server)
        .get(`/api/v1/attendance/board?date=2026-10-13&status=NOT_IN&officeId=${ids.ruh}`)
        .set(as('hr'))
        .expect(200);
      expect(
        res.body.data.every((r: { office: { shortCode: string } }) => r.office.shortCode === 'RUH'),
      ).toBe(true);
    });
  });

  describe('the monthly register and its export', () => {
    it('lays the month out per person with totals', async () => {
      clockAt('2026-10-30', '12:00');
      const res = await request(server)
        .get('/api/v1/attendance/register?month=2026-10&pageSize=100')
        .set(as('hr'))
        .expect(200);
      expect(res.body.days).toHaveLength(31);
      expect(res.body.data).toHaveLength(10);

      const ann = res.body.data.find(
        (r: { employeeId: string }) => r.employeeId === who.ann.employeeId,
      );
      expect(ann.days).toHaveLength(31);
      const oct5 = ann.days.find((c: { date: string }) => c.date === '2026-10-05');
      expect(oct5.status).toBe('PRESENT');
      // Days after "today" in the person's office are blank.
      const future = await request(server)
        .get('/api/v1/attendance/register?month=2026-11')
        .set(as('hr'))
        .expect(200);
      expect(
        future.body.data[0].days.every((c: { status: string | null }) => c.status === null),
      ).toBe(true);
    });

    it('exports an Excel workbook with a register and daily detail', async () => {
      const res = await request(server)
        .get('/api/v1/attendance/export?month=2026-10')
        .set(as('hr'))
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (c: Buffer) => chunks.push(c));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('attendance-2026-10.xlsx');

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as never);
      expect(workbook.worksheets.map((w) => w.name)).toEqual(['Register', 'Daily detail']);
      const register = workbook.getWorksheet('Register')!;
      // Header + ten people (+ legend rows).
      expect(register.rowCount).toBeGreaterThanOrEqual(11);
      const annRow = register.getRows(2, 10)!.find((r) => r.getCell(2).value === 'ann Tester')!;
      expect(annRow.getCell(3 + 5).value).toBe('P'); // 5 Oct
    });
  });

  describe('regularisation', () => {
    const body = {
      attendanceDate: '2026-10-06',
      requestedInTime: '09:25',
      requestedOutTime: '18:30',
      reason: 'Phone was dead on arrival; I was at my desk from 09:25.',
    };

    it('lets a person ask, once per day', async () => {
      clockAt('2026-10-09', '10:00');
      const created = await request(server)
        .post('/api/v1/attendance/regularisations')
        .set(as('ann'))
        .send(body)
        .expect(201);
      expect(created.body.status).toBe('PENDING');
      const again = await request(server)
        .post('/api/v1/attendance/regularisations')
        .set(as('ann'))
        .send(body)
        .expect(409);
      expect(again.body.code).toBe('ALREADY_PENDING');
    });

    it('refuses the wrong days and the wrong times', async () => {
      const post = (b: object) =>
        request(server)
          .post('/api/v1/attendance/regularisations')
          .set(as('bob'))
          .send({ reason: 'A good enough reason.', ...b });
      await post({ attendanceDate: '2026-10-20', requestedInTime: '09:30' }).expect(400); // future
      await post({ attendanceDate: '2026-08-01', requestedInTime: '09:30' }).expect(400); // too old
      await post({ attendanceDate: '2026-10-04', requestedInTime: '09:30' }).expect(400); // a Sunday
      await post({ attendanceDate: '2026-10-08', requestedInTime: '09:30' }).expect(400); // a holiday
      await post({
        attendanceDate: '2026-10-06',
        requestedInTime: '18:00',
        requestedOutTime: '09:00',
      }).expect(400);
      await post({ attendanceDate: '2026-10-06' }).expect(422); // no times
      await post({ attendanceDate: '2026-10-06', requestedInTime: '9:5' }).expect(422); // bad format
    });

    it('lets the manager approve; the corrected punches replace the raw ones and the raw ones stay', async () => {
      const list = await request(server)
        .get('/api/v1/attendance/regularisations?status=PENDING')
        .set(as('lead'))
        .expect(200);
      const request_ = list.body.data.find(
        (r: { employeeId: string }) => r.employeeId === who.ann.employeeId,
      );
      expect(request_.canDecide).toBe(true);

      // Before: ann clocked in at 09:20 on the 6th and again... judged as it stood.
      const decided = await request(server)
        .post(`/api/v1/attendance/regularisations/${request_.id}/decision`)
        .set(as('lead'))
        .send({ decision: 'APPROVED', note: 'Seen on CCTV' })
        .expect(201);
      expect(decided.body.status).toBe('APPROVED');

      const detail = await request(server)
        .get(`/api/v1/attendance/employees/${who.ann.employeeId}/days/2026-10-06`)
        .set(as('lead'))
        .expect(200);
      expect(detail.body.result.status).toBe('PRESENT');
      const regularised = detail.body.punches.filter(
        (p: { source: string }) => p.source === 'REGULARISED',
      );
      expect(regularised).toHaveLength(2);
      // The punch the person really made is still there, marked as replaced.
      const raw = detail.body.punches.filter((p: { source: string }) => p.source === 'OFFICE_IP');
      expect(raw.length).toBeGreaterThan(0);

      const record = await prisma.attendanceRecord.findFirstOrThrow({
        where: { employeeId: who.ann.employeeId, attendanceDate: d('2026-10-06') },
      });
      expect(record.isRegularised).toBe(true);
      expect(record.lateMinutes).toBe(0);

      const audit = await prisma.auditLog.findFirst({
        where: { entityType: 'RegularisationRequest', action: 'APPROVE' },
      });
      expect(audit).not.toBeNull();
    });

    it('does not let anyone decide their own request', async () => {
      const mine = await request(server)
        .post('/api/v1/attendance/regularisations')
        .set(as('lead'))
        .send({ ...body, attendanceDate: '2026-10-07', requestedOutTime: '18:45' })
        .expect(201);
      const res = await request(server)
        .post(`/api/v1/attendance/regularisations/${mine.body.id}/decision`)
        .set(as('lead'))
        .send({ decision: 'APPROVED' })
        .expect(403);
      expect(res.body.code).toBe('SELF_APPROVAL');
      // HR can.
      await request(server)
        .post(`/api/v1/attendance/regularisations/${mine.body.id}/decision`)
        .set(as('hr'))
        .send({ decision: 'APPROVED' })
        .expect(201);
    });

    it('keeps a request outside the manager’s team out of sight', async () => {
      const theirs = await request(server)
        .post('/api/v1/attendance/regularisations')
        .set(as('eve'))
        .send({ ...body, attendanceDate: '2026-10-07' })
        .expect(201);

      const list = await request(server)
        .get('/api/v1/attendance/regularisations')
        .set(as('lead'))
        .expect(200);
      expect(list.body.data.some((r: { id: string }) => r.id === theirs.body.id)).toBe(false);
      await request(server)
        .post(`/api/v1/attendance/regularisations/${theirs.body.id}/decision`)
        .set(as('lead'))
        .send({ decision: 'APPROVED' })
        .expect(404);

      // Rejecting needs a reason; the person can cancel their own.
      await request(server)
        .post(`/api/v1/attendance/regularisations/${theirs.body.id}/decision`)
        .set(as('hr'))
        .send({ decision: 'REJECTED' })
        .expect(422);
      await request(server)
        .post(`/api/v1/attendance/regularisations/${theirs.body.id}/decision`)
        .set(as('hr'))
        .send({ decision: 'REJECTED', note: 'No evidence provided' })
        .expect(201);
      await request(server)
        .post(`/api/v1/attendance/regularisations/${theirs.body.id}/cancel`)
        .set(as('eve'))
        .expect(409);
    });

    it('lets a person cancel a request that is still waiting', async () => {
      const mine = await request(server)
        .post('/api/v1/attendance/regularisations')
        .set(as('bob'))
        .send({ ...body, attendanceDate: '2026-10-07' })
        .expect(201);
      const cancelled = await request(server)
        .post(`/api/v1/attendance/regularisations/${mine.body.id}/cancel`)
        .set(as('bob'))
        .expect(201);
      expect(cancelled.body.status).toBe('CANCELLED');
      await request(server)
        .post(`/api/v1/attendance/regularisations/${mine.body.id}/cancel`)
        .set(as('ann'))
        .expect(404);
    });

    it('can fix a forgotten clock-out so the day is credited in full', async () => {
      // Bob clocked in on the 13th and never out.
      clockAt('2026-10-13', '09:30');
      await mobilePunch('bob', NEAR).expect(201);
      clockAt('2026-10-15', '10:00');
      await asJob((s) =>
        s.recomputeRange([who.bob.employeeId], '2026-10-13', '2026-10-13', { force: true }),
      );
      let record = await prisma.attendanceRecord.findFirstOrThrow({
        where: { employeeId: who.bob.employeeId, attendanceDate: d('2026-10-13') },
      });
      expect(record.status).toBe('HALF_DAY');
      expect(record.flagReason).toMatch(/No clock-out/);

      const req = await request(server)
        .post('/api/v1/attendance/regularisations')
        .set(as('bob'))
        .send({
          attendanceDate: '2026-10-13',
          requestedOutTime: '18:40',
          reason: 'Forgot to clock out; left at 18:40.',
        })
        .expect(201);
      await request(server)
        .post(`/api/v1/attendance/regularisations/${req.body.id}/decision`)
        .set(as('lead'))
        .send({ decision: 'APPROVED' })
        .expect(201);

      record = await prisma.attendanceRecord.findFirstOrThrow({
        where: { employeeId: who.bob.employeeId, attendanceDate: d('2026-10-13') },
      });
      expect(record.status).toBe('PRESENT');
      expect(Number(record.dayValue)).toBe(1);
      expect(record.isRegularised).toBe(true);
    });
  });

  describe('selfies', () => {
    async function selfiePunchId() {
      const punch = await prisma.punch.findFirstOrThrow({
        where: { employeeId: who.bob.employeeId, selfieDocumentId: { not: null } },
      });
      return punch.id;
    }

    it('shows a selfie to its owner and to the person’s manager, and no-one else', async () => {
      const id = await selfiePunchId();
      const own = await request(server)
        .get(`/api/v1/attendance/punches/${id}/selfie`)
        .set(as('bob'))
        .expect(200);
      expect(own.headers['cache-control']).toContain('no-store');
      expect(own.headers['x-content-type-options']).toBe('nosniff');

      await request(server)
        .get(`/api/v1/attendance/punches/${id}/selfie`)
        .set(as('lead'))
        .expect(200);
      await request(server)
        .get(`/api/v1/attendance/punches/${id}/selfie`)
        .set(as('hr'))
        .expect(200);
      await request(server)
        .get(`/api/v1/attendance/punches/${id}/selfie`)
        .set(as('eve'))
        .expect(404);
    });
  });

  describe('shifts', () => {
    it('creates a shift, works out that it crosses midnight, and refuses duplicates', async () => {
      const res = await request(server)
        .post('/api/v1/shifts')
        .set(as('hr'))
        .send({
          name: 'Late night',
          startTime: '23:00',
          endTime: '07:00',
          breakMinutes: 30,
          graceMinutes: 10,
        })
        .expect(201);
      expect(res.body.crossesMidnight).toBe(true);
      expect(res.body.isDefault).toBe(false);

      await request(server)
        .post('/api/v1/shifts')
        .set(as('hr'))
        .send({
          name: 'Late night',
          startTime: '10:00',
          endTime: '19:00',
          breakMinutes: 30,
          graceMinutes: 10,
        })
        .expect(409);
    });

    it('rejects an impossible shift', async () => {
      const post = (b: object) =>
        request(server)
          .post('/api/v1/shifts')
          .set(as('hr'))
          .send({ name: 'Odd', breakMinutes: 30, graceMinutes: 5, ...b });
      await post({ startTime: '09:00', endTime: '09:00' }).expect(422);
      await post({ startTime: '25:00', endTime: '09:00' }).expect(422);
      await post({ startTime: '09:00', endTime: '09:20', breakMinutes: 30 }).expect(422);
    });

    it('keeps exactly one default and protects it', async () => {
      const second = await request(server)
        .post('/api/v1/shifts')
        .set(as('hr'))
        .send({
          name: 'Second default',
          startTime: '10:00',
          endTime: '19:00',
          breakMinutes: 60,
          graceMinutes: 10,
          isDefault: true,
        })
        .expect(201);
      expect(second.body.isDefault).toBe(true);
      expect(await prisma.shift.count({ where: { isDefault: true } })).toBe(1);

      // The old default is no longer protected; the new one is.
      const res = await request(server)
        .put(`/api/v1/shifts/${second.body.id}`)
        .set(as('hr'))
        .send({
          name: 'Second default',
          startTime: '10:00',
          endTime: '19:00',
          breakMinutes: 60,
          graceMinutes: 10,
          isDefault: false,
        })
        .expect(409);
      expect(res.body.code).toBe('DEFAULT_SHIFT');
      await request(server).delete(`/api/v1/shifts/${second.body.id}`).set(as('hr')).expect(409);

      // Put it back, so the other tests keep their default.
      await request(server)
        .put(`/api/v1/shifts/${ids.shiftGeneral}`)
        .set(as('hr'))
        .send({
          name: 'General',
          startTime: '09:30',
          endTime: '18:30',
          breakMinutes: 60,
          graceMinutes: 10,
          isDefault: true,
        })
        .expect(200);
    });

    it('chains assignments with no gap, and hands back after a temporary change', async () => {
      // Eve on the night shift for a fortnight, then back to what she had.
      await request(server)
        .post(`/api/v1/shifts/${ids.shiftGeneral}/assignments`)
        .set(as('hr'))
        .send({ employeeId: who.eve.employeeId, effectiveFrom: '2026-11-01' })
        .expect(201);

      await request(server)
        .post(`/api/v1/shifts/${ids.shiftNight}/assignments`)
        .set(as('hr'))
        .send({
          employeeId: who.eve.employeeId,
          effectiveFrom: '2026-11-10',
          effectiveTo: '2026-11-24',
        })
        .expect(201);

      const rows = await prisma.shiftAssignment.findMany({
        where: { employeeId: who.eve.employeeId },
        orderBy: { effectiveFrom: 'asc' },
      });
      const summary = rows.map((r) => [
        r.shiftId === ids.shiftNight ? 'night' : 'general',
        r.effectiveFrom.toISOString().slice(0, 10),
        r.effectiveTo?.toISOString().slice(0, 10) ?? null,
      ]);
      expect(summary).toEqual([
        ['general', '2026-11-01', '2026-11-10'],
        ['night', '2026-11-10', '2026-11-24'],
        ['general', '2026-11-24', null],
      ]);
    });

    it('refuses an assignment that would overlap a later one', async () => {
      const res = await request(server)
        .post(`/api/v1/shifts/${ids.shiftGeneral}/assignments`)
        .set(as('hr'))
        .send({ employeeId: who.eve.employeeId, effectiveFrom: '2026-11-05' })
        .expect(409);
      expect(res.body.code).toBe('OVERLAP');
    });

    it('needs exactly one of a person or a department', async () => {
      await request(server)
        .post(`/api/v1/shifts/${ids.shiftGeneral}/assignments`)
        .set(as('hr'))
        .send({ effectiveFrom: '2026-12-01' })
        .expect(422);
      await request(server)
        .post(`/api/v1/shifts/${ids.shiftGeneral}/assignments`)
        .set(as('hr'))
        .send({ employeeId: who.eve.employeeId, departmentId: 'x', effectiveFrom: '2026-12-01' })
        .expect(422);
    });

    it('shows the week on the roster, with weekly offs and holidays, for those in scope', async () => {
      const res = await request(server)
        .get('/api/v1/shifts/roster?weekOf=2026-10-07&pageSize=100')
        .set(as('hr'))
        .expect(200);
      expect(res.body.weekStart).toBe('2026-10-05');
      expect(res.body.days).toHaveLength(7);

      const ann = res.body.data.find(
        (r: { employeeId: string }) => r.employeeId === who.ann.employeeId,
      );
      expect(ann.days[0]).toMatchObject({
        date: '2026-10-05',
        kind: 'SHIFT',
        shift: 'General',
        start: '09:30',
      });
      expect(ann.days[3]).toMatchObject({
        date: '2026-10-08',
        kind: 'HOLIDAY',
        label: 'Test Holiday',
      });
      expect(ann.days[6]).toMatchObject({ date: '2026-10-11', kind: 'OFF' });

      const dee = res.body.data.find(
        (r: { employeeId: string }) => r.employeeId === who.dee.employeeId,
      );
      expect(dee.days[0]).toMatchObject({ kind: 'SHIFT', shift: 'Riyadh general', start: '08:00' });
      // Riyadh is off Friday and Saturday, and works Sunday.
      expect(dee.days[4].kind).toBe('OFF');
      expect(dee.days[5].kind).toBe('OFF');
      expect(dee.days[6].kind).toBe('SHIFT');
    });

    it('keeps shifts to the roles that manage them', async () => {
      // Shifts are an HR matter: a Team Lead sees attendance, not the roster.
      await request(server).get('/api/v1/shifts/roster').set(as('lead')).expect(403);
      await request(server).get('/api/v1/shifts').set(as('ann')).expect(403);
      await request(server)
        .post('/api/v1/shifts')
        .set(as('lead'))
        .send({
          name: 'Nope',
          startTime: '09:00',
          endTime: '17:00',
          breakMinutes: 30,
          graceMinutes: 5,
        })
        .expect(403);
      await request(server).get('/api/v1/shifts/lookups').set(as('ann')).expect(403);
    });

    it('refuses to delete a shift that has been used, but allows deactivating it', async () => {
      const res = await request(server)
        .delete(`/api/v1/shifts/${ids.shiftNight}`)
        .set(as('hr'))
        .expect(409);
      expect(res.body.code).toBe('IN_USE');

      const unused = await request(server)
        .post('/api/v1/shifts')
        .set(as('hr'))
        .send({
          name: 'Never used',
          startTime: '06:00',
          endTime: '14:00',
          breakMinutes: 30,
          graceMinutes: 5,
        })
        .expect(201);
      await request(server).delete(`/api/v1/shifts/${unused.body.id}`).set(as('hr')).expect(204);
      // The name is free again.
      await request(server)
        .post('/api/v1/shifts')
        .set(as('hr'))
        .send({
          name: 'Never used',
          startTime: '06:00',
          endTime: '14:00',
          breakMinutes: 30,
          graceMinutes: 5,
        })
        .expect(201);
    });
  });
});
