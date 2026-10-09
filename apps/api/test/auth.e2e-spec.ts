import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import bcrypt from 'bcryptjs';
import { DEFAULT_ROLES, ALL_PERMISSIONS, resolveRolePermissions } from '@opsvera/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { runUnscoped } from '../src/prisma/tenant-context';
import { REFRESH_COOKIE } from '../src/modules/auth/token.service';
import { resetDatabase, testPrisma as prisma } from './db';

const PASSWORD = 'Opsvera@2026';

/**
 * End-to-end cover for step 2: sign-in, session, permission enforcement,
 * refresh-token rotation and theft detection, and company isolation.
 */
describe('Auth and RBAC (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;

  const ids = {
    alphaCompany: '',
    betaCompany: '',
    ceoEmail: 'ceo@alpha.test',
    employeeEmail: 'employee@alpha.test',
    betaCeoEmail: 'ceo@beta.test',
    alphaClientId: '',
    betaClientId: '',
  };

  beforeAll(async () => {
    await resetDatabase();
    await seedTwoCompanies();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('/api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  async function seedTwoCompanies() {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    // The permission catalogue is global.
    await runUnscoped(async () => {
      for (const key of ALL_PERMISSIONS) {
        const [module, ...rest] = key.split('.');
        await prisma.permission.create({
          data: { key, module, action: rest.join('.'), label: key },
        });
      }
    });
    const permissionIdByKey = new Map(
      (await runUnscoped(() => prisma.permission.findMany())).map((p) => [p.key, p.id]),
    );

    async function makeCompany(name: string, prefix: string, emails: Record<string, string>) {
      return runUnscoped(async () => {
        const company = await prisma.company.create({
          data: { name, codePrefix: prefix, fyStartMonth: 4 },
        });
        const office = await prisma.office.create({
          data: { companyId: company.id, name: `${name} HQ`, shortCode: `${prefix}1` },
        });
        const client = await prisma.client.create({
          data: { companyId: company.id, name: `${name} Client` },
        });

        const roleIds: Record<string, string> = {};
        for (const def of DEFAULT_ROLES) {
          const role = await prisma.role.create({
            data: {
              companyId: company.id,
              name: def.name,
              systemKey: def.systemKey,
              isSystem: true,
            },
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

        for (const [systemKey, email] of Object.entries(emails)) {
          const user = await prisma.user.create({
            data: {
              companyId: company.id,
              email,
              passwordHash,
              fullName: email,
              roleId: roleIds[systemKey],
              status: 'ACTIVE',
            },
          });
          await prisma.employee.create({
            data: {
              companyId: company.id,
              userId: user.id,
              employeeCode: `${prefix}-${email.slice(0, 3)}`,
              firstName: email.split('@')[0],
              lastName: 'Test',
              joiningDate: new Date('2026-01-01T00:00:00.000Z'),
              officeId: office.id,
            },
          });
        }

        return { companyId: company.id, clientId: client.id };
      });
    }

    const alpha = await makeCompany('Alpha Engineering', 'ALP', {
      CEO: ids.ceoEmail,
      EMPLOYEE: ids.employeeEmail,
    });
    const beta = await makeCompany('Beta Engineering', 'BET', { CEO: ids.betaCeoEmail });

    ids.alphaCompany = alpha.companyId;
    ids.alphaClientId = alpha.clientId;
    ids.betaCompany = beta.companyId;
    ids.betaClientId = beta.clientId;
  }

  async function login(email: string) {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return {
      accessToken: res.body.accessToken as string,
      cookie: extractRefreshCookie(res.headers['set-cookie']),
    };
  }

  describe('sign-in', () => {
    it('returns an access token and sets an httpOnly refresh cookie', async () => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: ids.ceoEmail, password: PASSWORD })
        .expect(200);

      expect(res.body.accessToken).toEqual(expect.any(String));
      // The refresh token must never be readable by JavaScript.
      const raw = (res.headers['set-cookie'] as unknown as string[]).join(';');
      expect(raw).toContain(REFRESH_COOKIE);
      expect(raw).toContain('HttpOnly');
      // It is also not echoed in the body.
      expect(JSON.stringify(res.body)).not.toContain('refreshToken');
    });

    it('rejects a wrong password with the same message as an unknown address', async () => {
      const wrongPassword = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: ids.ceoEmail, password: 'NotMyPassword1' })
        .expect(401);
      const unknownUser = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@alpha.test', password: PASSWORD })
        .expect(401);

      // Identical responses, so login cannot be used to enumerate accounts.
      expect(wrongPassword.body.code).toBe('INVALID_CREDENTIALS');
      expect(unknownUser.body.message).toBe(wrongPassword.body.message);
    });

    it('rejects a malformed payload with field-level detail', async () => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: '' })
        .expect(422);

      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'email' })]),
      );
    });
  });

  describe('session', () => {
    it('rejects a request with no token', async () => {
      const res = await request(server).get('/api/v1/auth/me').expect(401);
      expect(res.body.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a forged token', async () => {
      const res = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer not.a.real.token')
        .expect(401);
      expect(res.body.code).toBe('TOKEN_INVALID');
    });

    it('returns the user with their permissions and scopes', async () => {
      const { accessToken } = await login(ids.ceoEmail);
      const res = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.email).toBe(ids.ceoEmail);
      expect(res.body.companyId).toBe(ids.alphaCompany);
      expect(res.body.permissions).toContain('booking.confirm');
      expect(res.body.scopes['booking.view']).toBe('ALL');
    });

    it('gives an employee a narrow permission set and OWN scope', async () => {
      const { accessToken } = await login(ids.employeeEmail);
      const res = await request(server)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.permissions).not.toContain('booking.confirm');
      expect(res.body.permissions).not.toContain('salary.view');
      expect(res.body.scopes['timesheet.create']).toBe('OWN');
    });
  });

  describe('permission enforcement', () => {
    it('blocks an employee from an admin route and names what is missing', async () => {
      const { accessToken } = await login(ids.employeeEmail);
      const res = await request(server)
        .get('/api/v1/roles')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN');
      expect(res.body.details.missingPermissions).toContain('role.view');
    });

    it('allows the CEO through the same route', async () => {
      const { accessToken } = await login(ids.ceoEmail);
      const res = await request(server)
        .get('/api/v1/roles')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.meta.total).toBe(DEFAULT_ROLES.length);
    });

    it('refuses to strip the CEO role of access to the permission screen', async () => {
      const { accessToken } = await login(ids.ceoEmail);
      const list = await request(server)
        .get('/api/v1/roles')
        .set('Authorization', `Bearer ${accessToken}`);
      const ceoRole = list.body.data.find((r: { systemKey: string }) => r.systemKey === 'CEO');

      const res = await request(server)
        .put(`/api/v1/roles/${ceoRole.id}/permissions`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ permissions: [{ key: 'dashboard.view', dataScope: 'ALL' }] })
        .expect(400);

      // Otherwise an admin could lock everyone out of the screen that fixes it.
      expect(res.body.code).toBe('ROLE_LOCKOUT');
    });
  });

  describe('company isolation', () => {
    it('shows each company only its own roles', async () => {
      const alpha = await login(ids.ceoEmail);
      const beta = await login(ids.betaCeoEmail);

      const alphaRoles = await request(server)
        .get('/api/v1/roles')
        .set('Authorization', `Bearer ${alpha.accessToken}`)
        .expect(200);
      const betaRoles = await request(server)
        .get('/api/v1/roles')
        .set('Authorization', `Bearer ${beta.accessToken}`)
        .expect(200);

      const alphaIds = alphaRoles.body.data.map((r: { id: string }) => r.id).sort();
      const betaIds = betaRoles.body.data.map((r: { id: string }) => r.id).sort();

      expect(alphaIds).toHaveLength(DEFAULT_ROLES.length);
      expect(betaIds).toHaveLength(DEFAULT_ROLES.length);
      // Same names, entirely different rows.
      expect(alphaIds.some((id: string) => betaIds.includes(id))).toBe(false);
    });

    it('404s when one company asks for another company role by id', async () => {
      const alpha = await login(ids.ceoEmail);
      const beta = await login(ids.betaCeoEmail);

      const betaRoles = await request(server)
        .get('/api/v1/roles')
        .set('Authorization', `Bearer ${beta.accessToken}`);
      const betaRoleId = betaRoles.body.data[0].id;

      const res = await request(server)
        .get(`/api/v1/roles/${betaRoleId}`)
        .set('Authorization', `Bearer ${alpha.accessToken}`)
        .expect(404);

      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('scopes the audit log to the signed-in company', async () => {
      const alpha = await login(ids.ceoEmail);
      const res = await request(server)
        .get('/api/v1/audit-logs?pageSize=100')
        .set('Authorization', `Bearer ${alpha.accessToken}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
      for (const row of res.body.data) {
        expect(row.companyId).toBe(ids.alphaCompany);
      }
    });
  });

  describe('refresh tokens', () => {
    it('rotates the token and issues a fresh access token', async () => {
      const { cookie } = await login(ids.ceoEmail);

      const res = await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE}=${cookie}`)
        .expect(200);

      expect(res.body.accessToken).toEqual(expect.any(String));
      const rotated = extractRefreshCookie(res.headers['set-cookie']);
      expect(rotated).not.toBe(cookie);
    });

    it('treats reuse of a rotated token as theft and kills the session family', async () => {
      const { cookie } = await login(ids.ceoEmail);

      // First use rotates it.
      const first = await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE}=${cookie}`)
        .expect(200);
      const rotated = extractRefreshCookie(first.headers['set-cookie']);

      // Replaying the old cookie is the signal that it was stolen.
      const replay = await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE}=${cookie}`)
        .expect(401);
      expect(replay.body.code).toBe('REFRESH_REUSED');

      // …and the legitimate holder's token is revoked too, forcing a sign-in.
      await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE}=${rotated}`)
        .expect(401);
    });

    it('rejects a refresh with no cookie', async () => {
      const res = await request(server).post('/api/v1/auth/refresh').expect(400);
      expect(res.body.code).toBe('REFRESH_MISSING');
    });

    it('logout revokes the session', async () => {
      const { cookie } = await login(ids.ceoEmail);

      await request(server)
        .post('/api/v1/auth/logout')
        .set('Cookie', `${REFRESH_COOKIE}=${cookie}`)
        .expect(204);

      await request(server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', `${REFRESH_COOKIE}=${cookie}`)
        .expect(401);
    });
  });
});

/** Pulls the refresh token value out of a Set-Cookie header. */
function extractRefreshCookie(header: string | string[] | undefined): string {
  const cookies = Array.isArray(header) ? header : [header ?? ''];
  const match = cookies.find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
  return match ? match.split(';')[0].slice(REFRESH_COOKIE.length + 1) : '';
}
