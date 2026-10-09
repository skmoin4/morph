import { SYSTEM_ROLES } from '@opsvera/shared';
import bcrypt from 'bcryptjs';
import { d, log, prisma } from './helpers';
import type { OrgIds } from './org';

/** Every seeded account shares this password. Development only. */
export const SEED_PASSWORD = 'Opsvera@2026';

export type EmployeeKey =
  | 'rajesh'
  | 'priya'
  | 'anil'
  | 'sameer'
  | 'neha'
  | 'vikram'
  | 'sneha'
  | 'amit'
  | 'pooja'
  | 'faisal';

interface EmployeeSpec {
  key: EmployeeKey;
  code: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: string;
  office: keyof OrgIds['offices'];
  department: string;
  designation: string;
  manager: EmployeeKey | null;
  joiningDate: string;
  attendanceMethod: 'MOBILE' | 'OFFICE' | 'BOTH';
  salary: string;
  /** [hourlyRate, effectiveFrom][] — more than one row exercises rate history. */
  rates: Array<[string, string]>;
}

const SPECS: EmployeeSpec[] = [
  {
    key: 'rajesh',
    code: 'MOR-001',
    firstName: 'Rajesh',
    lastName: 'Deshmukh',
    email: 'rajesh.deshmukh@morengineering.in',
    phone: '+91 98220 11001',
    role: SYSTEM_ROLES.CEO,
    office: 'NGP',
    department: 'Project Management',
    designation: 'Director',
    manager: null,
    joiningDate: '2016-04-01',
    attendanceMethod: 'BOTH',
    salary: '450000.00',
    rates: [['2500.00', '2016-04-01']],
  },
  {
    key: 'priya',
    code: 'MOR-002',
    firstName: 'Priya',
    lastName: 'Kulkarni',
    email: 'priya.kulkarni@morengineering.in',
    phone: '+91 98220 11002',
    role: SYSTEM_ROLES.HR_ADMIN,
    office: 'NGP',
    department: 'Human Resources',
    designation: 'HR Executive',
    manager: 'rajesh',
    joiningDate: '2019-06-10',
    attendanceMethod: 'OFFICE',
    salary: '65000.00',
    rates: [['600.00', '2019-06-10']],
  },
  {
    key: 'anil',
    code: 'MOR-003',
    firstName: 'Anil',
    lastName: 'Joshi',
    email: 'anil.joshi@morengineering.in',
    phone: '+91 98220 11003',
    role: SYSTEM_ROLES.FINANCE,
    office: 'NGP',
    department: 'Finance & Accounts',
    designation: 'Finance Manager',
    manager: 'rajesh',
    joiningDate: '2018-02-01',
    attendanceMethod: 'OFFICE',
    salary: '120000.00',
    rates: [['900.00', '2018-02-01']],
  },
  {
    key: 'sameer',
    code: 'MOR-004',
    firstName: 'Sameer',
    lastName: 'Patil',
    email: 'sameer.patil@morengineering.in',
    phone: '+91 98220 11004',
    role: SYSTEM_ROLES.PROJECT_MANAGER,
    office: 'NGP',
    department: 'Project Management',
    designation: 'Project Manager',
    manager: 'rajesh',
    joiningDate: '2017-09-15',
    attendanceMethod: 'BOTH',
    salary: '185000.00',
    rates: [['1400.00', '2017-09-15']],
  },
  {
    key: 'neha',
    code: 'MOR-005',
    firstName: 'Neha',
    lastName: 'Bhosale',
    email: 'neha.bhosale@morengineering.in',
    phone: '+91 98220 11005',
    role: SYSTEM_ROLES.PROJECT_MANAGER,
    office: 'MUM',
    department: 'Project Management',
    designation: 'Project Manager',
    manager: 'rajesh',
    joiningDate: '2020-01-06',
    attendanceMethod: 'MOBILE',
    salary: '175000.00',
    rates: [['1350.00', '2020-01-06']],
  },
  {
    key: 'vikram',
    code: 'MOR-006',
    firstName: 'Vikram',
    lastName: 'Rane',
    email: 'vikram.rane@morengineering.in',
    phone: '+91 98220 11006',
    role: SYSTEM_ROLES.TEAM_LEAD,
    office: 'NGP',
    department: 'BIM Modelling',
    designation: 'Team Lead',
    manager: 'sameer',
    joiningDate: '2019-03-04',
    attendanceMethod: 'BOTH',
    salary: '110000.00',
    rates: [['950.00', '2019-03-04']],
  },
  {
    key: 'sneha',
    code: 'MOR-007',
    firstName: 'Sneha',
    lastName: 'Gokhale',
    email: 'sneha.gokhale@morengineering.in',
    phone: '+91 98220 11007',
    role: SYSTEM_ROLES.TEAM_LEAD,
    office: 'NSK',
    department: 'MEP Design',
    designation: 'Team Lead',
    manager: 'neha',
    joiningDate: '2020-07-20',
    attendanceMethod: 'OFFICE',
    salary: '105000.00',
    rates: [['920.00', '2020-07-20']],
  },
  {
    key: 'amit',
    code: 'MOR-008',
    firstName: 'Amit',
    lastName: 'Chavan',
    email: 'amit.chavan@morengineering.in',
    phone: '+91 98220 11008',
    role: SYSTEM_ROLES.EMPLOYEE,
    office: 'NGP',
    department: 'BIM Modelling',
    designation: 'Senior BIM Engineer',
    manager: 'vikram',
    joiningDate: '2021-11-01',
    attendanceMethod: 'BOTH',
    salary: '78000.00',
    // A mid-week rise on 1 Oct: the seeded timesheet week straddles it, so the
    // ledger has to use 650 for 28-30 Sep and 700 for 1-4 Oct.
    rates: [
      ['650.00', '2021-11-01'],
      ['700.00', '2026-10-01'],
    ],
  },
  {
    key: 'pooja',
    code: 'MOR-009',
    firstName: 'Pooja',
    lastName: 'Shinde',
    email: 'pooja.shinde@morengineering.in',
    phone: '+91 98220 11009',
    role: SYSTEM_ROLES.EMPLOYEE,
    office: 'NSK',
    department: 'MEP Design',
    designation: 'MEP Design Engineer',
    manager: 'sneha',
    joiningDate: '2022-05-16',
    attendanceMethod: 'OFFICE',
    salary: '72000.00',
    rates: [['650.00', '2022-05-16']],
  },
  {
    key: 'faisal',
    code: 'MOR-010',
    firstName: 'Faisal',
    lastName: 'Al-Harbi',
    email: 'faisal.alharbi@morengineering.in',
    phone: '+966 50 123 4567',
    role: SYSTEM_ROLES.EMPLOYEE,
    office: 'RUH',
    department: 'BIM Modelling',
    designation: 'BIM Engineer',
    manager: 'vikram',
    joiningDate: '2023-02-05',
    attendanceMethod: 'BOTH',
    salary: '90000.00',
    rates: [['800.00', '2023-02-05']],
  },
];

export interface PeopleIds {
  employees: Record<EmployeeKey, string>;
  users: Record<EmployeeKey, string>;
  offices: Record<EmployeeKey, keyof OrgIds['offices']>;
}

export async function seedPeople(
  org: OrgIds,
  roleIdByKey: Record<string, string>,
): Promise<PeopleIds> {
  const { companyId } = org;
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  const employees = {} as PeopleIds['employees'];
  const users = {} as PeopleIds['users'];
  const officeOf = {} as PeopleIds['offices'];

  // Pass 1: users and employees, without the manager link.
  for (const spec of SPECS) {
    const user = await prisma.user.upsert({
      where: { email: spec.email },
      update: {},
      create: {
        companyId,
        email: spec.email,
        passwordHash,
        fullName: `${spec.firstName} ${spec.lastName}`,
        roleId: roleIdByKey[spec.role],
        status: 'ACTIVE',
      },
    });

    const employee = await prisma.employee.upsert({
      where: { companyId_employeeCode: { companyId, employeeCode: spec.code } },
      update: {},
      create: {
        companyId,
        userId: user.id,
        employeeCode: spec.code,
        firstName: spec.firstName,
        lastName: spec.lastName,
        workEmail: spec.email,
        phone: spec.phone,
        joiningDate: d(spec.joiningDate),
        officeId: org.offices[spec.office],
        departmentId: org.departments[spec.department],
        designationId: org.designations[spec.designation],
        attendanceMethod: spec.attendanceMethod,
        status: 'ACTIVE',
      },
    });

    users[spec.key] = user.id;
    employees[spec.key] = employee.id;
    officeOf[spec.key] = spec.office;
  }

  // Pass 2: reporting lines, now that every row exists.
  for (const spec of SPECS) {
    if (!spec.manager) continue;
    await prisma.employee.update({
      where: { id: employees[spec.key] },
      data: { managerId: employees[spec.manager] },
    });
  }
  log(`${SPECS.length} employees with users, roles and reporting lines`);

  // --- Cost rate and salary history ---------------------------------------
  for (const spec of SPECS) {
    for (let i = 0; i < spec.rates.length; i += 1) {
      const [hourlyRate, effectiveFrom] = spec.rates[i];
      const next = spec.rates[i + 1];
      await prisma.employeeCostRate.upsert({
        where: {
          employeeId_effectiveFrom: {
            employeeId: employees[spec.key],
            effectiveFrom: d(effectiveFrom),
          },
        },
        update: {},
        create: {
          companyId,
          employeeId: employees[spec.key],
          hourlyRate,
          effectiveFrom: d(effectiveFrom),
          // Closing the old row keeps "the rate on this date" a single lookup.
          effectiveTo: next ? d(next[1]) : null,
          note: i === 0 ? 'Initial rate' : 'Annual revision',
        },
      });
    }

    await prisma.employeeSalary.upsert({
      where: {
        employeeId_effectiveFrom: {
          employeeId: employees[spec.key],
          effectiveFrom: d(spec.joiningDate),
        },
      },
      update: {},
      create: {
        companyId,
        employeeId: employees[spec.key],
        monthlyAmount: spec.salary,
        effectiveFrom: d(spec.joiningDate),
        note: 'On joining',
      },
    });
  }
  log('cost rate history (Amit has a 01 Oct 2026 rise) and monthly salaries');

  // --- Shift assignments ---------------------------------------------------
  const existingAssignments = await prisma.shiftAssignment.count({ where: { companyId } });
  if (existingAssignments === 0) {
    await prisma.shiftAssignment.createMany({
      data: SPECS.map((spec) => ({
        companyId,
        shiftId: spec.office === 'RUH' ? org.shifts.GENERAL_SA : org.shifts.GENERAL_IN,
        employeeId: employees[spec.key],
        effectiveFrom: d(spec.joiningDate),
      })),
    });
  }
  log('shift assignments (Riyadh staff on the 08:00-17:00 shift)');

  // --- Leave balances for the current leave year ---------------------------
  const year = 2026;
  const quotas: Array<[keyof OrgIds['leaveTypes'], string, string]> = [
    ['CL', '12.00', '0.00'],
    ['SL', '8.00', '0.00'],
    ['EL', '18.00', '4.50'],
  ];
  for (const spec of SPECS) {
    for (const [typeKey, accrued, carried] of quotas) {
      await prisma.leaveBalance.upsert({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: employees[spec.key],
            leaveTypeId: org.leaveTypes[typeKey],
            year,
          },
        },
        update: {},
        create: {
          companyId,
          employeeId: employees[spec.key],
          leaveTypeId: org.leaveTypes[typeKey],
          year,
          accrued,
          carriedForward: carried,
        },
      });
    }
  }
  log(`leave balances for ${year} (CL 12, SL 8, EL 18 + 4.5 carried)`);

  return { employees, users, offices: officeOf };
}
