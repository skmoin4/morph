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

/** Step 6: clients, bookings, confirmation rules and project code generation. */
describe('Bookings (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;

  const ids = {
    companyId: '',
    officeId: '',
    clientId: '',
    typeHosId: '',
    typeDcId: '',
    ceoToken: '',
    leadToken: '',
    ceoRoleId: '',
    leadRoleId: '',
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

    ids.ceoToken = await login('ceo@bk.test');
    ids.leadToken = await login('lead@bk.test');
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  async function login(email: string) {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.accessToken as string;
  }

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
        data: {
          name: 'Booking Test Co',
          codePrefix: 'BTC',
          fyStartMonth: 4,
          projectCodePattern: '{PREFIX}-{FY}-{TYPE}-{SEQ4}',
        },
      });
      ids.companyId = company.id;

      const office = await prisma.office.create({
        data: { companyId: company.id, name: 'HQ', shortCode: 'HQ', timezone: 'Asia/Kolkata' },
      });
      ids.officeId = office.id;

      const client = await prisma.client.create({
        data: { companyId: company.id, name: 'Aarogya Hospitals' },
      });
      ids.clientId = client.id;

      ids.typeHosId = (
        await prisma.projectType.create({
          data: { companyId: company.id, name: 'Hospital', shortCode: 'HOS' },
        })
      ).id;
      ids.typeDcId = (
        await prisma.projectType.create({
          data: { companyId: company.id, name: 'Data Centre', shortCode: 'DC' },
        })
      ).id;

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
      ids.ceoRoleId = roleIds.CEO;
      ids.leadRoleId = roleIds.TEAM_LEAD;

      for (const [email, systemKey] of [
        ['ceo@bk.test', 'CEO'],
        ['lead@bk.test', 'TEAM_LEAD'],
      ]) {
        await prisma.user.create({
          data: {
            companyId: company.id,
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

  const asCeo = () => ({ Authorization: `Bearer ${ids.ceoToken}` });
  const asLead = () => ({ Authorization: `Bearer ${ids.leadToken}` });

  async function makeBooking(
    overrides: Record<string, unknown> = {},
    headers = asCeo(),
  ): Promise<string> {
    const res = await request(server)
      .post('/api/v1/bookings')
      .set(headers)
      .send({
        clientId: ids.clientId,
        projectName: 'A hospital',
        projectTypeId: ids.typeHosId,
        officeId: ids.officeId,
        bookingDate: '2026-07-14',
        projectValue: '9500000.00',
        budgetHours: 4200,
        billingType: 'FIXED',
        expectedStartDate: '2026-08-03',
        expectedEndDate: '2027-03-31',
        ...overrides,
      })
      .expect(201);
    return res.body.id;
  }

  async function uploadConfirmation(name = 'award.eml'): Promise<string> {
    const res = await request(server)
      .post('/api/v1/files/confirmations')
      .set(asCeo())
      .attach('file', Buffer.from('From: client\r\nSubject: Award\r\n\r\nConfirmed.\r\n'), name)
      .expect(201);
    return res.body.id;
  }

  const verbalConfirmation = {
    type: 'VERBAL',
    confirmedByName: 'Dr. Meera Agarwal',
    confirmedOn: '2026-07-14',
    mode: 'CALL',
    summary: 'Confirmed award on a call; scope and commercials per our proposal rev C.',
  };

  // -------------------------------------------------------------------------

  describe('confirmation is mandatory', () => {
    it('refuses to confirm with no proof at all', async () => {
      const id = await makeBooking();
      const res = await request(server)
        .post(`/api/v1/bookings/${id}/confirm`)
        .set(asCeo())
        .send({})
        .expect(422);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'confirmation' })]),
      );
    });

    it('refuses an EMAIL confirmation with no document', async () => {
      const id = await makeBooking();
      await request(server)
        .post(`/api/v1/bookings/${id}/confirm`)
        .set(asCeo())
        .send({ confirmation: { type: 'EMAIL', receivedAt: '2026-07-14' } })
        .expect(422);
    });

    it('refuses an EMAIL confirmation pointing at a document that does not exist', async () => {
      const id = await makeBooking();
      const res = await request(server)
        .post(`/api/v1/bookings/${id}/confirm`)
        .set(asCeo())
        .send({
          confirmation: {
            type: 'EMAIL',
            emailDocumentId: 'does-not-exist',
            receivedAt: '2026-07-14',
          },
        })
        .expect(400);
      expect(res.body.code).toBe('DOCUMENT_NOT_FOUND');
    });

    it('refuses an incomplete VERBAL note', async () => {
      const id = await makeBooking();
      const res = await request(server)
        .post(`/api/v1/bookings/${id}/confirm`)
        .set(asCeo())
        .send({
          confirmation: { ...verbalConfirmation, summary: 'ok' },
        })
        .expect(422);

      expect(res.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'confirmation.summary' })]),
      );
    });

    it('accepts a complete VERBAL note and flags the email as pending', async () => {
      const id = await makeBooking({ projectTypeId: ids.typeDcId });
      const res = await request(server)
        .post(`/api/v1/bookings/${id}/confirm`)
        .set(asCeo())
        .send({ confirmation: verbalConfirmation })
        .expect(201);

      expect(res.body.status).toBe('PROJECT_CREATED');
      // Verbal is enough to proceed; the email is chased, not required.
      expect(res.body.emailPending).toBe(true);
    });
  });

  describe('project code generation', () => {
    it('mints a code, creates the project and carries the terms over', async () => {
      const id = await makeBooking({ projectName: 'Coded hospital' });
      const documentId = await uploadConfirmation();

      const res = await request(server)
        .post(`/api/v1/bookings/${id}/confirm`)
        .set(asCeo())
        .send({
          confirmation: { type: 'EMAIL', emailDocumentId: documentId, receivedAt: '2026-07-14' },
          poNumber: 'AAR/PO/2026/0455',
        })
        .expect(201);

      expect(res.body.status).toBe('PROJECT_CREATED');
      expect(res.body.generatedProjectCode).toMatch(/^BTC-26-27-HOS-\d{4}$/);
      expect(res.body.lifecycleStage).toBe(4);

      const project = await runUnscoped(() =>
        prisma.project.findFirstOrThrow({ where: { bookingId: id } }),
      );
      expect(project.projectCode).toBe(res.body.generatedProjectCode);
      expect(project.projectValue.toString()).toBe('9500000');
      expect(project.budgetHours.toString()).toBe('4200');
      expect(project.status).toBe('ACTIVE');
    });

    it('uses the project type short code and the booking financial year', async () => {
      // 2026-03-31 falls in FY 25-26 when the year starts in April.
      const id = await makeBooking({
        projectTypeId: ids.typeDcId,
        bookingDate: '2026-03-31',
        expectedStartDate: '2026-04-01',
        expectedEndDate: '2026-12-31',
      });
      const res = await request(server)
        .post(`/api/v1/bookings/${id}/confirm`)
        .set(asCeo())
        .send({ confirmation: verbalConfirmation })
        .expect(201);

      expect(res.body.generatedProjectCode).toMatch(/^BTC-25-26-DC-\d{4}$/);
    });

    it('never issues the same code twice, even under concurrent confirmation', async () => {
      const bookingIds = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          makeBooking({ projectName: `Race ${i}`, projectTypeId: ids.typeDcId }),
        ),
      );

      // All six confirmed at once: the row lock has to serialise them.
      const results = await Promise.all(
        bookingIds.map((id) =>
          request(server)
            .post(`/api/v1/bookings/${id}/confirm`)
            .set(asCeo())
            .send({ confirmation: verbalConfirmation }),
        ),
      );

      const codes = results.map((r) => r.body.generatedProjectCode);
      expect(codes.every(Boolean)).toBe(true);
      expect(new Set(codes).size).toBe(codes.length);

      // And the database agrees: no duplicates, no orphans.
      const projects = await runUnscoped(() =>
        prisma.project.findMany({ where: { companyId: ids.companyId } }),
      );
      expect(new Set(projects.map((p) => p.projectCode)).size).toBe(projects.length);
    });

    it('does not reuse the number of a cancelled booking', async () => {
      const sequenceBefore = await currentSequence();

      const toCancel = await makeBooking({ projectName: 'Will be cancelled' });
      await request(server)
        .post(`/api/v1/bookings/${toCancel}/cancel`)
        .set(asCeo())
        .send({ reason: 'Client deferred' })
        .expect(201);

      // Cancelling a draft consumes no number at all…
      expect(await currentSequence()).toBe(sequenceBefore);

      const next = await makeBooking({ projectName: 'The next one' });
      const res = await request(server)
        .post(`/api/v1/bookings/${next}/confirm`)
        .set(asCeo())
        .send({ confirmation: verbalConfirmation })
        .expect(201);

      // …and the next confirmation simply takes the next number forward.
      expect(await currentSequence()).toBe(sequenceBefore + 1);
      expect(res.body.generatedProjectCode).toContain(String(sequenceBefore + 1).padStart(4, '0'));
    });

    async function currentSequence() {
      const row = await runUnscoped(() =>
        prisma.projectCodeSequence.findFirst({
          where: { companyId: ids.companyId, fyStartYear: 2026 },
        }),
      );
      return row?.lastSequence ?? 0;
    }
  });

  describe('a project can only come from a confirmed booking', () => {
    it('refuses to confirm the same booking twice', async () => {
      const id = await makeBooking();
      await request(server)
        .post(`/api/v1/bookings/${id}/confirm`)
        .set(asCeo())
        .send({ confirmation: verbalConfirmation })
        .expect(201);

      const res = await request(server)
        .post(`/api/v1/bookings/${id}/confirm`)
        .set(asCeo())
        .send({ confirmation: verbalConfirmation })
        .expect(409);
      expect(res.body.code).toBe('ALREADY_CONFIRMED');
    });

    it('locks the booking once it has become a project', async () => {
      const id = await makeBooking();
      await request(server)
        .post(`/api/v1/bookings/${id}/confirm`)
        .set(asCeo())
        .send({ confirmation: verbalConfirmation })
        .expect(201);

      const res = await request(server)
        .patch(`/api/v1/bookings/${id}`)
        .set(asCeo())
        .send({ projectValue: '1.00' })
        .expect(400);
      expect(res.body.code).toBe('BOOKING_LOCKED');
    });
  });

  describe('cancellation', () => {
    it('cancels a draft booking', async () => {
      const id = await makeBooking();
      const res = await request(server)
        .post(`/api/v1/bookings/${id}/cancel`)
        .set(asCeo())
        .send({ reason: 'Client deferred the site' })
        .expect(201);
      expect(res.body.status).toBe('CANCELLED');
    });

    it('blocks cancelling once a project exists, and points at the project', async () => {
      const id = await makeBooking();
      const confirmed = await request(server)
        .post(`/api/v1/bookings/${id}/confirm`)
        .set(asCeo())
        .send({ confirmation: verbalConfirmation })
        .expect(201);

      const res = await request(server)
        .post(`/api/v1/bookings/${id}/cancel`)
        .set(asCeo())
        .send({ reason: 'Client pulled out' })
        .expect(409);

      expect(res.body.code).toBe('PROJECT_EXISTS');
      expect(res.body.message).toMatch(/cancel the project instead/i);
      // The UI needs somewhere to send the user.
      expect(res.body.details.projectCode).toBe(confirmed.body.generatedProjectCode);
      expect(res.body.details.action).toBe('CANCEL_PROJECT');
    });

    it('refuses to cancel twice', async () => {
      const id = await makeBooking();
      await request(server)
        .post(`/api/v1/bookings/${id}/cancel`)
        .set(asCeo())
        .send({ reason: 'First' })
        .expect(201);
      const res = await request(server)
        .post(`/api/v1/bookings/${id}/cancel`)
        .set(asCeo())
        .send({ reason: 'Second' })
        .expect(409);
      expect(res.body.code).toBe('ALREADY_CANCELLED');
    });
  });

  describe('email pending', () => {
    it('clears the badge when the email is attached later', async () => {
      const id = await makeBooking({ projectTypeId: ids.typeDcId });
      const confirmed = await request(server)
        .post(`/api/v1/bookings/${id}/confirm`)
        .set(asCeo())
        .send({ confirmation: verbalConfirmation })
        .expect(201);
      expect(confirmed.body.emailPending).toBe(true);

      const documentId = await uploadConfirmation('late-award.eml');
      const attached = await request(server)
        .post(`/api/v1/bookings/${id}/confirmation-email`)
        .set(asCeo())
        .send({ emailDocumentId: documentId, receivedAt: '2026-08-01' })
        .expect(201);

      expect(attached.body.emailPending).toBe(false);
      // The booking stays what it was; only the evidence improved.
      expect(attached.body.status).toBe('PROJECT_CREATED');
    });

    it('refuses to attach a second email', async () => {
      const id = await makeBooking({ projectTypeId: ids.typeDcId });
      await request(server)
        .post(`/api/v1/bookings/${id}/confirm`)
        .set(asCeo())
        .send({ confirmation: verbalConfirmation })
        .expect(201);

      const first = await uploadConfirmation('one.eml');
      await request(server)
        .post(`/api/v1/bookings/${id}/confirmation-email`)
        .set(asCeo())
        .send({ emailDocumentId: first, receivedAt: '2026-08-01' })
        .expect(201);

      const second = await uploadConfirmation('two.eml');
      const res = await request(server)
        .post(`/api/v1/bookings/${id}/confirmation-email`)
        .set(asCeo())
        .send({ emailDocumentId: second, receivedAt: '2026-08-02' })
        .expect(409);
      expect(res.body.code).toBe('EMAIL_ALREADY_ATTACHED');
    });

    it('filters the register to bookings still waiting on an email', async () => {
      const res = await request(server)
        .get('/api/v1/bookings?emailPending=true&pageSize=100')
        .set(asCeo())
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
      for (const booking of res.body.data) {
        expect(booking.emailPending).toBe(true);
      }
    });
  });

  describe('confirmation file rules', () => {
    it.each([
      ['award.pdf', 'application/pdf'],
      ['award.eml', 'message/rfc822'],
      ['award.msg', 'application/octet-stream'],
      ['award.png', 'image/png'],
      ['award.jpg', 'image/jpeg'],
    ])('accepts %s', async (filename, mime) => {
      await request(server)
        .post('/api/v1/files/confirmations')
        .set(asCeo())
        .attach('file', Buffer.from('content'), { filename, contentType: mime })
        .expect(201);
    });

    it.each(['award.exe', 'award.zip', 'award.docx', 'award'])('rejects %s', async (filename) => {
      const res = await request(server)
        .post('/api/v1/files/confirmations')
        .set(asCeo())
        .attach('file', Buffer.from('content'), filename)
        .expect(400);
      expect(res.body.code).toBe('UNSUPPORTED_FILE');
    });

    it('rejects a file over 10 MB', async () => {
      const tooBig = Buffer.alloc(11 * 1024 * 1024, 0x41);
      await request(server)
        .post('/api/v1/files/confirmations')
        .set(asCeo())
        .attach('file', tooBig, 'huge.pdf')
        .expect(413);
    });

    it('rejects an empty file', async () => {
      const res = await request(server)
        .post('/api/v1/files/confirmations')
        .set(asCeo())
        .attach('file', Buffer.alloc(0), 'empty.pdf')
        .expect(400);
      expect(res.body.code).toBe('UNSUPPORTED_FILE');
    });
  });

  describe('configurable policy', () => {
    afterEach(async () => {
      // Back to the Phase 1 defaults between cases.
      await runUnscoped(() =>
        prisma.company.update({
          where: { id: ids.companyId },
          data: {
            bookingCreateRoleIds: [],
            bookingConfirmRoleIds: [],
            bookingRequiresApproval: false,
            verbalEmailGraceDays: 7,
          },
        }),
      );
    });

    it('narrows who may confirm when a role allow-list is set', async () => {
      const id = await makeBooking();

      await runUnscoped(() =>
        prisma.company.update({
          where: { id: ids.companyId },
          // Only the CEO role may confirm.
          data: { bookingConfirmRoleIds: [ids.ceoRoleId] },
        }),
      );

      // A Team Lead holds no booking.confirm permission anyway…
      await request(server)
        .post(`/api/v1/bookings/${id}/confirm`)
        .set(asLead())
        .send({ confirmation: verbalConfirmation })
        .expect(403);

      // …and the CEO, who is on the list, still can.
      await request(server)
        .post(`/api/v1/bookings/${id}/confirm`)
        .set(asCeo())
        .send({ confirmation: verbalConfirmation })
        .expect(201);
    });

    it('blocks a role that is off the allow-list even with the permission', async () => {
      const id = await makeBooking();
      await runUnscoped(() =>
        prisma.company.update({
          where: { id: ids.companyId },
          // The CEO has booking.confirm but is deliberately not on the list.
          data: { bookingConfirmRoleIds: [ids.leadRoleId] },
        }),
      );

      const res = await request(server)
        .post(`/api/v1/bookings/${id}/confirm`)
        .set(asCeo())
        .send({ confirmation: verbalConfirmation })
        .expect(403);
      expect(res.body.code).toBe('BOOKING_CONFIRM_ROLE');
    });

    it('holds the project until approval when approval is required', async () => {
      await runUnscoped(() =>
        prisma.company.update({
          where: { id: ids.companyId },
          data: { bookingRequiresApproval: true },
        }),
      );

      const id = await makeBooking();
      const confirmed = await request(server)
        .post(`/api/v1/bookings/${id}/confirm`)
        .set(asCeo())
        .send({ confirmation: verbalConfirmation })
        .expect(201);

      // Confirmed, but deliberately not yet a project.
      expect(confirmed.body.status).toBe('CONFIRMED');
      expect(confirmed.body.generatedProjectCode).toBeNull();
      expect(confirmed.body.approvalStatus).toBe('PENDING');

      const approved = await request(server)
        .post(`/api/v1/bookings/${id}/approval`)
        .set(asCeo())
        .send({ decision: 'APPROVED', note: 'Commercials check out' })
        .expect(201);

      expect(approved.body.status).toBe('PROJECT_CREATED');
      expect(approved.body.generatedProjectCode).toMatch(/^BTC-26-27-HOS-\d{4}$/);
    });

    it('sends a rejected booking back to draft with no code consumed', async () => {
      await runUnscoped(() =>
        prisma.company.update({
          where: { id: ids.companyId },
          data: { bookingRequiresApproval: true },
        }),
      );

      const before = await runUnscoped(() =>
        prisma.projectCodeSequence.findFirst({
          where: { companyId: ids.companyId, fyStartYear: 2026 },
        }),
      );

      const id = await makeBooking();
      await request(server)
        .post(`/api/v1/bookings/${id}/confirm`)
        .set(asCeo())
        .send({ confirmation: verbalConfirmation })
        .expect(201);

      const rejected = await request(server)
        .post(`/api/v1/bookings/${id}/approval`)
        .set(asCeo())
        .send({ decision: 'REJECTED', note: 'Margin too thin' })
        .expect(201);

      expect(rejected.body.status).toBe('DRAFT');
      expect(rejected.body.generatedProjectCode).toBeNull();

      const after = await runUnscoped(() =>
        prisma.projectCodeSequence.findFirst({
          where: { companyId: ids.companyId, fyStartYear: 2026 },
        }),
      );
      // A rejection must not burn a number.
      expect(after?.lastSequence).toBe(before?.lastSequence);
    });

    it('chases a verbal booking only after the grace period', async () => {
      await runUnscoped(() =>
        prisma.company.update({
          where: { id: ids.companyId },
          data: { verbalEmailGraceDays: 7 },
        }),
      );

      const id = await makeBooking({ projectTypeId: ids.typeDcId });
      await request(server)
        .post(`/api/v1/bookings/${id}/confirm`)
        .set(asCeo())
        .send({ confirmation: verbalConfirmation })
        .expect(201);

      // Confirmed 20 days ago, so 13 days past a 7-day grace.
      await runUnscoped(() =>
        prisma.bookingConfirmation.update({
          where: { bookingId: id },
          data: { confirmedOn: new Date(Date.now() - 20 * 86_400_000) },
        }),
      );

      const overdue = await request(server).get(`/api/v1/bookings/${id}`).set(asCeo()).expect(200);
      expect(overdue.body.emailOverdueDays).toBe(13);
      // A reminder only: the booking is still a perfectly valid project.
      expect(overdue.body.status).toBe('PROJECT_CREATED');

      // Setting the grace to 0 switches the chase off entirely.
      await runUnscoped(() =>
        prisma.company.update({
          where: { id: ids.companyId },
          data: { verbalEmailGraceDays: 0 },
        }),
      );
      const silenced = await request(server).get(`/api/v1/bookings/${id}`).set(asCeo()).expect(200);
      expect(silenced.body.emailOverdueDays).toBeNull();
    });
  });

  describe('register, summary and code preview', () => {
    it('returns an empty page, not an error, when nothing matches', async () => {
      const res = await request(server)
        .get('/api/v1/bookings?q=no-booking-is-called-this')
        .set(asCeo())
        .expect(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.total).toBe(0);
    });

    it('combines the confirmation-type and email-pending filters instead of dropping one', async () => {
      const res = await request(server)
        .get('/api/v1/bookings?confirmationType=EMAIL&emailPending=true')
        .set(asCeo())
        .expect(200);
      // An EMAIL booking is never "email pending", so the two together match nothing.
      expect(res.body.data).toEqual([]);
    });

    it('summarises the register for the KPI row', async () => {
      const res = await request(server).get('/api/v1/bookings/summary').set(asCeo()).expect(200);
      for (const key of [
        'draft',
        'awaitingApproval',
        'projectCreated',
        'cancelled',
        'activeProjects',
        'emailPending',
        'emailOverdue',
      ]) {
        expect(typeof res.body[key]).toBe('number');
      }
      expect(res.body.emailPending).toBeGreaterThan(0);
      expect(res.body.bookedThisMonth).toHaveProperty('count');
    });

    it('previews the next code without consuming a number', async () => {
      const id = await makeBooking({ bookingDate: '2026-09-01' });
      const first = await request(server)
        .get(`/api/v1/bookings/${id}/code-preview`)
        .set(asCeo())
        .expect(200);
      const second = await request(server)
        .get(`/api/v1/bookings/${id}/code-preview`)
        .set(asCeo())
        .expect(200);
      expect(first.body.code).toMatch(/^BTC-26-27-HOS-\d{4}$/);
      expect(second.body.code).toBe(first.body.code);
      expect(first.body.issued).toBe(false);

      const confirmed = await request(server)
        .post(`/api/v1/bookings/${id}/confirm`)
        .set(asCeo())
        .send({ confirmation: verbalConfirmation })
        .expect(201);
      // The preview was a forecast; with nobody else confirming, it came true.
      expect(confirmed.body.generatedProjectCode).toBe(first.body.code);
    });

    it('serves offices and project types to anyone who can open the register', async () => {
      const res = await request(server).get('/api/v1/bookings/lookups').set(asCeo()).expect(200);
      expect(res.body.offices.map((o: { shortCode: string }) => o.shortCode)).toContain('HQ');
      expect(res.body.projectTypes.map((t: { shortCode: string }) => t.shortCode)).toEqual(
        expect.arrayContaining(['HOS', 'DC']),
      );
      await request(server).get('/api/v1/bookings/lookups').set(asLead()).expect(403);
    });

    it('refuses the summary to a role without booking.view', async () => {
      await request(server).get('/api/v1/bookings/summary').set(asLead()).expect(403);
    });
  });

  describe('permissions', () => {
    it('refuses a Team Lead the confirm endpoint', async () => {
      const id = await makeBooking();
      const res = await request(server)
        .post(`/api/v1/bookings/${id}/confirm`)
        .set(asLead())
        .send({ confirmation: verbalConfirmation })
        .expect(403);
      expect(res.body.details.missingPermissions).toContain('booking.confirm');
    });

    it('refuses a Team Lead the register entirely', async () => {
      // The seeded matrix gives Team Lead no booking.view: bookings are
      // commercial, not delivery. An admin can grant it in Roles & Permissions.
      const res = await request(server).get('/api/v1/bookings').set(asLead()).expect(403);
      expect(res.body.details.missingPermissions).toContain('booking.view');
    });
  });

  describe('booking policy settings', () => {
    const defaults = {
      bookingCreateRoleIds: [] as string[],
      bookingConfirmRoleIds: [] as string[],
      bookingRequiresApproval: false,
      verbalEmailGraceDays: 7,
    };

    afterAll(async () => {
      await request(server).put('/api/v1/settings/booking-policy').set(asCeo()).send(defaults);
    });

    it('reads the policy together with the roles it can pick from', async () => {
      const res = await request(server)
        .get('/api/v1/settings/booking-policy')
        .set(asCeo())
        .expect(200);
      expect(res.body.bookingRequiresApproval).toBe(false);
      expect(res.body.roles.map((r: { id: string }) => r.id)).toContain(ids.ceoRoleId);
    });

    it('saves the policy, and the booking module obeys it straight away', async () => {
      await request(server)
        .put('/api/v1/settings/booking-policy')
        .set(asCeo())
        .send({ ...defaults, bookingRequiresApproval: true, verbalEmailGraceDays: 3 })
        .expect(200);

      const summary = await request(server).get('/api/v1/bookings/summary').set(asCeo());
      expect(summary.body.requiresApproval).toBe(true);

      await request(server)
        .put('/api/v1/settings/booking-policy')
        .set(asCeo())
        .send(defaults)
        .expect(200);
    });

    it('refuses a role that does not belong to this company', async () => {
      const res = await request(server)
        .put('/api/v1/settings/booking-policy')
        .set(asCeo())
        .send({ ...defaults, bookingConfirmRoleIds: ['not-a-role'] })
        .expect(400);
      expect(res.body.code).toBe('UNKNOWN_ROLE');
    });

    it('is closed to a role without settings access', async () => {
      await request(server).get('/api/v1/settings/booking-policy').set(asLead()).expect(403);
      await request(server)
        .put('/api/v1/settings/booking-policy')
        .set(asLead())
        .send(defaults)
        .expect(403);
    });
  });

  describe('clients', () => {
    it('creates a client with contacts', async () => {
      const res = await request(server)
        .post('/api/v1/clients')
        .set(asCeo())
        .send({
          name: 'Northbridge Data Centres',
          city: 'Mumbai',
          contacts: [
            { name: 'Karan Mehta', email: 'karan@nb.com', isPrimary: true },
            { name: 'Second Contact', isPrimary: false },
          ],
        })
        .expect(201);

      expect(res.body.contacts).toHaveLength(2);
      expect(res.body.contacts[0].isPrimary).toBe(true);
    });

    it('rejects a duplicate client name', async () => {
      const res = await request(server)
        .post('/api/v1/clients')
        .set(asCeo())
        .send({ name: 'Aarogya Hospitals' })
        .expect(409);
      expect(res.body.code).toBe('DUPLICATE');
    });

    it('refuses to delete a client that has bookings', async () => {
      const res = await request(server)
        .delete(`/api/v1/clients/${ids.clientId}`)
        .set(asCeo())
        .expect(409);
      expect(res.body.code).toBe('IN_USE');
    });
  });
});
