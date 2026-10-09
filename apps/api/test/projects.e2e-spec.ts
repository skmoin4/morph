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
const d = (v: string) => new Date(`${v}T00:00:00.000Z`);

/** Step 7: projects, team, milestones, tasks and the Kanban board. */
describe('Projects (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;

  const who = {
    ceo: { email: 'ceo@pj.test', token: '', employeeId: '' },
    pm: { email: 'pm@pj.test', token: '', employeeId: '' },
    lead: { email: 'lead@pj.test', token: '', employeeId: '' },
    ann: { email: 'ann@pj.test', token: '', employeeId: '' }, // on project 1
    bob: { email: 'bob@pj.test', token: '', employeeId: '' }, // on project 1
    eve: { email: 'eve@pj.test', token: '', employeeId: '' }, // on no project, ever
    zed: { email: 'zed@pj.test', token: '', employeeId: '' }, // joins and leaves in the team tests
  };
  const ids = { p1: '', p2: '', inactiveEmployee: '' };

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
        data: { name: 'Project Test Co', codePrefix: 'PJT', fyStartMonth: 4 },
      });
      const office = await prisma.office.create({
        data: { companyId: company.id, name: 'HQ', shortCode: 'HQ', timezone: 'Asia/Kolkata' },
      });
      const client = await prisma.client.create({
        data: { companyId: company.id, name: 'Test Client' },
      });
      const type = await prisma.projectType.create({
        data: { companyId: company.id, name: 'Hospital', shortCode: 'HOS' },
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

      let n = 0;
      async function person(
        key: keyof typeof who,
        systemKey: string,
        managerId: string | null = null,
      ) {
        n += 1;
        const user = await prisma.user.create({
          data: {
            companyId: company.id,
            email: who[key].email,
            passwordHash,
            fullName: key,
            roleId: roleIds[systemKey],
            status: 'ACTIVE',
          },
        });
        const employee = await prisma.employee.create({
          data: {
            companyId: company.id,
            userId: user.id,
            employeeCode: `PJT-00${n}`,
            firstName: key,
            lastName: 'Tester',
            joiningDate: d('2024-01-01'),
            officeId: office.id,
            managerId,
          },
        });
        who[key].employeeId = employee.id;
      }
      await person('ceo', 'CEO');
      await person('pm', 'PROJECT_MANAGER');
      await person('lead', 'TEAM_LEAD');
      await person('ann', 'EMPLOYEE', who.lead.employeeId);
      await person('bob', 'EMPLOYEE', who.lead.employeeId);
      await person('eve', 'EMPLOYEE');
      await person('zed', 'EMPLOYEE');

      const inactive = await prisma.employee.create({
        data: {
          companyId: company.id,
          employeeCode: 'PJT-099',
          firstName: 'Gone',
          lastName: 'Away',
          joiningDate: d('2022-01-01'),
          officeId: office.id,
          status: 'EXITED',
        },
      });
      ids.inactiveEmployee = inactive.id;

      async function project(code: string, name: string, pmId: string | null) {
        const booking = await prisma.booking.create({
          data: {
            companyId: company.id,
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
        const p = await prisma.project.create({
          data: {
            companyId: company.id,
            projectCode: code,
            name,
            bookingId: booking.id,
            clientId: client.id,
            projectTypeId: type.id,
            officeId: office.id,
            projectManagerId: pmId,
            startDate: d('2026-08-01'),
            endDate: d('2027-03-31'),
            projectValue: '5000000.00',
            budgetHours: '1000.00',
            actualHours: '250.00',
            actualTotalCost: '1200000.00',
          },
        });
        return p.id;
      }
      ids.p1 = await project('PJT-26-27-HOS-0001', 'Hospital One', who.pm.employeeId);
      ids.p2 = await project('PJT-26-27-HOS-0002', 'Hospital Two', null);

      for (const key of ['ann', 'bob'] as const) {
        await prisma.projectMember.create({
          data: { companyId: company.id, projectId: ids.p1, employeeId: who[key].employeeId },
        });
      }
    });
  }

  async function newTask(body: Record<string, unknown> = {}, project = ids.p1) {
    const res = await request(server)
      .post(`/api/v1/projects/${project}/tasks`)
      .set(as('pm'))
      .send({ title: 'Clash detection L2', assigneeId: who.ann.employeeId, ...body })
      .expect((r) => {
        if (r.status !== 201) throw new Error(`newTask ${r.status}: ${JSON.stringify(r.body)}`);
      });
    return res.body as { id: string; sortOrder: number; status: string };
  }

  // -------------------------------------------------------------------------

  describe('data scope', () => {
    it('shows the CEO every project', async () => {
      const res = await request(server).get('/api/v1/projects').set(as('ceo')).expect(200);
      expect(res.body.meta.total).toBe(2);
    });

    it('shows a PM only the projects they manage', async () => {
      const res = await request(server).get('/api/v1/projects').set(as('pm')).expect(200);
      expect(res.body.data.map((p: { id: string }) => p.id)).toEqual([ids.p1]);
    });

    it('shows a team member only their own projects', async () => {
      const ann = await request(server).get('/api/v1/projects').set(as('ann')).expect(200);
      expect(ann.body.data.map((p: { id: string }) => p.id)).toEqual([ids.p1]);

      const eve = await request(server).get('/api/v1/projects').set(as('eve')).expect(200);
      expect(eve.body.data).toEqual([]);
    });

    it('does not show a Team Lead projects they are not on (PROJECT scope)', async () => {
      const res = await request(server).get('/api/v1/projects').set(as('lead')).expect(200);
      expect(res.body.data).toEqual([]);
      await request(server).get(`/api/v1/projects/${ids.p1}`).set(as('lead')).expect(404);
    });

    it('404s, rather than 403s, for a project outside the caller scope', async () => {
      await request(server).get(`/api/v1/projects/${ids.p2}`).set(as('ann')).expect(404);
      await request(server).get(`/api/v1/projects/${ids.p1}`).set(as('eve')).expect(404);
    });

    it('ignores a sort column it does not know instead of erroring', async () => {
      await request(server).get('/api/v1/projects?sort=nonsense:asc').set(as('ceo')).expect(200);
    });
  });

  describe('sensitive fields', () => {
    it('hides value, cost and margin from a plain team member', async () => {
      const res = await request(server).get(`/api/v1/projects/${ids.p1}`).set(as('ann')).expect(200);
      for (const field of ['projectValue', 'actualTotalCost', 'marginAmount', 'marginPercent']) {
        expect(res.body).not.toHaveProperty(field);
      }
      // Hours are not sensitive.
      expect(res.body.hoursBurnPercent).toBe(25);
    });

    it('shows them to the CEO', async () => {
      const res = await request(server).get(`/api/v1/projects/${ids.p1}`).set(as('ceo')).expect(200);
      expect(res.body.projectValue).toBe('5000000');
      expect(Number(res.body.marginAmount)).toBe(3_800_000);
      expect(res.body.marginPercent).toBe(76);
    });
  });

  describe('project 360', () => {
    it('carries the booking, team and task counts', async () => {
      const res = await request(server).get(`/api/v1/projects/${ids.p1}`).set(as('pm')).expect(200);
      expect(res.body.booking.bookingNumber).toBe('BKG-PJT-26-27-HOS-0001');
      expect(res.body.members).toHaveLength(2);
      expect(res.body.tasks.total).toBe(0);
      // Team but no plan yet.
      expect(res.body.scheduled).toBe(false);
    });
  });

  describe('editing a project', () => {
    it('lets a PM change dates and health', async () => {
      const res = await request(server)
        .patch(`/api/v1/projects/${ids.p1}`)
        .set(as('pm'))
        .send({ endDate: '2027-04-30', health: 'AT_RISK' })
        .expect(200);
      expect(res.body.health).toBe('AT_RISK');
      expect(res.body.endDate).toContain('2027-04-30');
    });

    it('rejects an end date before the start', async () => {
      await request(server)
        .patch(`/api/v1/projects/${ids.p1}`)
        .set(as('pm'))
        .send({ endDate: '2026-01-01' })
        .expect(400);
    });

    it('refuses a plain employee', async () => {
      await request(server)
        .patch(`/api/v1/projects/${ids.p1}`)
        .set(as('ann'))
        .send({ health: 'HEALTHY' })
        .expect(403);
    });

    it('will not point a project at an exited manager', async () => {
      const res = await request(server)
        .patch(`/api/v1/projects/${ids.p1}`)
        .set(as('ceo'))
        .send({ projectManagerId: ids.inactiveEmployee })
        .expect(400);
      expect(res.body.code).toBe('EMPLOYEE_INACTIVE');
    });
  });

  describe('project status', () => {
    it('moves along the allowed transitions and stamps completion', async () => {
      const done = await request(server)
        .post(`/api/v1/projects/${ids.p2}/status`)
        .set(as('ceo'))
        .send({ status: 'COMPLETED' })
        .expect(201);
      expect(done.body.status).toBe('COMPLETED');
      expect(done.body.completedAt).toBeTruthy();

      const reopened = await request(server)
        .post(`/api/v1/projects/${ids.p2}/status`)
        .set(as('ceo'))
        .send({ status: 'ACTIVE' })
        .expect(201);
      expect(reopened.body.completedAt).toBeNull();
    });

    it('refuses a jump the lifecycle does not allow', async () => {
      await request(server)
        .post(`/api/v1/projects/${ids.p2}/status`)
        .set(as('ceo'))
        .send({ status: 'COMPLETED' })
        .expect(201);
      const res = await request(server)
        .post(`/api/v1/projects/${ids.p2}/status`)
        .set(as('ceo'))
        .send({ status: 'ON_HOLD' })
        .expect(400);
      expect(res.body.code).toBe('INVALID_TRANSITION');
      await request(server)
        .post(`/api/v1/projects/${ids.p2}/status`)
        .set(as('ceo'))
        .send({ status: 'ACTIVE' })
        .expect(201);
    });

    it('needs a reason to cancel, and audits it', async () => {
      await request(server)
        .post(`/api/v1/projects/${ids.p2}/status`)
        .set(as('ceo'))
        .send({ status: 'CANCELLED' })
        .expect(422);

      await request(server)
        .post(`/api/v1/projects/${ids.p2}/status`)
        .set(as('ceo'))
        .send({ status: 'CANCELLED', reason: 'Client withdrew the tender' })
        .expect(201);

      const audit = await prisma.auditLog.findFirst({
        where: { entityType: 'Project', entityId: ids.p2, reason: 'Client withdrew the tender' },
      });
      expect(audit).not.toBeNull();

      await request(server)
        .post(`/api/v1/projects/${ids.p2}/status`)
        .set(as('ceo'))
        .send({ status: 'ACTIVE' })
        .expect(201);
    });
  });

  describe('team', () => {
    it('adds a member, and will not add the same person twice', async () => {
      await request(server)
        .post(`/api/v1/projects/${ids.p1}/members`)
        .set(as('pm'))
        .send({ employeeId: who.zed.employeeId, roleOnProject: 'BIM Coordinator' })
        .expect(201);

      const again = await request(server)
        .post(`/api/v1/projects/${ids.p1}/members`)
        .set(as('pm'))
        .send({ employeeId: who.zed.employeeId })
        .expect(409);
      expect(again.body.code).toBe('ALREADY_MEMBER');
    });

    it('refuses someone who has left the company', async () => {
      const res = await request(server)
        .post(`/api/v1/projects/${ids.p1}/members`)
        .set(as('pm'))
        .send({ employeeId: ids.inactiveEmployee })
        .expect(400);
      expect(res.body.code).toBe('EMPLOYEE_INACTIVE');
    });

    it('keeps the history when someone is removed, and reopens it on re-adding', async () => {
      const detail = await request(server).get(`/api/v1/projects/${ids.p1}`).set(as('pm'));
      const zedRow = detail.body.members.find(
        (m: { employeeId: string }) => m.employeeId === who.zed.employeeId,
      );

      const removed = await request(server)
        .delete(`/api/v1/projects/${ids.p1}/members/${zedRow.id}`)
        .set(as('pm'))
        .expect(200);
      const gone = removed.body.members.find((m: { id: string }) => m.id === zedRow.id);
      expect(gone.isActive).toBe(false);
      expect(gone.leftOn).toBeTruthy();

      const back = await request(server)
        .post(`/api/v1/projects/${ids.p1}/members`)
        .set(as('pm'))
        .send({ employeeId: who.zed.employeeId })
        .expect(201);
      const same = back.body.members.filter(
        (m: { employeeId: string }) => m.employeeId === who.zed.employeeId,
      );
      expect(same).toHaveLength(1);
      expect(same[0].isActive).toBe(true);
    });

    it('will not remove someone who still has open tasks', async () => {
      const task = await newTask({ title: 'Blocks removal', assigneeId: who.zed.employeeId });
      const detail = await request(server).get(`/api/v1/projects/${ids.p1}`).set(as('pm'));
      const zedRow = detail.body.members.find(
        (m: { employeeId: string }) => m.employeeId === who.zed.employeeId,
      );

      const res = await request(server)
        .delete(`/api/v1/projects/${ids.p1}/members/${zedRow.id}`)
        .set(as('pm'))
        .expect(409);
      expect(res.body.code).toBe('HAS_OPEN_TASKS');

      await request(server)
        .patch(`/api/v1/tasks/${task.id}`)
        .set(as('pm'))
        .send({ status: 'DONE' })
        .expect(200);
      await request(server)
        .delete(`/api/v1/projects/${ids.p1}/members/${zedRow.id}`)
        .set(as('pm'))
        .expect(200);
    });
  });

  describe('milestones', () => {
    it('creates, completes and deletes a milestone, freeing its tasks', async () => {
      const created = await request(server)
        .post(`/api/v1/projects/${ids.p1}/milestones`)
        .set(as('pm'))
        .send({ name: 'LOD 300 issue', dueDate: '2026-12-15' })
        .expect(201);

      const task = await newTask({ title: 'Under milestone', milestoneId: created.body.id });

      const done = await request(server)
        .patch(`/api/v1/projects/${ids.p1}/milestones/${created.body.id}`)
        .set(as('pm'))
        .send({ status: 'COMPLETED' })
        .expect(200);
      expect(done.body.completedOn).toBeTruthy();

      await request(server)
        .delete(`/api/v1/projects/${ids.p1}/milestones/${created.body.id}`)
        .set(as('pm'))
        .expect(204);

      const after = await request(server).get(`/api/v1/tasks/${task.id}`).set(as('pm')).expect(200);
      expect(after.body.milestoneId).toBeNull();
    });

    it('refuses a due date outside the project dates', async () => {
      const res = await request(server)
        .post(`/api/v1/projects/${ids.p1}/milestones`)
        .set(as('pm'))
        .send({ name: 'Typo year', dueDate: '2036-12-15' })
        .expect(400);
      expect(res.body.code).toBe('OUTSIDE_PROJECT_DATES');
    });

    it('marks the project scheduled once there is a plan and a team', async () => {
      const res = await request(server).get(`/api/v1/projects/${ids.p1}`).set(as('pm')).expect(200);
      expect(res.body.scheduled).toBe(true);
    });
  });

  describe('tasks', () => {
    it('only assigns people who are on the project team', async () => {
      const res = await request(server)
        .post(`/api/v1/projects/${ids.p1}/tasks`)
        .set(as('pm'))
        .send({ title: 'For a stranger', assigneeId: who.lead.employeeId })
        .expect(400);
      expect(res.body.code).toBe('ASSIGNEE_NOT_ON_PROJECT');
    });

    it('will not take a milestone from another project', async () => {
      const other = await prisma.milestone.create({
        data: {
          companyId: (await prisma.project.findFirstOrThrow({ where: { id: ids.p2 } })).companyId,
          projectId: ids.p2,
          name: 'Elsewhere',
          dueDate: d('2026-12-01'),
        },
      });
      const res = await request(server)
        .post(`/api/v1/projects/${ids.p1}/tasks`)
        .set(as('pm'))
        .send({ title: 'Wrong milestone', milestoneId: other.id })
        .expect(400);
      expect(res.body.code).toBe('MILESTONE_NOT_ON_PROJECT');
    });

    it('refuses a plain employee the right to create tasks', async () => {
      await request(server)
        .post(`/api/v1/projects/${ids.p1}/tasks`)
        .set(as('ann'))
        .send({ title: 'Sneaky' })
        .expect(403);
    });

    it('lets an employee move their own task but not someone else’s', async () => {
      const mine = await newTask({ title: 'Ann’s task', assigneeId: who.ann.employeeId });
      const theirs = await newTask({ title: 'Bob’s task', assigneeId: who.bob.employeeId });

      const moved = await request(server)
        .post(`/api/v1/tasks/${mine.id}/move`)
        .set(as('ann'))
        .send({ status: 'IN_PROGRESS' })
        .expect(201);
      expect(moved.body.status).toBe('IN_PROGRESS');

      const res = await request(server)
        .post(`/api/v1/tasks/${theirs.id}/move`)
        .set(as('ann'))
        .send({ status: 'IN_PROGRESS' })
        .expect(403);
      expect(res.body.code).toBe('NOT_YOUR_TASK');
    });

    it('stops an employee handing their task to someone else', async () => {
      const mine = await newTask({ title: 'Not transferable', assigneeId: who.ann.employeeId });
      const res = await request(server)
        .patch(`/api/v1/tasks/${mine.id}`)
        .set(as('ann'))
        .send({ assigneeId: who.bob.employeeId })
        .expect(403);
      expect(res.body.code).toBe('CANNOT_REASSIGN');
    });

    it('hides a task on a project the caller is not part of', async () => {
      const t = await newTask({ title: 'Private to the team' });
      await request(server).get(`/api/v1/tasks/${t.id}`).set(as('eve')).expect(404);
      await request(server)
        .post(`/api/v1/tasks/${t.id}/comments`)
        .set(as('eve'))
        .send({ body: 'hi' })
        .expect(404);
    });

    it('lists only tasks in scope, even when asked for another project', async () => {
      const other = await newTask({ title: 'On project two', assigneeId: undefined }, ids.p2).catch(
        () => null,
      );
      void other;
      const res = await request(server)
        .get(`/api/v1/tasks?projectId=${ids.p2}&pageSize=200`)
        .set(as('ann'))
        .expect(200);
      expect(res.body.data).toEqual([]);
    });

    it('flags overdue tasks and filters on them', async () => {
      const late = await newTask({ title: 'Was due last year', dueDate: '2025-01-01' });
      const res = await request(server)
        .get('/api/v1/tasks?overdue=true&pageSize=200')
        .set(as('pm'))
        .expect(200);
      const found = res.body.data.find((t: { id: string }) => t.id === late.id);
      expect(found.isOverdue).toBe(true);
    });

    it('refuses to delete a task that has time logged against it', async () => {
      const t = await newTask({ title: 'Has time' });
      const row = await prisma.task.findFirstOrThrow({ where: { id: t.id } });
      const employee = await prisma.employee.findFirstOrThrow({ where: { id: who.ann.employeeId } });
      await prisma.timeEntry.create({
        data: {
          companyId: row.companyId,
          employeeId: employee.id,
          projectId: ids.p1,
          taskId: t.id,
          workDate: d('2026-10-01'),
          hours: '2.00',
          source: 'MANUAL',
        } as never,
      });
      const res = await request(server).delete(`/api/v1/tasks/${t.id}`).set(as('pm')).expect(400);
      expect(res.body.code).toBe('HAS_TIME');
    });
  });

  describe('Kanban ordering', () => {
    it('places a dropped card above its target and keeps the column numbered 0..n', async () => {
      const a = await newTask({ title: 'Col A' });
      const b = await newTask({ title: 'Col B' });
      const c = await newTask({ title: 'Col C' });

      await request(server)
        .post(`/api/v1/tasks/${c.id}/move`)
        .set(as('pm'))
        .send({ status: 'TODO', beforeTaskId: a.id })
        .expect(201);

      const rows = await prisma.task.findMany({
        where: { id: { in: [a.id, b.id, c.id] } },
        orderBy: { sortOrder: 'asc' },
      });
      const order = rows.map((r) => r.id);
      expect(order.indexOf(c.id)).toBeLessThan(order.indexOf(a.id));
      expect(order.indexOf(a.id)).toBeLessThan(order.indexOf(b.id));

      const column = await prisma.task.findMany({
        where: { projectId: ids.p1, status: 'TODO', deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      });
      expect(column.map((t) => t.sortOrder)).toEqual(column.map((_, i) => i));
    });

    it('stamps completion when a card reaches Done and clears it when it leaves', async () => {
      const t = await newTask({ title: 'Finish me' });
      const done = await request(server)
        .post(`/api/v1/tasks/${t.id}/move`)
        .set(as('pm'))
        .send({ status: 'DONE' })
        .expect(201);
      expect(done.body.completedAt).toBeTruthy();

      const back = await request(server)
        .post(`/api/v1/tasks/${t.id}/move`)
        .set(as('pm'))
        .send({ status: 'REVIEW' })
        .expect(201);
      expect(back.body.completedAt).toBeNull();
    });

    it('falls back to the bottom when the drop target has gone', async () => {
      const t = await newTask({ title: 'Stale drop' });
      const res = await request(server)
        .post(`/api/v1/tasks/${t.id}/move`)
        .set(as('pm'))
        .send({ status: 'REVIEW', beforeTaskId: 'ghost' })
        .expect(201);
      expect(res.body.status).toBe('REVIEW');
    });
  });

  describe('closed projects', () => {
    it('refuses task changes on a cancelled project until it is reopened', async () => {
      const t = await newTask({ title: 'Before cancel' });
      await request(server)
        .post(`/api/v1/projects/${ids.p1}/status`)
        .set(as('ceo'))
        .send({ status: 'CANCELLED', reason: 'Paused indefinitely by client' })
        .expect(201);

      const res = await request(server)
        .post(`/api/v1/tasks/${t.id}/move`)
        .set(as('pm'))
        .send({ status: 'DONE' })
        .expect(400);
      expect(res.body.code).toBe('PROJECT_CLOSED');

      await request(server)
        .post(`/api/v1/projects/${ids.p1}/status`)
        .set(as('ceo'))
        .send({ status: 'ACTIVE' })
        .expect(201);
    });
  });

  describe('comments and attachments', () => {
    it('lets anyone who can see a task comment on it', async () => {
      const t = await newTask({ title: 'Discuss' });
      const res = await request(server)
        .post(`/api/v1/tasks/${t.id}/comments`)
        .set(as('bob'))
        .send({ body: 'Checked against the architect’s set.' })
        .expect(201);
      expect(res.body.comments).toHaveLength(1);
      expect(res.body.comments[0].author).toBe('bob Tester');
    });

    it('stores an attachment, serves it as a download, and removes it', async () => {
      const t = await newTask({ title: 'With a drawing', assigneeId: who.ann.employeeId });

      const up = await request(server)
        .post(`/api/v1/tasks/${t.id}/attachments`)
        .set(as('ann'))
        .attach('file', Buffer.from('%PDF-1.4 drawing'), 'GA-plan.pdf')
        .expect(201);
      expect(up.body.attachments).toHaveLength(1);
      const attachmentId = up.body.attachments[0].id;

      const dl = await request(server)
        .get(`/api/v1/tasks/${t.id}/attachments/${attachmentId}/download`)
        .set(as('bob'))
        .expect(200);
      expect(dl.headers['content-disposition']).toContain('attachment');

      await request(server)
        .get(`/api/v1/tasks/${t.id}/attachments/${attachmentId}/download`)
        .set(as('eve'))
        .expect(404);

      const del = await request(server)
        .delete(`/api/v1/tasks/${t.id}/attachments/${attachmentId}`)
        .set(as('ann'))
        .expect(200);
      expect(del.body.attachments).toHaveLength(0);
    });

    it('rejects an executable', async () => {
      const t = await newTask({ title: 'Bad upload' });
      const res = await request(server)
        .post(`/api/v1/tasks/${t.id}/attachments`)
        .set(as('pm'))
        .attach('file', Buffer.from('MZ'), 'setup.exe')
        .expect(400);
      expect(res.body.code).toBe('UNSUPPORTED_FILE');
    });
  });
});
