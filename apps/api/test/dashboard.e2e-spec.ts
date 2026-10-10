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
const RUH = 'Asia/Riyadh';
const d = (v: string) => new Date(`${v}T00:00:00.000Z`);

/** Step 13: the dashboards, and what each role is allowed to see on them. */
describe('Dashboards (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  // Friday 09 Oct 2026, mid-morning in India.
  const fakeNow = officeLocalToUtc('2026-10-09', '11:00', IST);
  const clock = { now: () => fakeNow };

  const who = {
    ceo: { email: 'ceo@db.test', token: '', employeeId: '', userId: '' },
    hr: { email: 'hr@db.test', token: '', employeeId: '', userId: '' },
    lead: { email: 'lead@db.test', token: '', employeeId: '', userId: '' },
    pm: { email: 'pm@db.test', token: '', employeeId: '', userId: '' },
    fin: { email: 'fin@db.test', token: '', employeeId: '', userId: '' },
    ann: { email: 'ann@db.test', token: '', employeeId: '', userId: '' },
    bob: { email: 'bob@db.test', token: '', employeeId: '', userId: '' },
    dee: { email: 'dee@db.test', token: '', employeeId: '', userId: '' },
    eve: { email: 'eve@db.test', token: '', employeeId: '', userId: '' },
  };
  const ids = { companyId: '', hq: '', ruh: '', p1: '', p2: '', p3: '', t1: '', ann1: '' };

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
    // Two people clock in from the office network.
    for (const key of ['ann', 'bob'] as const) {
      await request(server)
        .post('/api/v1/attendance/punch/office')
        .set(as(key))
        .send({})
        .expect(201);
    }
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  const as = (key: keyof typeof who) => ({ Authorization: `Bearer ${who[key].token}` });
  const exec = (key: keyof typeof who, qs = '') =>
    request(server).get(`/api/v1/dashboard/executive${qs}`).set(as(key));

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
        data: { name: 'Dash Test Co', codePrefix: 'DTC', fyStartMonth: 4, verbalEmailGraceDays: 7 },
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
            weeklyOffDays: [0],
            allowedIPs: ['127.0.0.1', '::1'],
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
            weeklyOffDays: [5, 6],
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
        officeId: string,
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
            employeeCode: `DTC-00${n}`,
            firstName: key,
            lastName: 'Tester',
            joiningDate: d('2024-01-01'),
            officeId,
            attendanceMethod: 'BOTH',
            managerId,
          },
        });
        who[key].employeeId = employee.id;
        who[key].userId = user.id;
      }
      await person('ceo', 'CEO', ids.hq);
      await person('hr', 'HR_ADMIN', ids.hq);
      await person('lead', 'TEAM_LEAD', ids.hq);
      await person('pm', 'PROJECT_MANAGER', ids.hq);
      await person('fin', 'FINANCE', ids.hq);
      await person('ann', 'EMPLOYEE', ids.hq, who.lead.employeeId);
      await person('bob', 'EMPLOYEE', ids.hq, who.lead.employeeId);
      await person('dee', 'EMPLOYEE', ids.ruh);
      await person('eve', 'EMPLOYEE', ids.hq);

      // --- Bookings ---------------------------------------------------------
      let b = 0;
      const booking = async (data: Record<string, unknown>) => {
        b += 1;
        return prisma.booking.create({
          data: {
            companyId,
            bookingNumber: `BKG-${b}`,
            clientId: client.id,
            projectName: `Booking ${b}`,
            projectTypeId: type.id,
            officeId: ids.hq,
            bookingDate: d('2026-10-05'),
            projectValue: '1000000.00',
            budgetHours: '100.00',
            expectedStartDate: d('2026-10-20'),
            expectedEndDate: d('2027-03-31'),
            status: 'CONFIRMED',
            ...data,
          } as never,
        });
      };
      await booking({ status: 'PROJECT_CREATED' });
      await booking({ status: 'PROJECT_CREATED', officeId: ids.ruh, projectValue: '500000.00' });
      await booking({ status: 'DRAFT' });
      await booking({ status: 'CANCELLED' });
      await booking({
        status: 'PROJECT_CREATED',
        bookingDate: d('2026-09-10'),
        projectValue: '700000.00',
      });
      const verbal = await booking({
        status: 'CONFIRMED',
        bookingDate: d('2026-08-20'),
        projectName: 'Old verbal booking',
      });
      await prisma.bookingConfirmation.create({
        data: {
          companyId,
          bookingId: verbal.id,
          type: 'VERBAL',
          confirmedByName: 'Client PM',
          confirmedOn: d('2026-09-01'),
          verbalMode: 'CALL',
          verbalSummary: 'Agreed on a call',
        } as never,
      });

      // --- Projects ---------------------------------------------------------
      async function project(
        code: string,
        officeId: string,
        pmId: string | null,
        over: Record<string, unknown>,
      ) {
        const bk = await booking({
          status: 'PROJECT_CREATED',
          generatedProjectCode: code,
          bookingDate: d('2026-07-01'),
        });
        return (
          await prisma.project.create({
            data: {
              companyId,
              projectCode: code,
              name: `Project ${code}`,
              bookingId: bk.id,
              clientId: client.id,
              projectTypeId: type.id,
              officeId,
              projectManagerId: pmId,
              projectValue: '1000000.00',
              budgetHours: '100.00',
              endDate: d('2027-03-31'),
              ...over,
            } as never,
          })
        ).id;
      }
      ids.p1 = await project('PJT-1', ids.hq, who.pm.employeeId, {
        actualHours: '85.00',
        actualLabourCost: '100000.00',
        actualTotalCost: '100000.00',
        health: 'AT_RISK',
        budgetAlertLevel: 80,
      });
      ids.p2 = await project('PJT-2', ids.hq, null, {
        actualHours: '120.00',
        actualLabourCost: '200000.00',
        actualExpenseCost: '5000.00',
        actualTotalCost: '205000.00',
        health: 'CRITICAL',
        budgetAlertLevel: 100,
      });
      ids.p3 = await project('PJT-3', ids.ruh, null, { actualHours: '10.00' });
      await project('PJT-4', ids.hq, null, { status: 'ON_HOLD' });
      for (const key of ['ann', 'bob'] as const) {
        await prisma.projectMember.create({
          data: { companyId, projectId: ids.p1, employeeId: who[key].employeeId },
        });
      }
      await prisma.projectMember.create({
        data: { companyId, projectId: ids.p3, employeeId: who.dee.employeeId },
      });
      await prisma.projectMember.create({
        data: { companyId, projectId: ids.p2, employeeId: who.eve.employeeId },
      });

      ids.t1 = (
        await prisma.task.create({
          data: { companyId, projectId: ids.p1, title: 'Modelling', status: 'DONE' },
        })
      ).id;
      ids.ann1 = (
        await prisma.task.create({
          data: {
            companyId,
            projectId: ids.p1,
            title: 'Clash review',
            status: 'IN_PROGRESS',
            assigneeId: who.ann.employeeId,
            dueDate: d('2026-10-07'),
            estimatedHours: '12.00',
          },
        })
      ).id;
      await prisma.task.create({
        data: {
          companyId,
          projectId: ids.p1,
          title: 'Drawings',
          status: 'TODO',
          assigneeId: who.ann.employeeId,
          dueDate: d('2026-10-30'),
        },
      });
      await prisma.milestone.create({
        data: {
          companyId,
          projectId: ids.p1,
          name: 'LOD300 issue',
          dueDate: d('2026-10-01'),
          status: 'PENDING',
        },
      });

      // --- Time -------------------------------------------------------------
      const entry = (
        employeeId: string,
        projectId: string,
        date: string,
        hours: string,
        isBillable = true,
      ) =>
        prisma.timeEntry.create({
          data: {
            companyId,
            employeeId,
            projectId,
            workDate: d(date),
            hours,
            isBillable,
            source: 'MANUAL',
          },
        });
      await entry(who.dee.employeeId, ids.p3, '2026-10-07', '12.00');
      await entry(who.ann.employeeId, ids.p1, '2026-10-08', '8.00');
      await entry(who.ann.employeeId, ids.p1, '2026-10-09', '4.00', false);
      // Ann logged time last week but never submitted it.
      await entry(who.ann.employeeId, ids.p1, '2026-09-30', '8.00');

      // --- Approvals waiting ------------------------------------------------
      await prisma.timesheet.create({
        data: {
          companyId,
          employeeId: who.ann.employeeId,
          weekStartDate: d('2026-10-05'),
          weekEndDate: d('2026-10-11'),
          status: 'SUBMITTED',
          totalHours: '12.00',
          billableHours: '8.00',
          submittedAt: new Date('2026-10-06T05:00:00Z'),
        },
      });
      const clType = await prisma.leaveType.create({
        data: {
          companyId,
          name: 'Casual Leave',
          shortCode: 'CL',
          yearlyQuota: '12.00',
          approvalFlow: 'SINGLE_LEVEL',
        },
      });
      await prisma.leaveRequest.create({
        data: {
          companyId,
          employeeId: who.bob.employeeId,
          leaveTypeId: clType.id,
          fromDate: d('2026-10-12'),
          toDate: d('2026-10-12'),
          totalDays: '1.00',
          reason: 'Family function',
          status: 'PENDING',
        },
      });
      const cat = await prisma.expenseCategory.create({
        data: { companyId, name: 'Travel', requiresReceipt: false },
      });
      const expense = (employeeId: string, status: string, amount: string, submitted: string) =>
        prisma.expense.create({
          data: {
            companyId,
            employeeId,
            projectId: ids.p1,
            categoryId: cat.id,
            expenseDate: d('2026-10-01'),
            amount,
            status,
            submittedAt: new Date(submitted),
          } as never,
        });
      await expense(who.ann.employeeId, 'PENDING_MANAGER', '1000.00', '2026-10-01T05:00:00Z');
      await expense(who.bob.employeeId, 'PENDING_FINANCE', '2000.00', '2026-10-02T05:00:00Z');
      await expense(who.ann.employeeId, 'APPROVED', '3000.00', '2026-10-01T05:00:00Z');
      await prisma.regularisationRequest.create({
        data: {
          companyId,
          employeeId: who.ann.employeeId,
          attendanceDate: d('2026-10-07'),
          requestedInTime: '09:30',
          reason: 'Forgot to punch',
          status: 'PENDING',
        },
      });

      // --- The ledger -------------------------------------------------------
      const posting = (
        projectId: string,
        date: string,
        amount: string,
        sourceType: string,
        hours: string | null,
        key: string,
      ) =>
        prisma.costLedgerEntry.create({
          data: {
            companyId,
            projectId,
            sourceType,
            sourceId: key,
            postingVersion: 1,
            postingDate: d(date),
            amount,
            hours,
            createdById: null,
          } as never,
        });
      await posting(ids.p1, '2026-09-15', '50000.00', 'TIMESHEET', '80.00', 'L1');
      await posting(ids.p1, '2026-10-05', '30000.00', 'TIMESHEET', '40.00', 'L2');
      await posting(ids.p1, '2026-10-05', '5000.00', 'EXPENSE', null, 'L3');
    });
  }

  // =========================================================================

  describe('the executive view for the CEO', () => {
    it('counts bookings made this month, with their value', async () => {
      const res = await exec('ceo').expect(200);
      // Two confirmed this month (Oct 5): HQ 1,000,000 and Riyadh 500,000; the four project-backing
      // bookings are dated July. Drafts and cancelled ones do not count.
      expect(res.body.kpis.booked).toEqual({ count: 2, projectValue: '1500000.00' });
      expect(res.body.today).toBe('2026-10-09');
      expect(res.body.monthStart).toBe('2026-10-01');
    });

    it('counts live projects and those that need attention', async () => {
      const res = await exec('ceo').expect(200);
      expect(res.body.kpis.activeProjects).toEqual({ count: 3, attention: 2 });
      expect(res.body.kpis.budget).toEqual({ over: 1, near: 1 });
    });

    it('ranks the portfolio by how far over budget, then by health', async () => {
      const res = await exec('ceo').expect(200);
      const codes = res.body.portfolio.map((p: { projectCode: string }) => p.projectCode);
      expect(codes).toEqual(['PJT-2', 'PJT-1', 'PJT-3']);
      expect(res.body.portfolio[0]).toMatchObject({
        burnPercent: 120,
        alertLevel: 100,
        health: 'CRITICAL',
      });
      expect(res.body.portfolio[1]).toMatchObject({
        burnPercent: 85,
        alertLevel: 80,
        taskProgress: 33,
        taskCount: 3,
      });
      // Margin: contract 1,000,000, cost 205,000.
      expect(res.body.portfolio[0]).toMatchObject({
        actualTotalCost: '205000.00',
        marginAmount: '795000.00',
        marginPercent: 79.5,
      });
    });

    it('adds up the margin across the active portfolio', async () => {
      const res = await exec('ceo').expect(200);
      expect(res.body.kpis.margin).toMatchObject({ value: 3000000, cost: 305000, percent: 89.8 });
    });

    it('counts what is waiting for approval, across all four queues', async () => {
      const res = await exec('ceo').expect(200);
      expect(res.body.kpis.approvals).toMatchObject({
        timesheets: 1,
        leave: 1,
        expenses: 2,
        expensesAmount: '3000.00',
        regularisations: 1,
        total: 5,
      });
    });

    it('shows the commercial lifecycle', async () => {
      const res = await exec('ceo').expect(200);
      expect(res.body.lifecycle).toMatchObject({
        draft: 1,
        confirmedThisMonth: 2,
        verbalEmailPending: 1,
        verbalEmailOverdue: 1,
        scheduled: { active: 3, scheduled: 1, unscheduled: 2 },
      });
    });

    it('measures today’s attendance from the real punches', async () => {
      const res = await exec('ceo').expect(200);
      const a = res.body.work.attendance;
      expect(a.date).toBe('2026-10-09');
      expect(a.present).toBe(2);
      expect(a.clockedIn).toBe(2);
      // Riyadh is on its weekend: Dee is not expected today.
      expect(a.expected).toBe(8);
      expect(a.presentPercent).toBe(25);
    });

    it('works out utilization from capacity and billable hours, per office', async () => {
      // Riyadh, 01–09 Oct: Thu 1, Sun 4, Mon 5, Tue 6, Wed 7, Thu 8 are working days = 6 x 8 h = 48 h.
      // Dee logged 12 billable hours: 25 %.
      const ruh = await exec('ceo', `?officeId=${ids.ruh}`).expect(200);
      expect(ruh.body.kpis.utilization).toMatchObject({
        capacityHours: 48,
        billableHours: 12,
        loggedHours: 12,
        percent: 25,
        people: 1,
      });
      // HQ: eight people x eight working days (Sundays off) x 8 h = 512 h; 8 billable of 12 logged.
      const hq = await exec('ceo', `?officeId=${ids.hq}`).expect(200);
      expect(hq.body.kpis.utilization).toMatchObject({
        capacityHours: 512,
        billableHours: 8,
        loggedHours: 12,
        people: 8,
      });
      expect(hq.body.kpis.utilization.percent).toBeCloseTo(1.6, 1);
    });

    it('limits everything to one office when asked', async () => {
      const res = await exec('ceo', `?officeId=${ids.ruh}`).expect(200);
      expect(res.body.office).toMatchObject({ shortCode: 'RUH' });
      expect(res.body.kpis.activeProjects.count).toBe(1);
      expect(res.body.kpis.booked).toEqual({ count: 1, projectValue: '500000.00' });
      expect(res.body.portfolio.map((p: { projectCode: string }) => p.projectCode)).toEqual([
        'PJT-3',
      ]);
      expect(res.body.offices).toHaveLength(2);
    });

    it('reads the money position', async () => {
      const res = await exec('ceo').expect(200);
      expect(res.body.money.expenses).toEqual({
        awaitingManager: { count: 1, amount: '1000.00' },
        awaitingFinance: { count: 1, amount: '2000.00' },
        toReimburse: { count: 1, amount: '3000.00' },
      });
      expect(res.body.money.cost.thisMonth).toEqual({
        labour: '30000.00',
        expense: '5000.00',
        total: '35000.00',
      });
      expect(res.body.money.cost.lastMonth.total).toBe('50000.00');
    });

    it('draws six months of cost and bookings, newest last', async () => {
      const res = await exec('ceo').expect(200);
      const cost = res.body.charts.costByMonth;
      expect(cost).toHaveLength(6);
      expect(cost.at(-1)).toMatchObject({
        month: '2026-10-01',
        actualLabourCost: '30000.00',
        actualExpenseCost: '5000.00',
      });
      expect(cost.at(-2)).toMatchObject({ month: '2026-09-01', actualLabourCost: '50000.00' });
      const bookings = res.body.charts.bookingsByMonth;
      expect(bookings.at(-1)).toMatchObject({ count: 2, projectValue: '1500000.00' });
      expect(bookings.at(-2)).toMatchObject({ count: 1, projectValue: '700000.00' });
      expect(res.body.charts.costByProject[0].projectCode).toBe('PJT-2');
    });
  });

  describe('the Action Center', () => {
    it('lists only what needs a decision, worst first', async () => {
      const res = await exec('ceo').expect(200);
      const items = res.body.actions as Array<{
        id: string;
        severity: string;
        title: string;
        linkUrl: string;
      }>;
      const find = (prefix: string) => items.find((i) => i.id.startsWith(prefix));

      expect(find('budget:')?.severity).toBe('high');
      expect(
        items.some((i) => i.id === `budget:${ids.p2}` && /over its hours budget/.test(i.title)),
      ).toBe(true);
      expect(
        items.some(
          (i) => i.id === `budget:${ids.p1}` && i.severity === 'medium' && /nearing/.test(i.title),
        ),
      ).toBe(true);
      expect(find('bookings:email-overdue')).toMatchObject({
        severity: 'high',
        linkUrl: '/bookings?filter=email-pending',
      });
      expect(find('milestones:late')?.title).toMatch(/1 milestone is past its due date/);
      expect(find('timesheets:unsubmitted')?.title).toMatch(/1 person has not submitted last week/);
      // High before medium before info.
      const order = items.map((i) => i.severity);
      expect(order).toEqual(
        [...order].sort(
          (a, b) => ({ high: 0, medium: 1, info: 2 })[a]! - { high: 0, medium: 1, info: 2 }[b]!,
        ),
      );
    });

    it('leaves out an approval queue that has not waited long', async () => {
      const res = await exec('ceo').expect(200);
      // Ann's timesheet was submitted 3 days ago (counts); the expenses are 8 days old.
      expect(res.body.actions.some((i: { id: string }) => i.id === 'approvals:timesheets')).toBe(
        true,
      );
      expect(
        res.body.actions.some(
          (i: { id: string; severity: string }) =>
            i.id === 'approvals:expenses' && i.severity === 'high',
        ),
      ).toBe(true);
    });
  });

  describe('what each role sees', () => {
    it('gives Finance the money and the portfolio, but not the people sections', async () => {
      const res = await exec('fin').expect(200);
      expect(res.body.money.cost).toBeTruthy();
      expect(res.body.portfolio.length).toBe(3);
      expect(res.body.work.attendance).toBeNull(); // Finance sees hours (timesheet.view) but no attendance
      expect(res.body.kpis.utilization).toBeTruthy(); // Finance can see timesheets, so utilization is shown
    });

    it('limits a team lead to their team, and hides cost', async () => {
      const res = await exec('lead').expect(200);
      // Scope TEAM: Ann and Bob (and the lead). Their queues: one timesheet, one leave, two expenses, one correction.
      expect(res.body.kpis.approvals).toMatchObject({
        timesheets: 1,
        leave: 1,
        expenses: 2,
        regularisations: 1,
        total: 5,
      });
      expect(res.body.kpis.booked).toBeNull(); // no booking permission
      expect(res.body.money?.cost ?? null).toBeNull();
      expect(JSON.stringify(res.body)).not.toMatch(/actualTotalCost|marginAmount|actualLabourCost/);
      expect(res.body.portfolio.map((p: { projectCode: string }) => p.projectCode)).toEqual([
        'PJT-1',
      ]);
    });

    it('shows a project manager their project and its cost', async () => {
      const res = await exec('pm').expect(200);
      expect(res.body.portfolio.map((p: { projectCode: string }) => p.projectCode)).toEqual([
        'PJT-1',
      ]);
      expect(res.body.portfolio[0].actualTotalCost).toBe('100000.00');
    });

    it('shows an employee only themself: nothing about anyone else', async () => {
      const res = await exec('ann').expect(200);
      expect(res.body.kpis.approvals).toMatchObject({
        timesheets: 1,
        leave: 0,
        expenses: 1, // only her own claim that is still pending
        regularisations: 1,
      });
      expect(res.body.kpis.booked).toBeNull();
      expect(res.body.money?.cost ?? null).toBeNull();
      expect(res.body.work.attendance.expected).toBe(1);
    });

    it('needs a login', async () => {
      await request(server).get('/api/v1/dashboard/executive').expect(401);
      await request(server).get('/api/v1/dashboard/home').expect(401);
    });

    it('chooses each person’s home dashboard', async () => {
      const kind = async (key: keyof typeof who) =>
        (await request(server).get('/api/v1/dashboard/home').set(as(key)).expect(200)).body;
      expect(await kind('ceo')).toEqual({ kind: 'EXECUTIVE', dashboards: ['EXECUTIVE', 'MY_DAY'] });
      expect(await kind('fin')).toMatchObject({ kind: 'EXECUTIVE' });
      expect(await kind('hr')).toMatchObject({ kind: 'EXECUTIVE' });
      expect(await kind('lead')).toEqual({ kind: 'MANAGER', dashboards: ['MANAGER', 'MY_DAY'] });
      expect(await kind('pm')).toMatchObject({ kind: 'MANAGER' });
      expect(await kind('ann')).toEqual({ kind: 'MY_DAY', dashboards: ['MY_DAY'] });
    });
  });

  describe('the manager view', () => {
    it('lists exactly what waits on this manager, oldest first', async () => {
      const res = await request(server)
        .get('/api/v1/dashboard/manager')
        .set(as('lead'))
        .expect(200);
      // Ann's timesheet, Bob's leave, Ann's expense (first step; Bob's is already with Finance) and Ann's correction.
      expect(res.body.counts).toEqual({
        timesheets: 1,
        leave: 1,
        expenses: 1,
        corrections: 1,
        total: 4,
      });
      const types = res.body.waiting.map((w: { type: string }) => w.type).sort();
      expect(types).toEqual(['CORRECTION', 'EXPENSE', 'LEAVE', 'TIMESHEET']);
      const ages = res.body.waiting.map((w: { ageDays: number }) => w.ageDays);
      expect(ages).toEqual([...ages].sort((a, b) => b - a));
    });

    it('shows the team’s day, without the manager in it', async () => {
      const res = await request(server)
        .get('/api/v1/dashboard/manager')
        .set(as('lead'))
        .expect(200);
      expect(res.body.team.size).toBe(2);
      const today = res.body.team.today;
      expect(today.present).toBe(2);
      expect(today.rows.map((r: { fullName: string }) => r.fullName).sort()).toEqual([
        'ann Tester',
        'bob Tester',
      ]);
    });

    it('shows who is behind on logging time this week', async () => {
      const res = await request(server)
        .get('/api/v1/dashboard/manager')
        .set(as('lead'))
        .expect(200);
      const rows = res.body.team.workload as Array<{
        fullName: string;
        logged: number;
        expected: number;
        behind: number;
      }>;
      const ann = rows.find((r) => r.fullName === 'ann Tester')!;
      const bob = rows.find((r) => r.fullName === 'bob Tester')!;
      // Mon 5 .. Fri 9: five working days of 8 h.
      expect(ann).toMatchObject({ logged: 12, expected: 40, behind: 28 });
      expect(bob).toMatchObject({ logged: 0, expected: 40, behind: 40 });
      expect(rows[0].fullName).toBe('bob Tester'); // furthest behind first
      expect(res.body.team.unsubmittedLastWeek).toBe(1);
    });

    it('shows their projects, and what is coming up', async () => {
      const res = await request(server).get('/api/v1/dashboard/manager').set(as('pm')).expect(200);
      expect(res.body.projects.map((p: { projectCode: string }) => p.projectCode)).toEqual([
        'PJT-1',
      ]);
      expect(res.body.projects[0]).toMatchObject({
        burnPercent: 85,
        alertLevel: 80,
        taskProgress: 33,
        overdueTasks: 1,
      });
      expect(res.body.upcoming.milestones[0]).toMatchObject({ name: 'LOD300 issue', daysAway: -8 });
    });

    it('is empty for someone who approves nothing', async () => {
      const res = await request(server).get('/api/v1/dashboard/manager').set(as('ann')).expect(200);
      expect(res.body.counts.total).toBe(0);
      expect(res.body.waiting).toEqual([]);
    });
  });

  describe('My Day', () => {
    it('lists the tasks assigned to me, the overdue first', async () => {
      const res = await request(server).get('/api/v1/dashboard/my-day').set(as('ann')).expect(200);
      expect(res.body.tasks.map((t: { title: string }) => t.title)).toEqual([
        'Clash review',
        'Drawings',
      ]);
      expect(res.body.tasks[0]).toMatchObject({
        overdue: true,
        estimatedHours: 12,
        project: { projectCode: 'PJT-1' },
      });
      expect(res.body.tasks[1]).toMatchObject({ overdue: false });
    });

    it('shows this week against where it should be', async () => {
      const res = await request(server).get('/api/v1/dashboard/my-day').set(as('ann')).expect(200);
      expect(res.body.hours).toMatchObject({
        week: 12,
        billable: 8,
        capacity: 48, // Monday to Saturday is the working week
        expectedSoFar: 40,
      });
      expect(res.body.week).toHaveLength(7);
      expect(res.body.week[3]).toMatchObject({ date: '2026-10-08', hours: 8 });
      expect(res.body.week[4]).toMatchObject({ date: '2026-10-09', isToday: true, hours: 4 });
      expect(res.body.week[5].isFuture).toBe(true);
    });

    it('shows leave balances and what I am waiting on', async () => {
      const res = await request(server).get('/api/v1/dashboard/my-day').set(as('ann')).expect(200);
      expect(res.body.leaveBalances[0]).toMatchObject({ code: 'CL', available: 12 });
      expect(res.body.waiting.expenses).toBe(1);
      expect(res.body.waiting.timesheet).toBe(true);
      expect(res.body.waiting.corrections).toBe(1);
    });

    it('nudges me to submit last week’s timesheet', async () => {
      const res = await request(server).get('/api/v1/dashboard/my-day').set(as('ann')).expect(200);
      const todo = res.body.todo.find((t: { id: string }) => t.id === 'timesheet:last');
      expect(todo.title).toMatch(/Submit last week/);
      expect(todo.linkUrl).toContain('week=2026-09-28');
    });

    it('is about me only', async () => {
      const res = await request(server).get('/api/v1/dashboard/my-day').set(as('bob')).expect(200);
      expect(res.body.tasks).toEqual([]);
      expect(res.body.hours.week).toBe(0);
      expect(res.body.todo.find((t: { id: string }) => t.id === 'timesheet:last')).toBeUndefined();
    });

    it('needs a linked employee record', async () => {
      const user = await prisma.user.findFirstOrThrow({ where: { email: who.hr.email } });
      await prisma.employee.update({ where: { id: who.hr.employeeId }, data: { userId: null } });
      const login = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: who.hr.email, password: PASSWORD })
        .expect(200);
      const res = await request(server)
        .get('/api/v1/dashboard/my-day')
        .set({ Authorization: `Bearer ${login.body.accessToken}` });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('NO_EMPLOYEE_PROFILE');
      await prisma.employee.update({ where: { id: who.hr.employeeId }, data: { userId: user.id } });
    });
  });
});
