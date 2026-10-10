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

// A JPEG's first bytes and a PDF's: enough to pass the "is this really a receipt" check.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 2)]);
const EXE = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(64, 3)]);

/** Step 11: entry, receipts, limits, two-step approval, cost posting, reimbursement, reversal. */
describe('Expenses (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  const fakeNow = officeLocalToUtc('2026-10-09', '11:00', IST);
  const clock = { now: () => fakeNow };

  const who = {
    ceo: { email: 'ceo@ex.test', token: '', employeeId: '', userId: '' },
    hr: { email: 'hr@ex.test', token: '', employeeId: '', userId: '' },
    lead: { email: 'lead@ex.test', token: '', employeeId: '', userId: '' },
    pm: { email: 'pm@ex.test', token: '', employeeId: '', userId: '' },
    fin: { email: 'fin@ex.test', token: '', employeeId: '', userId: '' },
    ann: { email: 'ann@ex.test', token: '', employeeId: '', userId: '' }, // lead's report, on p1
    bob: { email: 'bob@ex.test', token: '', employeeId: '', userId: '' }, // lead's report, on p1
    eve: { email: 'eve@ex.test', token: '', employeeId: '', userId: '' }, // nobody's report, on p1
    cal: { email: 'cal@ex.test', token: '', employeeId: '', userId: '' }, // lead's report, on no project
  };
  const ids = { companyId: '', p1: '', p2: '', travel: '', meals: '', retired: '' };

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
        data: { name: 'Expense Test Co', codePrefix: 'ETC', fyStartMonth: 4 },
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
            employeeCode: `ETC-00${n}`,
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
      await person('fin', 'FINANCE');
      const m = who.lead.employeeId;
      await person('ann', 'EMPLOYEE', m);
      await person('bob', 'EMPLOYEE', m);
      await person('eve', 'EMPLOYEE');
      await person('cal', 'EMPLOYEE', m);

      async function project(code: string, status: 'ACTIVE' | 'CANCELLED', pmId: string | null) {
        const booking = await prisma.booking.create({
          data: {
            companyId,
            bookingNumber: `BKG-${code}`,
            clientId: client.id,
            projectName: code,
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
              name: code,
              bookingId: booking.id,
              clientId: client.id,
              projectTypeId: type.id,
              officeId: office.id,
              projectManagerId: pmId,
              status,
              projectValue: '5000000.00',
              budgetHours: '1000.00',
            },
          })
        ).id;
      }
      ids.p1 = await project('PJT-1', 'ACTIVE', who.pm.employeeId);
      ids.p2 = await project('PJT-2', 'CANCELLED', null);
      for (const key of ['ann', 'bob', 'eve'] as const) {
        await prisma.projectMember.create({
          data: { companyId, projectId: ids.p1, employeeId: who[key].employeeId },
        });
      }

      const category = async (name: string, data: Record<string, unknown>) =>
        (await prisma.expenseCategory.create({ data: { companyId, name, ...data } as never })).id;
      ids.travel = await category('Travel', {
        shortCode: 'TRV',
        perClaimLimit: '5000.00',
        perMonthLimit: '8000.00',
        requiresReceipt: true,
      });
      ids.meals = await category('Client Meals', { shortCode: 'MEAL', requiresReceipt: false });
      ids.retired = await category('Retired', { isActive: false });
    });
  }

  // --- helpers --------------------------------------------------------------

  type Body = Record<string, unknown>;
  const claimBody = (over: Body = {}): Body => ({
    categoryId: ids.meals,
    projectId: ids.p1,
    expenseDate: '2026-10-07',
    amount: '1200.00',
    isBillable: false,
    description: 'Lunch with the client team',
    ...over,
  });
  const create = (key: keyof typeof who, over: Body = {}) =>
    request(server).post('/api/v1/expenses').set(as(key)).send(claimBody(over));
  const submit = (key: keyof typeof who, id: string) =>
    request(server).post(`/api/v1/expenses/${id}/submit`).set(as(key));
  const decide = (key: keyof typeof who, id: string, decision: string, comment?: string) =>
    request(server)
      .post(`/api/v1/expenses/${id}/decision`)
      .set(as(key))
      .send({ decision, comment });
  const get = (key: keyof typeof who, id: string) =>
    request(server).get(`/api/v1/expenses/${id}`).set(as(key));
  const detail = (
    res: { body: { details?: Array<{ path: string; message: string }> } },
    path: string,
  ) => res.body.details?.find((x) => x.path === path)?.message ?? '';
  const upload = (
    key: keyof typeof who,
    buffer: Buffer,
    name = 'receipt.jpg',
    type = 'image/jpeg',
  ) =>
    request(server)
      .post('/api/v1/expenses/receipts')
      .set(as(key))
      .attach('receipt', buffer, { filename: name, contentType: type });
  const ledger = (id: string) =>
    prisma.costLedgerEntry.findMany({
      where: { sourceType: 'EXPENSE', sourceId: id },
      orderBy: [{ postingVersion: 'asc' }, { isReversal: 'asc' }],
    });
  const projectExpenseCost = async () =>
    Number((await prisma.project.findFirstOrThrow({ where: { id: ids.p1 } })).actualExpenseCost);

  /** A submitted claim waiting on the manager. */
  async function submitted(key: keyof typeof who, over: Body = {}) {
    const made = await create(key, over).expect(201);
    await submit(key, made.body.id).expect(201);
    return made.body.id as string;
  }
  /** A claim at Finance, after the lead's approval. */
  async function atFinance(key: keyof typeof who = 'ann', over: Body = {}) {
    const id = await submitted(key, over);
    await decide('lead', id, 'APPROVED').expect(201);
    return id;
  }

  // =========================================================================

  describe('lookups', () => {
    it('lists active categories and the projects the caller can claim against', async () => {
      const ann = await request(server).get('/api/v1/expenses/lookups').set(as('ann')).expect(200);
      const names = ann.body.categories.map((c: { name: string }) => c.name).sort();
      expect(names).toEqual(['Client Meals', 'Travel']);
      expect(ann.body.categories.find((c: { name: string }) => c.name === 'Travel')).toMatchObject({
        perClaimLimit: '5000.00',
        perMonthLimit: '8000.00',
        requiresReceipt: true,
      });
      expect(ann.body.projects.map((p: { projectCode: string }) => p.projectCode)).toEqual([
        'PJT-1',
      ]);

      const cal = await request(server).get('/api/v1/expenses/lookups').set(as('cal')).expect(200);
      expect(cal.body.projects).toEqual([]);
    });
  });

  describe('receipts', () => {
    it('accepts a photo and a PDF', async () => {
      const photo = await upload('ann', JPEG).expect(201);
      expect(photo.body).toMatchObject({ mimeType: 'image/jpeg' });
      await upload('ann', PDF, 'bill.pdf', 'application/pdf').expect(201);
    });

    it('judges by the bytes, not the name', async () => {
      const res = await upload('ann', EXE, 'receipt.jpg', 'image/jpeg');
      expect(res.status).toBe(400);
      expect(detail(res, 'receipt')).toMatch(/photo|PDF/);
    });

    it('needs a file', async () => {
      await request(server).post('/api/v1/expenses/receipts').set(as('ann')).expect(400);
    });

    it('is for people who can claim', async () => {
      await upload('hr', JPEG).expect(403);
    });
  });

  describe('drafting a claim', () => {
    it('saves a draft with its details', async () => {
      const res = await create('ann').expect(201);
      expect(res.body).toMatchObject({
        status: 'DRAFT',
        amount: '1200.00',
        isBillable: false,
        isMine: true,
        canEdit: true,
        canSubmit: true,
        category: { name: 'Client Meals' },
        project: { projectCode: 'PJT-1' },
        employee: { fullName: 'ann Tester' },
      });
      expect(res.body.warnings).toEqual([]);
    });

    it('allows a claim with no project', async () => {
      const res = await create('ann', { projectId: null, amount: '300.50' }).expect(201);
      expect(res.body.project).toBeNull();
      expect(res.body.amount).toBe('300.50');
    });

    it('refuses nonsense amounts and dates', async () => {
      await create('ann', { amount: '0' }).expect(422);
      await create('ann', { amount: '-5' }).expect(422);
      await create('ann', { amount: '12.345' }).expect(422);
      await create('ann', { expenseDate: 'yesterday' }).expect(422);
      const future = await create('ann', { expenseDate: '2026-10-10' });
      expect(future.status).toBe(400);
      expect(detail(future, 'expenseDate')).toMatch(/future/);
      const old = await create('ann', { expenseDate: '2026-06-01' });
      expect(old.status).toBe(400);
      expect(detail(old, 'expenseDate')).toMatch(/90 days/);
    });

    it('refuses an inactive category, an unknown one, and projects you are not on', async () => {
      expect(detail(await create('ann', { categoryId: ids.retired }), 'categoryId')).toBeTruthy();
      expect(detail(await create('ann', { categoryId: 'nope' }), 'categoryId')).toBeTruthy();
      expect(detail(await create('cal'), 'projectId')).toMatch(/not on the PJT-1 team/);
      expect(detail(await create('ann', { projectId: ids.p2 }), 'projectId')).toMatch(/cancelled/);
    });

    it('warns about the category limits without blocking', async () => {
      const over = await create('bob', { categoryId: ids.travel, amount: '6000.00' }).expect(201);
      expect(over.body.warnings[0]).toMatch(/per-claim/);
      expect(over.body.exceededLimit).toBe(true);
    });

    it('warns about a likely duplicate', async () => {
      await create('bob', { amount: '777.00' }).expect(201);
      const again = await create('bob', { amount: '777.00' }).expect(201);
      expect(again.body.warnings.join(' ')).toMatch(/same date, category and amount/);
    });

    it('keeps a draft private to its author', async () => {
      const made = await create('ann', { amount: '55.00' }).expect(201);
      await get('lead', made.body.id).expect(404);
      await get('ceo', made.body.id).expect(404);
      await get('ann', made.body.id).expect(200);
      await decide('lead', made.body.id, 'APPROVED').expect(404);
    });

    it('edits a draft, and deletes one', async () => {
      const made = await create('ann', { amount: '88.00' }).expect(201);
      const res = await request(server)
        .patch(`/api/v1/expenses/${made.body.id}`)
        .set(as('ann'))
        .send({ amount: '99.00', description: 'Corrected' })
        .expect(200);
      expect(res.body).toMatchObject({ amount: '99.00', description: 'Corrected' });
      await request(server)
        .patch(`/api/v1/expenses/${made.body.id}`)
        .set(as('ann'))
        .send({})
        .expect(422);
      await request(server)
        .patch(`/api/v1/expenses/${made.body.id}`)
        .set(as('bob'))
        .send({ amount: '1.00' })
        .expect(404);
      await request(server).delete(`/api/v1/expenses/${made.body.id}`).set(as('ann')).expect(200);
      await get('ann', made.body.id).expect(404);
    });

    it('attaches a receipt, once, and only your own', async () => {
      const receipt = (await upload('ann', JPEG).expect(201)).body.id;
      const mine = await create('ann', {
        categoryId: ids.travel,
        amount: '900.00',
        receiptDocumentId: receipt,
      }).expect(201);
      expect(mine.body.receipt).toMatchObject({ id: receipt, mimeType: 'image/jpeg' });
      // Another person cannot use it; the same receipt cannot go on a second claim.
      expect(
        detail(await create('bob', { receiptDocumentId: receipt }), 'receiptDocumentId'),
      ).toBeTruthy();
      expect(
        detail(await create('ann', { receiptDocumentId: receipt }), 'receiptDocumentId'),
      ).toBeTruthy();
    });
  });

  describe('submitting', () => {
    it('needs a receipt where the category asks for one', async () => {
      const made = await create('ann', { categoryId: ids.travel, amount: '900.00' }).expect(201);
      const res = await submit('ann', made.body.id);
      expect(res.status).toBe(400);
      expect(detail(res, 'receiptDocumentId')).toMatch(/need a receipt/);
      const receipt = (await upload('ann', PDF, 'cab.pdf', 'application/pdf').expect(201)).body.id;
      await request(server)
        .patch(`/api/v1/expenses/${made.body.id}`)
        .set(as('ann'))
        .send({ receiptDocumentId: receipt })
        .expect(200);
      await submit('ann', made.body.id).expect(201);
    });

    it('goes to the manager, locks the claim, and tells the right people', async () => {
      const id = await submitted('ann', { amount: '640.00' });
      const row = (await get('ann', id).expect(200)).body;
      expect(row).toMatchObject({
        status: 'PENDING_MANAGER',
        awaiting: 'MANAGER',
        canEdit: false,
        canWithdraw: true,
      });
      expect(row.approvals).toHaveLength(1);

      const count = (key: keyof typeof who) =>
        prisma.notification.count({
          where: { userId: who[key].userId, type: 'EXPENSE_SUBMITTED', entityId: id },
        });
      // The team lead, the project's manager and the CEO can decide the first step.
      // Finance is not asked at this stage, nor is HR (no expense permissions), nor the claimant.
      expect([await count('lead'), await count('pm'), await count('ceo')]).toEqual([1, 1, 1]);
      expect([
        await count('fin'),
        await count('hr'),
        await count('ann'),
        await count('eve'),
      ]).toEqual([0, 0, 0, 0]);

      const edit = await request(server)
        .patch(`/api/v1/expenses/${id}`)
        .set(as('ann'))
        .send({ amount: '1.00' });
      expect(edit.status).toBe(409);
      expect(edit.body.code).toBe('EXPENSE_LOCKED');
      await request(server).delete(`/api/v1/expenses/${id}`).set(as('ann')).expect(409);
      expect((await submit('ann', id)).status).toBe(409);
    });

    it('can be withdrawn while the manager has not decided, then resubmitted', async () => {
      const id = await submitted('ann', { amount: '641.00' });
      const back = await request(server)
        .post(`/api/v1/expenses/${id}/withdraw`)
        .set(as('ann'))
        .expect(201);
      expect(back.body.status).toBe('DRAFT');
      expect(back.body.approvals).toEqual([]);
      await submit('ann', id).expect(201);
    });

    it('cannot be withdrawn once it is with Finance, or by anyone else', async () => {
      const id = await atFinance('ann', { amount: '642.00' });
      const res = await request(server).post(`/api/v1/expenses/${id}/withdraw`).set(as('ann'));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('NOT_WITHDRAWABLE');
      await request(server).post(`/api/v1/expenses/${id}/withdraw`).set(as('bob')).expect(404);
    });

    it('flags a month that goes over the category limit', async () => {
      // Travel is limited to 8,000 a month. Eve claims 4,500 + 4,500: the second takes her to 9,000.
      const doc = async () => (await upload('eve', JPEG).expect(201)).body.id as string;
      const a = await create('eve', {
        categoryId: ids.travel,
        amount: '4500.00',
        receiptDocumentId: await doc(),
      }).expect(201);
      await submit('eve', a.body.id).expect(201);
      const b = await create('eve', {
        categoryId: ids.travel,
        amount: '4500.00',
        expenseDate: '2026-10-08',
        receiptDocumentId: await doc(),
      }).expect(201);
      expect(b.body.warnings.join(' ')).toMatch(/monthly limit/);
      const sent = await submit('eve', b.body.id).expect(201);
      expect(sent.body.exceededLimit).toBe(true);
      expect(sent.body.limitMessages.join(' ')).toMatch(/₹9,000/);
    });
  });

  describe('the manager’s decision', () => {
    it('is not the claimant’s, Finance’s, or an employee’s to make', async () => {
      const id = await submitted('ann', { amount: '650.00' });
      const own = await decide('ann', id, 'APPROVED');
      expect(own.status).toBe(403);
      await decide('bob', id, 'APPROVED').expect(403); // no expense.approve
      const fin = await decide('fin', id, 'APPROVED');
      expect(fin.status).toBe(403);
      expect(fin.body.code).toBe('WRONG_STAGE');
    });

    it('is invisible to an approver outside the scope: 404', async () => {
      const id = await submitted('eve', { amount: '651.00' });
      await decide('lead', id, 'APPROVED').expect(404);
      await get('lead', id).expect(404);
    });

    it('moves the claim to Finance and tells them', async () => {
      const id = await submitted('ann', { amount: '652.00' });
      const res = await decide('lead', id, 'APPROVED', 'Fine by me').expect(201);
      expect(res.body).toMatchObject({ status: 'PENDING_FINANCE', awaiting: 'FINANCE' });
      expect(
        res.body.approvals.map((a: { stage: string; status: string }) => `${a.stage}:${a.status}`),
      ).toEqual(['MANAGER:APPROVED', 'FINANCE:PENDING']);
      expect(res.body.approvals[0].approver).toBe('lead');
      const toFin = await prisma.notification.count({
        where: { userId: who.fin.userId, entityId: id, title: { contains: 'Finance approval' } },
      });
      expect(toFin).toBe(1);
      // Nothing is posted yet.
      expect(await ledger(id)).toHaveLength(0);
    });

    it('can reject, with a reason, and the claim comes back to be fixed and resubmitted', async () => {
      const id = await submitted('bob', { amount: '653.00' });
      await decide('lead', id, 'REJECTED').expect(422);
      const res = await decide('lead', id, 'REJECTED', 'Not a project cost').expect(201);
      expect(res.body.status).toBe('REJECTED');
      expect((await get('bob', id).expect(200)).body.canEdit).toBe(true);
      expect(res.body.approvals[0]).toMatchObject({
        status: 'REJECTED',
        comment: 'Not a project cost',
      });
      expect(
        await prisma.notification.count({
          where: { userId: who.bob.userId, type: 'EXPENSE_REJECTED', entityId: id },
        }),
      ).toBe(1);

      await request(server)
        .patch(`/api/v1/expenses/${id}`)
        .set(as('bob'))
        .send({ projectId: null })
        .expect(200);
      const again = await submit('bob', id).expect(201);
      // A fresh approval: the earlier rejection is in the audit log, not on the claim.
      expect(again.body.approvals).toHaveLength(1);
      expect(again.body.approvals[0].status).toBe('PENDING');
      const audits = await prisma.auditLog.count({
        where: { entityType: 'Expense', entityId: id, action: 'REJECT' },
      });
      expect(audits).toBe(1);
    });

    it('cannot be decided twice', async () => {
      const id = await atFinance('ann', { amount: '654.00' });
      const res = await decide('lead', id, 'APPROVED');
      expect(res.status).toBe(403); // the lead has no Finance authority for the second step
      expect(res.body.code).toBe('WRONG_STAGE');
      await decide('fin', id, 'APPROVED').expect(201);
      const again = await decide('fin', id, 'APPROVED');
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('NOT_PENDING');
    });
  });

  describe('Finance’s decision and cost posting', () => {
    it('approving posts the claim to the project’s cost, once', async () => {
      const before = await projectExpenseCost();
      const id = await atFinance('ann', { amount: '2500.00', isBillable: true });
      const res = await decide('fin', id, 'APPROVED', 'Receipts verified').expect(201);
      expect(res.body).toMatchObject({
        status: 'APPROVED',
        costPosted: true,
        reimbursementStatus: 'PENDING',
      });

      const rows = await ledger(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        sourceType: 'EXPENSE',
        projectId: ids.p1,
        isReversal: false,
        postingVersion: 1,
      });
      expect(Number(rows[0].amount)).toBe(2500);
      expect(await projectExpenseCost()).toBe(before + 2500);
      expect(
        await prisma.notification.count({
          where: { userId: who.ann.userId, type: 'EXPENSE_APPROVED', entityId: id },
        }),
      ).toBe(1);
    });

    it('a claim with no project is approved but posts no project cost', async () => {
      const before = await projectExpenseCost();
      const id = await atFinance('ann', { projectId: null, amount: '410.00' });
      const res = await decide('fin', id, 'APPROVED').expect(201);
      expect(res.body.costPosted).toBe(false);
      expect(await ledger(id)).toHaveLength(0);
      expect(await projectExpenseCost()).toBe(before);
    });

    it('the second step needs a different person from the first', async () => {
      // Eve has no manager: the CEO takes the first step, so the CEO cannot take the second.
      const id = await submitted('eve', { amount: '420.00' });
      await decide('ceo', id, 'APPROVED').expect(201);
      const res = await decide('ceo', id, 'APPROVED');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('SAME_APPROVER');
      await decide('fin', id, 'APPROVED').expect(201);
    });

    it('Finance can reject, and the claim never reaches the ledger', async () => {
      const id = await atFinance('ann', { amount: '430.00' });
      await decide('fin', id, 'REJECTED').expect(422);
      const res = await decide('fin', id, 'REJECTED', 'Duplicate of an earlier claim').expect(201);
      expect(res.body.status).toBe('REJECTED');
      expect(res.body.approvals[1]).toMatchObject({ stage: 'FINANCE', status: 'REJECTED' });
      expect(await ledger(id)).toHaveLength(0);
    });

    it('two people deciding at the same moment post the cost once', async () => {
      const id = await atFinance('bob', { amount: '440.00' });
      const before = await projectExpenseCost();
      const results = await Promise.all([
        decide('fin', id, 'APPROVED'),
        decide('ceo', id, 'APPROVED'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await ledger(id)).toHaveLength(1);
      expect(await projectExpenseCost()).toBe(before + 440);
    });

    it('a manager’s own claim goes to someone else for the first step', async () => {
      const id = await submitted('lead', { amount: '450.00', projectId: null });
      const own = await decide('lead', id, 'APPROVED');
      expect(own.status).toBe(403);
      expect(own.body.code).toBe('SELF_APPROVAL');
      await decide('ceo', id, 'APPROVED').expect(201);
    });
  });

  describe('queues', () => {
    it('each approver sees only what is theirs to decide', async () => {
      const a = await submitted('ann', { amount: '461.00' });
      const e = await submitted('eve', { amount: '462.00' });
      const f = await atFinance('bob', { amount: '463.00' });
      const ids_ = async (key: keyof typeof who) =>
        (
          await request(server)
            .get('/api/v1/expenses?toDecide=true&pageSize=200')
            .set(as(key))
            .expect(200)
        ).body.data.map((r: { id: string }) => r.id) as string[];

      const lead = await ids_('lead');
      expect(lead).toContain(a);
      expect(lead).not.toContain(e); // not the lead's report
      expect(lead).not.toContain(f); // already past the first step

      const fin = await ids_('fin');
      expect(fin).toContain(f);
      expect(fin).not.toContain(a);
      expect(fin).not.toContain(e); // Finance does not take the first step

      const ceo = await ids_('ceo');
      expect(ceo).toContain(a);
      expect(ceo).toContain(e);
      expect(ceo).toContain(f);

      expect(await ids_('ann')).toEqual([]);
      expect(await ids_('hr').catch(() => [])).toEqual([]);
    });

    it('shows employees their own, leads their team’s, Finance everyone’s', async () => {
      const mine = await request(server)
        .get('/api/v1/expenses?pageSize=200')
        .set(as('ann'))
        .expect(200);
      expect(
        mine.body.data.every(
          (r: { employee: { id: string } }) => r.employee.id === who.ann.employeeId,
        ),
      ).toBe(true);
      const lead = await request(server)
        .get('/api/v1/expenses?pageSize=200')
        .set(as('lead'))
        .expect(200);
      const people = new Set(
        lead.body.data.map((r: { employee: { id: string } }) => r.employee.id),
      );
      expect(people.has(who.eve.employeeId)).toBe(false);
      expect(people.has(who.bob.employeeId)).toBe(true);
      const fin = await request(server)
        .get('/api/v1/expenses?pageSize=200')
        .set(as('fin'))
        .expect(200);
      expect(fin.body.meta.total).toBeGreaterThan(lead.body.meta.total);
      // No one's draft but their own.
      expect(
        fin.body.data.some(
          (r: { status: string; isMine: boolean }) => r.status === 'DRAFT' && !r.isMine,
        ),
      ).toBe(false);
    });

    it('filters, searches and totals', async () => {
      const res = await request(server)
        .get(`/api/v1/expenses?status=APPROVED&projectId=${ids.p1}&pageSize=200`)
        .set(as('fin'))
        .expect(200);
      expect(res.body.data.every((r: { status: string }) => r.status === 'APPROVED')).toBe(true);
      const sum = res.body.data.reduce(
        (a: number, r: { amount: string }) => a + Number(r.amount),
        0,
      );
      expect(Number(res.body.meta.totalAmount)).toBeCloseTo(sum, 2);
      const search = await request(server)
        .get('/api/v1/expenses?q=Corrected&pageSize=50')
        .set(as('ann'))
        .expect(200);
      expect(search.body.data.length).toBe(0); // that draft was deleted
    });

    it('decides in bulk, reporting each claim', async () => {
      const ok = await submitted('ann', { amount: '471.00' });
      const mixed = await submitted('eve', { amount: '472.00' }); // outside the lead's scope
      const res = await request(server)
        .post('/api/v1/expenses/bulk-decision')
        .set(as('lead'))
        .send({ ids: [ok, mixed], decision: 'APPROVED' })
        .expect(201);
      expect(res.body).toMatchObject({ done: 1, failed: 1 });
      const byId = Object.fromEntries(res.body.results.map((r: { id: string }) => [r.id, r]));
      expect(byId[ok].ok).toBe(true);
      expect(byId[mixed].code).toBe('NOT_FOUND');
      await request(server)
        .post('/api/v1/expenses/bulk-decision')
        .set(as('lead'))
        .send({ ids: [ok], decision: 'REJECTED' })
        .expect(422);
    });
  });

  describe('reimbursement', () => {
    it('Finance marks approved claims as paid', async () => {
      const id = await atFinance('ann', { amount: '480.00' });
      await decide('fin', id, 'APPROVED').expect(201);
      const res = await request(server)
        .post('/api/v1/expenses/reimburse')
        .set(as('fin'))
        .send({ ids: [id] })
        .expect(201);
      expect(res.body).toMatchObject({ done: 1, failed: 0 });
      const row = (await get('ann', id).expect(200)).body;
      expect(row.reimbursementStatus).toBe('REIMBURSED');
      expect(row.reimbursedAt).toBeTruthy();
      expect(
        await prisma.notification.count({
          where: { userId: who.ann.userId, title: { contains: 'reimbursed' } },
        }),
      ).toBeGreaterThan(0);
    });

    it('refuses what is not payable, once, and says why per claim', async () => {
      const waiting = await submitted('ann', { amount: '481.00' });
      const paid = (
        await request(server)
          .get('/api/v1/expenses?reimbursement=REIMBURSED&pageSize=1')
          .set(as('fin'))
          .expect(200)
      ).body.data[0].id as string;
      const res = await request(server)
        .post('/api/v1/expenses/reimburse')
        .set(as('fin'))
        .send({ ids: [waiting, paid] })
        .expect(201);
      expect(res.body.failed).toBe(2);
      expect(res.body.results.every((r: { code: string }) => r.code === 'NOT_PAYABLE')).toBe(true);
    });

    it('is Finance’s alone', async () => {
      await request(server)
        .post('/api/v1/expenses/reimburse')
        .set(as('lead'))
        .send({ ids: ['x'] })
        .expect(403);
      await request(server)
        .post('/api/v1/expenses/reimburse')
        .set(as('ann'))
        .send({ ids: ['x'] })
        .expect(403);
    });

    it('lists what is waiting to be paid, and the totals', async () => {
      const id = await atFinance('bob', { amount: '482.00' });
      await decide('fin', id, 'APPROVED').expect(201);
      const list = await request(server)
        .get('/api/v1/expenses?toReimburse=true&pageSize=200')
        .set(as('fin'))
        .expect(200);
      expect(list.body.data.map((r: { id: string }) => r.id)).toContain(id);
      expect(
        list.body.data.every(
          (r: { reimbursementStatus: string }) => r.reimbursementStatus === 'PENDING',
        ),
      ).toBe(true);
      const none = await request(server)
        .get('/api/v1/expenses?toReimburse=true')
        .set(as('ann'))
        .expect(200);
      expect(none.body.data).toEqual([]);

      const summary = await request(server)
        .get('/api/v1/expenses/summary')
        .set(as('fin'))
        .expect(200);
      expect(summary.body.toReimburse.count).toBeGreaterThan(0);
      const bob = await request(server).get('/api/v1/expenses/summary').set(as('bob')).expect(200);
      expect(bob.body.mine.approvedUnpaid.count).toBeGreaterThan(0);
    });
  });

  describe('reversing an approved claim', () => {
    it('takes the cost back off the ledger and returns the claim to the employee', async () => {
      const id = await atFinance('ann', { amount: '900.00' });
      await decide('fin', id, 'APPROVED').expect(201);
      const before = await projectExpenseCost();

      await request(server)
        .post(`/api/v1/expenses/${id}/reverse`)
        .set(as('fin'))
        .send({ reason: 'x' })
        .expect(422);
      const res = await request(server)
        .post(`/api/v1/expenses/${id}/reverse`)
        .set(as('fin'))
        .send({ reason: 'The receipt was for a personal purchase' })
        .expect(201);
      expect(res.body).toMatchObject({ status: 'REJECTED', costPosted: false });
      expect((await get('ann', id).expect(200)).body.canEdit).toBe(true);

      const rows = await ledger(id);
      expect(rows).toHaveLength(2);
      expect(rows.reduce((a, r) => a + Number(r.amount), 0)).toBe(0);
      expect(await projectExpenseCost()).toBe(before - 900);
      const audit = await prisma.auditLog.findFirst({
        where: { entityType: 'Expense', entityId: id, action: 'REOPEN' },
      });
      expect(audit?.reason).toMatch(/personal/);

      // Corrected and resubmitted, it can be approved and posted again as version 2.
      await request(server)
        .patch(`/api/v1/expenses/${id}`)
        .set(as('ann'))
        .send({ amount: '90.00' })
        .expect(200);
      await submit('ann', id).expect(201);
      await decide('lead', id, 'APPROVED').expect(201);
      await decide('fin', id, 'APPROVED').expect(201);
      const all = await ledger(id);
      expect(all).toHaveLength(3);
      expect(all.at(-1)).toMatchObject({ postingVersion: 2, isReversal: false });
      expect(all.reduce((a, r) => a + Number(r.amount), 0)).toBe(90);
    });

    it('refuses once the money has been paid out, and for anything not approved', async () => {
      const paid = (
        await request(server)
          .get('/api/v1/expenses?reimbursement=REIMBURSED&pageSize=1')
          .set(as('fin'))
          .expect(200)
      ).body.data[0].id as string;
      const res = await request(server)
        .post(`/api/v1/expenses/${paid}/reverse`)
        .set(as('fin'))
        .send({ reason: 'Trying anyway' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ALREADY_PAID');

      const waiting = await submitted('ann', { amount: '491.00' });
      const notApproved = await request(server)
        .post(`/api/v1/expenses/${waiting}/reverse`)
        .set(as('fin'))
        .send({ reason: 'Not approved yet' });
      expect(notApproved.status).toBe(409);
      expect(notApproved.body.code).toBe('NOT_APPROVED');
    });

    it('is Finance’s alone', async () => {
      await request(server)
        .post('/api/v1/expenses/x/reverse')
        .set(as('lead'))
        .send({ reason: 'nope nope' })
        .expect(403);
    });
  });

  describe('receipts and access to them', () => {
    it('can be opened by the owner and by an approver in scope, not by others', async () => {
      const receipt = (await upload('ann', JPEG).expect(201)).body.id;
      const made = await create('ann', {
        categoryId: ids.travel,
        amount: '700.00',
        receiptDocumentId: receipt,
      }).expect(201);
      // A draft is private.
      await request(server)
        .get(`/api/v1/expenses/${made.body.id}/receipt`)
        .set(as('lead'))
        .expect(404);
      const own = await request(server)
        .get(`/api/v1/expenses/${made.body.id}/receipt`)
        .set(as('ann'))
        .expect(200);
      expect(own.headers['content-type']).toMatch(/image\/jpeg/);
      expect(own.headers['x-content-type-options']).toBe('nosniff');

      await submit('ann', made.body.id).expect(201);
      await request(server)
        .get(`/api/v1/expenses/${made.body.id}/receipt`)
        .set(as('lead'))
        .expect(200);
      await request(server)
        .get(`/api/v1/expenses/${made.body.id}/receipt`)
        .set(as('fin'))
        .expect(200);
      await request(server)
        .get(`/api/v1/expenses/${made.body.id}/receipt`)
        .set(as('eve'))
        .expect(404);
    });
  });

  describe('export and access', () => {
    it('exports the filtered claims to Excel for those who may', async () => {
      const res = await request(server)
        .get('/api/v1/expenses/export?status=APPROVED')
        .set(as('fin'))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-disposition']).toMatch(/expenses-.*\.xlsx/);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as unknown as ArrayBuffer);
      const sheet = workbook.getWorksheet('Expenses')!;
      expect(sheet.getRow(1).getCell(1).value).toBe('Date');
      expect(sheet.rowCount).toBeGreaterThan(1);
      await request(server).get('/api/v1/expenses/export').set(as('ann')).expect(403);
    });

    it('needs a login, and HR (no expense permissions) is turned away', async () => {
      await request(server).get('/api/v1/expenses').expect(401);
      await request(server).get('/api/v1/expenses').set(as('hr')).expect(403);
    });

    it('lets a project manager claim for themselves', async () => {
      const res = await create('pm', { projectId: null, amount: '123.00' });
      expect(res.status).toBe(201);
    });
  });
});
