import { d, log, prisma } from './helpers';

export interface OrgIds {
  companyId: string;
  offices: Record<'NGP' | 'NSK' | 'MUM' | 'RUH', string>;
  departments: Record<string, string>;
  designations: Record<string, string>;
  projectTypes: Record<'HOS' | 'DC' | 'PHA' | 'SOL', string>;
  shifts: Record<'GENERAL_IN' | 'GENERAL_SA' | 'NIGHT', string>;
  leaveTypes: Record<'CL' | 'SL' | 'EL' | 'LOP', string>;
  expenseCategories: Record<string, string>;
}

export async function seedOrg(): Promise<OrgIds> {
  const company = await prisma.company.upsert({
    where: { codePrefix: 'MOR' },
    update: {},
    create: {
      name: 'MOR Engineering Consultants',
      legalName: 'MOR Engineering Consultants Pvt. Ltd.',
      codePrefix: 'MOR',
      projectCodePattern: '{PREFIX}-{FY}-{TYPE}-{SEQ4}',
      fyStartMonth: 4,
      currency: 'INR',
      currencySymbol: '₹',
      gstin: '27AABCM1234D1Z5',
      addressLine1: 'Plot 14, IT Park Road',
      city: 'Nagpur',
      state: 'Maharashtra',
      country: 'India',
      postalCode: '440022',
      phone: '+91 712 400 1100',
      email: 'operations@morengineering.in',
    },
  });
  const companyId = company.id;
  log(
    `company ${company.name} (prefix ${company.codePrefix}, FY starts month ${company.fyStartMonth})`,
  );

  // --- Offices -------------------------------------------------------------
  // Riyadh is nothing but data: its own time zone and a Friday/Saturday weekend.
  const officeSpecs = [
    {
      key: 'NGP' as const,
      name: 'Nagpur HQ',
      shortCode: 'NGP',
      timezone: 'Asia/Kolkata',
      city: 'Nagpur',
      state: 'Maharashtra',
      country: 'India',
      latitude: '21.1458000',
      longitude: '79.0882000',
      geofenceRadiusM: 200,
      weeklyOffDays: [0],
      allowedIPs: ['103.21.58.0/24', '127.0.0.1', '::1'],
      requiresGps: false,
    },
    {
      key: 'NSK' as const,
      name: 'Nashik Office',
      shortCode: 'NSK',
      timezone: 'Asia/Kolkata',
      city: 'Nashik',
      state: 'Maharashtra',
      country: 'India',
      latitude: '19.9975000',
      longitude: '73.7898000',
      geofenceRadiusM: 150,
      weeklyOffDays: [0],
      allowedIPs: ['103.21.59.0/24', '127.0.0.1'],
      requiresGps: false,
    },
    {
      key: 'MUM' as const,
      name: 'Mumbai Client Site',
      shortCode: 'MUM',
      timezone: 'Asia/Kolkata',
      city: 'Mumbai',
      state: 'Maharashtra',
      country: 'India',
      latitude: '19.0760000',
      longitude: '72.8777000',
      geofenceRadiusM: 120,
      weeklyOffDays: [0],
      allowedIPs: [],
      // A client site: GPS and a selfie are mandatory, office IP is not an option.
      requiresGps: true,
    },
    {
      key: 'RUH' as const,
      name: 'Riyadh Office',
      shortCode: 'RUH',
      timezone: 'Asia/Riyadh',
      city: 'Riyadh',
      state: 'Riyadh Province',
      country: 'Saudi Arabia',
      latitude: '24.7136000',
      longitude: '46.6753000',
      geofenceRadiusM: 250,
      weeklyOffDays: [5, 6],
      allowedIPs: ['212.118.10.0/24'],
      requiresGps: false,
    },
  ];

  const offices = {} as OrgIds['offices'];
  for (const o of officeSpecs) {
    const { key, ...data } = o;
    const row = await prisma.office.upsert({
      where: { companyId_shortCode: { companyId, shortCode: o.shortCode } },
      update: {},
      create: { companyId, ...data },
    });
    offices[key] = row.id;
  }
  log(`4 offices (Nagpur, Nashik, Mumbai site [GPS required], Riyadh [Fri-Sat off])`);

  // --- Departments & designations -----------------------------------------
  const departmentNames = [
    ['BIM Modelling', 'BIM'],
    ['MEP Design', 'MEP'],
    ['Project Management', 'PMO'],
    ['Finance & Accounts', 'FIN'],
    ['Human Resources', 'HR'],
  ];
  const departments: Record<string, string> = {};
  for (const [name, shortCode] of departmentNames) {
    const row = await prisma.department.upsert({
      where: { companyId_name: { companyId, name } },
      update: {},
      create: { companyId, name, shortCode },
    });
    departments[name] = row.id;
  }

  const designationSpecs: Array<[string, string | null, number]> = [
    ['Director', 'Project Management', 1],
    ['Project Manager', 'Project Management', 2],
    ['Team Lead', null, 3],
    ['Senior BIM Engineer', 'BIM Modelling', 4],
    ['BIM Engineer', 'BIM Modelling', 5],
    ['MEP Design Engineer', 'MEP Design', 4],
    ['Finance Manager', 'Finance & Accounts', 2],
    ['HR Executive', 'Human Resources', 4],
  ];
  const designations: Record<string, string> = {};
  for (const [name, dept, level] of designationSpecs) {
    const row = await prisma.designation.upsert({
      where: { companyId_name: { companyId, name } },
      update: {},
      create: {
        companyId,
        name,
        level,
        departmentId: dept ? departments[dept] : null,
      },
    });
    designations[name] = row.id;
  }
  log(`${departmentNames.length} departments, ${designationSpecs.length} designations`);

  // --- Project types -------------------------------------------------------
  const typeSpecs = [
    { key: 'HOS' as const, name: 'Hospital', shortCode: 'HOS', colorToken: 'cyan' },
    { key: 'DC' as const, name: 'Data Centre', shortCode: 'DC', colorToken: 'blue' },
    { key: 'PHA' as const, name: 'Pharma', shortCode: 'PHA', colorToken: 'violet' },
    { key: 'SOL' as const, name: 'Solar', shortCode: 'SOL', colorToken: 'amber' },
  ];
  const projectTypes = {} as OrgIds['projectTypes'];
  for (const t of typeSpecs) {
    const row = await prisma.projectType.upsert({
      where: { companyId_shortCode: { companyId, shortCode: t.shortCode } },
      update: {},
      create: { companyId, name: t.name, shortCode: t.shortCode, colorToken: t.colorToken },
    });
    projectTypes[t.key] = row.id;
  }
  log('4 project types: HOS, DC, PHA, SOL');

  // --- Holidays (FY 26-27) -------------------------------------------------
  // officeId null would mean "every office", but Indian public holidays do not
  // apply in Riyadh, so each one is listed against the offices it covers.
  const indiaOffices = [offices.NGP, offices.NSK, offices.MUM];
  const holidaySpecs: Array<[string, string, string[]]> = [
    ['Independence Day', '2026-08-15', indiaOffices],
    ['Saudi National Day', '2026-09-23', [offices.RUH]],
    ['Gandhi Jayanti', '2026-10-02', indiaOffices],
    ['Diwali', '2026-11-08', indiaOffices],
    ['Republic Day', '2027-01-26', indiaOffices],
  ];
  let holidayRows = 0;
  for (const [name, date, officeIds] of holidaySpecs) {
    for (const officeId of officeIds) {
      // Prisma cannot use a compound unique that contains a nullable column,
      // so this checks before inserting rather than upserting.
      const existing = await prisma.holiday.findFirst({
        where: { companyId, officeId, date: d(date), name },
      });
      if (!existing) {
        await prisma.holiday.create({
          data: { companyId, officeId, name, date: d(date) },
        });
      }
      holidayRows += 1;
    }
  }
  log(
    `${holidaySpecs.length} holidays over ${holidayRows} office rows (02 Oct falls inside the seeded week, and not in Riyadh)`,
  );

  // --- Shifts --------------------------------------------------------------
  const shiftSpecs = [
    {
      key: 'GENERAL_IN' as const,
      name: 'General (India)',
      startTime: '09:30',
      endTime: '18:30',
      breakMinutes: 60,
      graceMinutes: 10,
      isDefault: true,
      crossesMidnight: false,
    },
    {
      key: 'GENERAL_SA' as const,
      name: 'General (Riyadh)',
      startTime: '08:00',
      endTime: '17:00',
      breakMinutes: 60,
      graceMinutes: 10,
      isDefault: false,
      crossesMidnight: false,
    },
    {
      key: 'NIGHT' as const,
      name: 'Night Support',
      startTime: '22:00',
      endTime: '06:00',
      breakMinutes: 45,
      graceMinutes: 15,
      isDefault: false,
      crossesMidnight: true,
    },
  ];
  const shifts = {} as OrgIds['shifts'];
  for (const s of shiftSpecs) {
    const { key, ...data } = s;
    const row = await prisma.shift.upsert({
      where: { companyId_name: { companyId, name: s.name } },
      update: {},
      create: { companyId, ...data },
    });
    shifts[key] = row.id;
  }
  log('3 shifts (General India, General Riyadh, Night Support)');

  // --- Attendance policies -------------------------------------------------
  const existingPolicies = await prisma.attendancePolicy.count({ where: { companyId } });
  if (existingPolicies === 0) {
    await prisma.attendancePolicy.createMany({
      data: [
        {
          companyId,
          officeId: null,
          name: 'Company default',
          graceMinutes: 10,
          halfDayBelowHours: '4.00',
          fullDayMinimumHours: '8.00',
          overtimeAfterHours: '9.00',
          earlyExitBeforeMinutes: 15,
          lateMarksPerHalfDay: 3,
          isDefault: true,
        },
        {
          companyId,
          officeId: offices.MUM,
          name: 'Mumbai client site',
          // Site work starts early and the client logs arrivals, so no grace.
          graceMinutes: 0,
          halfDayBelowHours: '4.00',
          fullDayMinimumHours: '8.00',
          overtimeAfterHours: '9.00',
          earlyExitBeforeMinutes: 30,
          lateMarksPerHalfDay: 2,
        },
        {
          companyId,
          officeId: offices.RUH,
          name: 'Riyadh',
          graceMinutes: 15,
          halfDayBelowHours: '4.00',
          fullDayMinimumHours: '8.00',
          overtimeAfterHours: '9.00',
          earlyExitBeforeMinutes: 15,
        },
      ],
    });
  }
  log('3 attendance policies (company default + Mumbai site + Riyadh)');

  // --- Leave types ---------------------------------------------------------
  const leaveSpecs = [
    {
      key: 'CL' as const,
      name: 'Casual Leave',
      shortCode: 'CL',
      yearlyQuota: '12.00',
      carryForward: false,
      maxCarryForward: null,
      isPaid: true,
      approvalFlow: 'SINGLE_LEVEL' as const,
      colorToken: 'blue',
    },
    {
      key: 'SL' as const,
      name: 'Sick Leave',
      shortCode: 'SL',
      yearlyQuota: '8.00',
      carryForward: false,
      maxCarryForward: null,
      isPaid: true,
      approvalFlow: 'SINGLE_LEVEL' as const,
      colorToken: 'amber',
    },
    {
      key: 'EL' as const,
      name: 'Earned Leave',
      shortCode: 'EL',
      yearlyQuota: '18.00',
      carryForward: true,
      maxCarryForward: '30.00',
      isPaid: true,
      approvalFlow: 'TEAM_LEAD_THEN_MANAGER' as const,
      colorToken: 'green',
    },
    {
      key: 'LOP' as const,
      name: 'Loss of Pay',
      shortCode: 'LOP',
      yearlyQuota: '0.00',
      carryForward: false,
      maxCarryForward: null,
      isPaid: false,
      approvalFlow: 'TEAM_LEAD_THEN_MANAGER' as const,
      colorToken: 'red',
    },
  ];
  const leaveTypes = {} as OrgIds['leaveTypes'];
  for (const l of leaveSpecs) {
    const { key, ...data } = l;
    const row = await prisma.leaveType.upsert({
      where: { companyId_shortCode: { companyId, shortCode: l.shortCode } },
      update: {},
      create: { companyId, ...data },
    });
    leaveTypes[key] = row.id;
  }
  log('4 leave types (CL, SL, EL with carry forward, LOP unpaid)');

  // --- Expense categories --------------------------------------------------
  const categorySpecs: Array<[string, string, string | null]> = [
    ['Travel', 'TRV', '15000.00'],
    ['Accommodation', 'ACC', '10000.00'],
    ['Site Materials', 'MAT', '25000.00'],
    ['Client Meals', 'MEAL', '5000.00'],
    ['Software & Tools', 'SW', '50000.00'],
  ];
  const expenseCategories: Record<string, string> = {};
  for (const [name, shortCode, perClaimLimit] of categorySpecs) {
    const row = await prisma.expenseCategory.upsert({
      where: { companyId_name: { companyId, name } },
      update: {},
      create: { companyId, name, shortCode, perClaimLimit, requiresReceipt: true },
    });
    expenseCategories[name] = row.id;
  }
  log(`${categorySpecs.length} expense categories with per-claim limits`);

  return {
    companyId,
    offices,
    departments,
    designations,
    projectTypes,
    shifts,
    leaveTypes,
    expenseCategories,
  };
}
