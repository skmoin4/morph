import { Decimal } from 'decimal.js';
import { forbiddenFieldsFor, maskSensitiveFields } from './sensitive-fields';
import type { AuthenticatedUser } from '../types/authenticated-user';

function userWith(permissions: string[]): AuthenticatedUser {
  return {
    userId: 'u1',
    companyId: 'c1',
    employeeId: 'e1',
    roleId: 'r1',
    roleName: 'Test',
    systemRoleKey: null,
    email: 'test@example.com',
    fullName: 'Test User',
    officeId: 'o1',
    permissions: new Set(permissions),
    scopes: new Map(),
  };
}

/** A project payload shaped the way the dashboard and Project 360 return it. */
const project = {
  id: 'p1',
  projectCode: 'MOR-26-27-HOS-0001',
  name: 'Aarogya Super Speciality Hospital',
  budgetHours: '4200.00',
  actualHours: '2734.00',
  projectValue: '9500000.00',
  actualLabourCost: '5922800.00',
  actualExpenseCost: '0.00',
  actualTotalCost: '5922800.00',
  marginPercent: '37.65',
  client: { id: 'c1', name: 'Aarogya Hospitals Pvt Ltd' },
  members: [
    {
      id: 'm1',
      employee: {
        id: 'e2',
        firstName: 'Amit',
        hourlyRate: '700.00',
        salary: { monthlyAmount: '78000.00' },
      },
    },
  ],
};

describe('field masking', () => {
  it('lets a user with every sensitive permission see everything', () => {
    const user = userWith(['cost.view', 'salary.view', 'margin.view', 'project.value.view']);
    expect(forbiddenFieldsFor(user).size).toBe(0);
    expect(maskSensitiveFields(project, forbiddenFieldsFor(user))).toEqual(project);
  });

  it('strips cost, salary, value and margin from a plain employee payload', () => {
    const user = userWith(['project.view']);
    const masked = maskSensitiveFields(project, forbiddenFieldsFor(user)) as typeof project;

    // Gone entirely.
    expect(masked).not.toHaveProperty('projectValue');
    expect(masked).not.toHaveProperty('actualLabourCost');
    expect(masked).not.toHaveProperty('actualTotalCost');
    expect(masked).not.toHaveProperty('marginPercent');

    // Still there: nothing non-sensitive was lost.
    expect(masked.projectCode).toBe('MOR-26-27-HOS-0001');
    expect(masked.budgetHours).toBe('4200.00');
    expect(masked.actualHours).toBe('2734.00');
    expect(masked.client.name).toBe('Aarogya Hospitals Pvt Ltd');
  });

  it('reaches sensitive fields nested inside arrays and objects', () => {
    const user = userWith(['project.view']);
    const masked = maskSensitiveFields(project, forbiddenFieldsFor(user)) as typeof project;
    const member = masked.members[0].employee as Record<string, unknown>;

    expect(member.firstName).toBe('Amit');
    expect(member).not.toHaveProperty('hourlyRate');
    expect(member).not.toHaveProperty('salary');
  });

  it('grants each sensitive field independently', () => {
    const costOnly = userWith(['cost.view']);
    const masked = maskSensitiveFields(project, forbiddenFieldsFor(costOnly)) as typeof project;

    // cost.view reveals the cost columns…
    expect(masked.actualLabourCost).toBe('5922800.00');
    // …but not the commercials or the margin.
    expect(masked).not.toHaveProperty('projectValue');
    expect(masked).not.toHaveProperty('marginPercent');
  });

  it('deletes rather than nulls, so the UI can hide the column', () => {
    const masked = maskSensitiveFields(
      { projectValue: '100.00' },
      forbiddenFieldsFor(userWith([])),
    );
    // A null would be indistinguishable from "not set yet" and would render ₹0.
    expect(Object.keys(masked)).toEqual([]);
  });

  it('treats Decimals and Dates as values, not structures to walk into', () => {
    const payload = {
      name: 'Row',
      amount: new Decimal('1234.56'),
      postedAt: new Date('2026-10-04T00:00:00.000Z'),
      projectValue: '9500000.00',
    };
    const masked = maskSensitiveFields(payload, forbiddenFieldsFor(userWith([]))) as typeof payload;

    expect(masked.amount).toBeInstanceOf(Decimal);
    expect(masked.amount.toFixed(2)).toBe('1234.56');
    expect(masked.postedAt).toBeInstanceOf(Date);
    expect(masked).not.toHaveProperty('projectValue');
  });

  it('handles a paginated list envelope', () => {
    const page = {
      data: [
        { id: 'p1', projectValue: '1.00' },
        { id: 'p2', projectValue: '2.00' },
      ],
      meta: { page: 1, pageSize: 25, total: 2, totalPages: 1 },
    };
    const masked = maskSensitiveFields(page, forbiddenFieldsFor(userWith([]))) as typeof page;

    expect(masked.data).toHaveLength(2);
    expect(masked.data[0]).toEqual({ id: 'p1' });
    expect(masked.meta.total).toBe(2);
  });
});
