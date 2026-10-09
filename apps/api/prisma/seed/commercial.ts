import { DEFAULT_PROJECT_CODE_PATTERN, buildProjectCode } from '@opsvera/shared';
import { d, log, prisma } from './helpers';
import type { OrgIds } from './org';
import type { EmployeeKey, PeopleIds } from './people';

export interface CommercialIds {
  clients: Record<'aarogya' | 'northbridge' | 'veridia' | 'alnoor', string>;
  bookings: Record<string, string>;
  projects: Record<'hospital' | 'datacentre' | 'pharma', string>;
  tasks: Record<string, string>;
}

const FY_LABEL = '26-27';

export async function seedCommercial(org: OrgIds, people: PeopleIds): Promise<CommercialIds> {
  const { companyId } = org;

  // --- Clients and contacts ------------------------------------------------
  const clientSpecs = [
    {
      key: 'aarogya' as const,
      name: 'Aarogya Hospitals Pvt Ltd',
      clientCode: 'CL-001',
      industry: 'Healthcare',
      city: 'Nagpur',
      contacts: [
        {
          name: 'Dr. Meera Agarwal',
          designation: 'Director — Projects',
          email: 'meera.agarwal@aarogyahospitals.in',
          phone: '+91 98230 44001',
          isPrimary: true,
        },
        {
          name: 'Ravi Tiwari',
          designation: 'Facilities Head',
          email: 'ravi.tiwari@aarogyahospitals.in',
          phone: '+91 98230 44002',
          isPrimary: false,
        },
      ],
    },
    {
      key: 'northbridge' as const,
      name: 'Northbridge Data Centres',
      clientCode: 'CL-002',
      industry: 'Data Centre',
      city: 'Mumbai',
      contacts: [
        {
          name: 'Karan Mehta',
          designation: 'VP Engineering',
          email: 'karan.mehta@northbridgedc.com',
          phone: '+91 98200 55001',
          isPrimary: true,
        },
      ],
    },
    {
      key: 'veridia' as const,
      name: 'Veridia Pharma Ltd',
      clientCode: 'CL-003',
      industry: 'Pharmaceuticals',
      city: 'Nashik',
      contacts: [
        {
          name: 'Sunita Rao',
          designation: 'Head — Capital Projects',
          email: 'sunita.rao@veridiapharma.com',
          phone: '+91 98600 66001',
          isPrimary: true,
        },
      ],
    },
    {
      key: 'alnoor' as const,
      name: 'Al Noor Energy Holding',
      clientCode: 'CL-004',
      industry: 'Renewable Energy',
      city: 'Riyadh',
      contacts: [
        {
          name: 'Omar Al-Rashid',
          designation: 'Project Director',
          email: 'omar.alrashid@alnoorenergy.sa',
          phone: '+966 50 777 1200',
          isPrimary: true,
        },
      ],
    },
  ];

  const clients = {} as CommercialIds['clients'];
  const primaryContacts: Record<string, string> = {};
  for (const spec of clientSpecs) {
    const client = await prisma.client.upsert({
      where: { companyId_name: { companyId, name: spec.name } },
      update: {},
      create: {
        companyId,
        name: spec.name,
        clientCode: spec.clientCode,
        industry: spec.industry,
        city: spec.city,
        country: spec.key === 'alnoor' ? 'Saudi Arabia' : 'India',
      },
    });
    clients[spec.key] = client.id;

    for (const c of spec.contacts) {
      const existing = await prisma.clientContact.findFirst({
        where: { clientId: client.id, name: c.name },
      });
      const row =
        existing ??
        (await prisma.clientContact.create({
          data: { companyId, clientId: client.id, ...c },
        }));
      if (c.isPrimary) primaryContacts[spec.key] = row.id;
    }
  }
  log(`${clientSpecs.length} clients with contacts`);

  // --- Confirmation documents ---------------------------------------------
  // The files themselves are not written to disk by the seeder; these rows
  // stand in for uploads so the booking screens have something to link to.
  async function confirmationDoc(fileName: string, ownerLabel: string): Promise<string> {
    const existing = await prisma.document.findFirst({ where: { companyId, fileName } });
    if (existing) return existing.id;
    const doc = await prisma.document.create({
      data: {
        companyId,
        ownerType: 'BOOKING',
        category: 'Client confirmation email',
        fileName,
        mimeType: 'message/rfc822',
        sizeBytes: 48_120,
        storageKey: `company/${companyId}/bookings/${ownerLabel}/${fileName}`,
        storageDriver: 'local',
      },
    });
    return doc.id;
  }

  // --- Bookings ------------------------------------------------------------
  // Three became projects; one sits in DRAFT and one was cancelled, so the
  // booking register shows every state of the lifecycle stepper.
  interface BookingSpec {
    key: string;
    bookingNumber: string;
    client: keyof CommercialIds['clients'];
    projectName: string;
    projectType: keyof OrgIds['projectTypes'];
    office: keyof OrgIds['offices'];
    bookingDate: string;
    projectValue: string;
    budgetHours: string;
    billingType: 'FIXED' | 'HOURLY' | 'MILESTONE';
    expectedStartDate: string;
    expectedEndDate: string;
    scope: string;
    pm: EmployeeKey | null;
    status: 'DRAFT' | 'CONFIRMED' | 'PROJECT_CREATED' | 'CANCELLED';
    confirmation:
      | { type: 'EMAIL'; receivedAt: string; fileName: string }
      | { type: 'VERBAL'; by: string; on: string; mode: 'CALL' | 'MEETING'; summary: string }
      | null;
    poNumber?: string;
    /** Sequence consumed at confirmation; only set for the three with projects. */
    sequence?: number;
    cancelReason?: string;
  }

  const bookingSpecs: BookingSpec[] = [
    {
      key: 'hospital',
      bookingNumber: 'BKG-2627-0001',
      client: 'aarogya',
      projectName: 'Aarogya Super Speciality Hospital — BIM & MEP',
      projectType: 'HOS',
      office: 'NGP',
      bookingDate: '2026-07-14',
      projectValue: '9500000.00',
      budgetHours: '4200.00',
      billingType: 'FIXED',
      expectedStartDate: '2026-08-03',
      expectedEndDate: '2027-03-31',
      scope:
        'Full BIM coordination (LOD 400) and MEP detailed design for a 320-bed super speciality hospital. Includes clash resolution, shop drawings and as-built models.',
      pm: 'sameer',
      status: 'PROJECT_CREATED',
      confirmation: {
        type: 'EMAIL',
        receivedAt: '2026-07-14',
        fileName: 'Aarogya-award-confirmation.eml',
      },
      poNumber: 'AAR/PO/2026/0455',
      sequence: 1,
    },
    {
      key: 'datacentre',
      bookingNumber: 'BKG-2627-0002',
      client: 'northbridge',
      projectName: 'Northbridge Mumbai DC — Phase 2',
      projectType: 'DC',
      office: 'MUM',
      bookingDate: '2026-08-02',
      projectValue: '18750000.00',
      budgetHours: '7600.00',
      billingType: 'MILESTONE',
      expectedStartDate: '2026-08-17',
      expectedEndDate: '2027-06-30',
      scope:
        'MEP design and BIM delivery for a 12 MW colocation hall: electrical distribution, chilled water, fire suppression and BMS integration.',
      pm: 'neha',
      status: 'PROJECT_CREATED',
      confirmation: {
        type: 'EMAIL',
        receivedAt: '2026-08-01',
        fileName: 'Northbridge-phase2-go-ahead.eml',
      },
      poNumber: 'NB/WO/2026/118',
      sequence: 2,
    },
    {
      key: 'pharma',
      bookingNumber: 'BKG-2627-0003',
      client: 'veridia',
      projectName: 'Veridia Nashik Formulation Block',
      projectType: 'PHA',
      office: 'NSK',
      bookingDate: '2026-09-08',
      projectValue: '6200000.00',
      budgetHours: '2800.00',
      billingType: 'HOURLY',
      expectedStartDate: '2026-09-21',
      expectedEndDate: '2027-04-30',
      scope:
        'Cleanroom MEP design to ISO 14644 Class 8, HVAC zoning, and BIM coordination for an oral solid dosage formulation block.',
      pm: 'sameer',
      status: 'PROJECT_CREATED',
      // Confirmed on a call with no email yet: this is the "Email pending" badge.
      confirmation: {
        type: 'VERBAL',
        by: 'Sunita Rao',
        on: '2026-09-08',
        mode: 'CALL',
        summary:
          'Sunita confirmed award on a call at 16:20 IST. Scope and commercials as per our 02 Sep proposal rev C, value ₹62,00,000 on an hourly basis against 2,800 budgeted hours. Mobilisation from 21 Sep. Written confirmation to follow after their board note is signed.',
      },
      sequence: 3,
    },
    {
      key: 'solar',
      bookingNumber: 'BKG-2627-0004',
      client: 'alnoor',
      projectName: 'Al Noor Riyadh Solar Park — 60 MWp',
      projectType: 'SOL',
      office: 'RUH',
      bookingDate: '2026-10-01',
      projectValue: '23400000.00',
      budgetHours: '9200.00',
      billingType: 'MILESTONE',
      expectedStartDate: '2026-11-02',
      expectedEndDate: '2027-10-29',
      scope:
        'Detailed engineering for a 60 MWp ground-mount solar park: DC/AC design, SCADA, substation interface and BIM model for the control building.',
      pm: null,
      status: 'DRAFT',
      confirmation: null,
    },
    {
      key: 'edge',
      bookingNumber: 'BKG-2627-0005',
      client: 'northbridge',
      projectName: 'Northbridge Pune Edge DC',
      projectType: 'DC',
      office: 'MUM',
      bookingDate: '2026-08-26',
      projectValue: '7800000.00',
      budgetHours: '3100.00',
      billingType: 'FIXED',
      expectedStartDate: '2026-09-14',
      expectedEndDate: '2027-02-26',
      scope: 'MEP design for a 2 MW edge facility. Shelved by the client pending land acquisition.',
      pm: null,
      status: 'CANCELLED',
      confirmation: null,
      cancelReason: 'Client deferred the site indefinitely — land acquisition stalled.',
    },
  ];

  const bookings: Record<string, string> = {};
  const projectCodes: Record<string, string> = {};

  for (const spec of bookingSpecs) {
    const confirmed = spec.status === 'CONFIRMED' || spec.status === 'PROJECT_CREATED';
    const projectCode =
      spec.sequence === undefined
        ? null
        : buildProjectCode(DEFAULT_PROJECT_CODE_PATTERN, {
            prefix: 'MOR',
            fy: FY_LABEL,
            type: spec.projectType,
            sequence: spec.sequence,
          });

    const booking = await prisma.booking.upsert({
      where: { companyId_bookingNumber: { companyId, bookingNumber: spec.bookingNumber } },
      update: {},
      create: {
        companyId,
        bookingNumber: spec.bookingNumber,
        clientId: clients[spec.client],
        clientContactId: primaryContacts[spec.client] ?? null,
        projectName: spec.projectName,
        projectTypeId: org.projectTypes[spec.projectType],
        officeId: org.offices[spec.office],
        bookingDate: d(spec.bookingDate),
        projectValue: spec.projectValue,
        budgetHours: spec.budgetHours,
        billingType: spec.billingType,
        expectedStartDate: d(spec.expectedStartDate),
        expectedEndDate: d(spec.expectedEndDate),
        scopeDescription: spec.scope,
        projectManagerId: spec.pm ? people.employees[spec.pm] : null,
        status: spec.status,
        confirmedAt: confirmed ? new Date(`${spec.bookingDate}T11:00:00.000Z`) : null,
        confirmedById: confirmed ? people.users.rajesh : null,
        cancelledAt:
          spec.status === 'CANCELLED' ? new Date(`${spec.bookingDate}T06:00:00.000Z`) : null,
        cancelReason: spec.cancelReason ?? null,
        generatedProjectCode: projectCode,
      },
    });
    bookings[spec.key] = booking.id;
    if (projectCode) projectCodes[spec.key] = projectCode;

    if (spec.confirmation) {
      const existing = await prisma.bookingConfirmation.findUnique({
        where: { bookingId: booking.id },
      });
      if (!existing) {
        if (spec.confirmation.type === 'EMAIL') {
          const docId = await confirmationDoc(spec.confirmation.fileName, spec.bookingNumber);
          await prisma.bookingConfirmation.create({
            data: {
              companyId,
              bookingId: booking.id,
              type: 'EMAIL',
              emailDocumentId: docId,
              emailReceivedAt: d(spec.confirmation.receivedAt),
              poNumber: spec.poNumber ?? null,
              createdById: people.users.rajesh,
            },
          });
        } else {
          await prisma.bookingConfirmation.create({
            data: {
              companyId,
              bookingId: booking.id,
              type: 'VERBAL',
              confirmedByName: spec.confirmation.by,
              confirmedOn: d(spec.confirmation.on),
              verbalMode: spec.confirmation.mode,
              verbalSummary: spec.confirmation.summary,
              createdById: people.users.rajesh,
            },
          });
        }
      }
    }

    if (confirmed) {
      const alreadyAudited = await prisma.auditLog.findFirst({
        where: { companyId, entityType: 'Booking', entityId: booking.id, action: 'CONFIRM' },
      });
      if (!alreadyAudited) {
        await prisma.auditLog.create({
          data: {
            companyId,
            userId: people.users.rajesh,
            action: 'CONFIRM',
            entityType: 'Booking',
            entityId: booking.id,
            summary: `Confirmed booking ${spec.bookingNumber}${projectCode ? ` and created project ${projectCode}` : ''}`,
            afterData: {
              status: spec.status,
              confirmationType: spec.confirmation?.type,
              projectCode,
            },
          },
        });
      }
    }
  }
  log(`${bookingSpecs.length} bookings: 3 -> projects, 1 draft, 1 cancelled`);
  log('Veridia booking is VERBAL with no email attached — "Email pending" badge');

  // The counter sits at 3: the cancelled booking never consumed a number, and
  // a cancelled one would never return its number to the pool.
  await prisma.projectCodeSequence.upsert({
    where: { companyId_fyStartYear: { companyId, fyStartYear: 2026 } },
    update: { lastSequence: 3 },
    create: { companyId, fyStartYear: 2026, fyLabel: FY_LABEL, lastSequence: 3 },
  });
  log(`project code sequence for FY ${FY_LABEL} at 3 (next is 0004)`);

  // --- Projects ------------------------------------------------------------
  interface ProjectSpec {
    key: keyof CommercialIds['projects'];
    bookingKey: string;
    name: string;
    client: keyof CommercialIds['clients'];
    projectType: keyof OrgIds['projectTypes'];
    office: keyof OrgIds['offices'];
    pm: EmployeeKey;
    startDate: string;
    endDate: string;
    projectValue: string;
    budgetHours: string;
    billingType: 'FIXED' | 'HOURLY' | 'MILESTONE';
    members: Array<[EmployeeKey, string]>;
    milestones: Array<[string, string, 'PENDING' | 'IN_PROGRESS' | 'COMPLETED']>;
  }

  const projectSpecs: ProjectSpec[] = [
    {
      key: 'hospital',
      bookingKey: 'hospital',
      name: 'Aarogya Super Speciality Hospital — BIM & MEP',
      client: 'aarogya',
      projectType: 'HOS',
      office: 'NGP',
      pm: 'sameer',
      startDate: '2026-08-03',
      endDate: '2027-03-31',
      projectValue: '9500000.00',
      budgetHours: '4200.00',
      billingType: 'FIXED',
      members: [
        ['sameer', 'Project Manager'],
        ['vikram', 'BIM Lead'],
        ['amit', 'Senior BIM Engineer'],
        ['pooja', 'MEP Design Engineer'],
      ],
      milestones: [
        ['Concept model & survey sign-off', '2026-09-15', 'COMPLETED'],
        ['LOD 300 coordination complete', '2026-12-18', 'IN_PROGRESS'],
        ['LOD 400 + shop drawings issued', '2027-03-20', 'PENDING'],
      ],
    },
    {
      key: 'datacentre',
      bookingKey: 'datacentre',
      name: 'Northbridge Mumbai DC — Phase 2',
      client: 'northbridge',
      projectType: 'DC',
      office: 'MUM',
      pm: 'neha',
      startDate: '2026-08-17',
      endDate: '2027-06-30',
      projectValue: '18750000.00',
      budgetHours: '7600.00',
      billingType: 'MILESTONE',
      members: [
        ['neha', 'Project Manager'],
        ['sneha', 'MEP Lead'],
        ['faisal', 'BIM Engineer'],
        ['amit', 'Senior BIM Engineer'],
      ],
      milestones: [
        ['Basis of design approved', '2026-09-30', 'COMPLETED'],
        ['Electrical & cooling detailed design', '2027-01-29', 'IN_PROGRESS'],
        ['BMS integration & commissioning support', '2027-06-18', 'PENDING'],
      ],
    },
    {
      key: 'pharma',
      bookingKey: 'pharma',
      name: 'Veridia Nashik Formulation Block',
      client: 'veridia',
      projectType: 'PHA',
      office: 'NSK',
      pm: 'sameer',
      startDate: '2026-09-21',
      endDate: '2027-04-30',
      projectValue: '6200000.00',
      budgetHours: '2800.00',
      billingType: 'HOURLY',
      members: [
        ['sameer', 'Project Manager'],
        ['sneha', 'MEP Lead'],
        ['pooja', 'MEP Design Engineer'],
      ],
      milestones: [
        ['Cleanroom zoning & URS freeze', '2026-10-30', 'IN_PROGRESS'],
        ['HVAC & utilities detailed design', '2027-01-29', 'PENDING'],
        ['Validation documentation pack', '2027-04-23', 'PENDING'],
      ],
    },
  ];

  const projects = {} as CommercialIds['projects'];
  for (const spec of projectSpecs) {
    const project = await prisma.project.upsert({
      where: { companyId_projectCode: { companyId, projectCode: projectCodes[spec.bookingKey] } },
      update: {},
      create: {
        companyId,
        projectCode: projectCodes[spec.bookingKey],
        name: spec.name,
        bookingId: bookings[spec.bookingKey],
        clientId: clients[spec.client],
        projectTypeId: org.projectTypes[spec.projectType],
        officeId: org.offices[spec.office],
        projectManagerId: people.employees[spec.pm],
        status: 'ACTIVE',
        health: 'HEALTHY',
        startDate: d(spec.startDate),
        endDate: d(spec.endDate),
        projectValue: spec.projectValue,
        budgetHours: spec.budgetHours,
        billingType: spec.billingType,
        description: spec.name,
      },
    });
    projects[spec.key] = project.id;

    for (const [memberKey, roleOnProject] of spec.members) {
      await prisma.projectMember.upsert({
        where: {
          projectId_employeeId: {
            projectId: project.id,
            employeeId: people.employees[memberKey],
          },
        },
        update: {},
        create: {
          companyId,
          projectId: project.id,
          employeeId: people.employees[memberKey],
          roleOnProject,
          joinedOn: d(spec.startDate),
        },
      });
    }

    let order = 0;
    for (const [name, dueDate, status] of spec.milestones) {
      const existing = await prisma.milestone.findFirst({
        where: { projectId: project.id, name },
      });
      if (!existing) {
        await prisma.milestone.create({
          data: {
            companyId,
            projectId: project.id,
            name,
            dueDate: d(dueDate),
            status,
            sortOrder: order,
            completedOn: status === 'COMPLETED' ? d(dueDate) : null,
          },
        });
      }
      order += 1;
    }
  }
  log(`${projectSpecs.length} active projects with members and 3 milestones each`);
  log(`codes: ${Object.values(projectCodes).join(', ')}`);

  // --- Tasks ---------------------------------------------------------------
  interface TaskSpec {
    key: string;
    project: keyof CommercialIds['projects'];
    title: string;
    assignee: EmployeeKey;
    status: 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    estimatedHours: string;
    dueDate: string;
  }

  const taskSpecs: TaskSpec[] = [
    {
      key: 'hos-struct',
      project: 'hospital',
      title: 'Structural model — Blocks A & B',
      assignee: 'amit',
      status: 'DONE',
      priority: 'HIGH',
      estimatedHours: '120.00',
      dueDate: '2026-09-25',
    },
    {
      key: 'hos-hvac',
      project: 'hospital',
      title: 'HVAC ducting layout — OT complex',
      assignee: 'pooja',
      status: 'IN_PROGRESS',
      priority: 'URGENT',
      estimatedHours: '160.00',
      dueDate: '2026-10-16',
    },
    {
      key: 'hos-clash',
      project: 'hospital',
      title: 'Clash detection round 2 (Navisworks)',
      assignee: 'vikram',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      estimatedHours: '80.00',
      dueDate: '2026-10-23',
    },
    {
      key: 'hos-elec',
      project: 'hospital',
      title: 'Electrical single line diagram — LV panels',
      assignee: 'amit',
      status: 'REVIEW',
      priority: 'MEDIUM',
      estimatedHours: '64.00',
      dueDate: '2026-10-09',
    },
    {
      key: 'hos-shop',
      project: 'hospital',
      title: 'Shop drawings — ICU services',
      assignee: 'amit',
      status: 'TODO',
      priority: 'MEDIUM',
      estimatedHours: '140.00',
      dueDate: '2026-11-20',
    },
    {
      key: 'dc-chw',
      project: 'datacentre',
      title: 'Chilled water hydraulic model',
      assignee: 'sneha',
      status: 'IN_PROGRESS',
      priority: 'URGENT',
      estimatedHours: '200.00',
      dueDate: '2026-10-30',
    },
    {
      key: 'dc-bus',
      project: 'datacentre',
      title: 'Busway routing — Hall 2',
      assignee: 'faisal',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      estimatedHours: '150.00',
      dueDate: '2026-11-13',
    },
    {
      key: 'dc-fire',
      project: 'datacentre',
      title: 'Fire suppression zoning',
      assignee: 'faisal',
      status: 'TODO',
      priority: 'MEDIUM',
      estimatedHours: '90.00',
      dueDate: '2026-11-27',
    },
    {
      key: 'dc-coord',
      project: 'datacentre',
      title: 'Containment coordination with client FM',
      assignee: 'amit',
      status: 'REVIEW',
      priority: 'MEDIUM',
      estimatedHours: '70.00',
      dueDate: '2026-10-12',
    },
    {
      key: 'dc-bod',
      project: 'datacentre',
      title: 'Basis of design document',
      assignee: 'sneha',
      status: 'DONE',
      priority: 'HIGH',
      estimatedHours: '110.00',
      dueDate: '2026-09-29',
    },
    {
      key: 'pha-urs',
      project: 'pharma',
      title: 'URS review with Veridia QA',
      assignee: 'sneha',
      status: 'IN_PROGRESS',
      priority: 'URGENT',
      estimatedHours: '60.00',
      dueDate: '2026-10-14',
    },
    {
      key: 'pha-zone',
      project: 'pharma',
      title: 'Cleanroom pressure cascade schedule',
      assignee: 'pooja',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      estimatedHours: '95.00',
      dueDate: '2026-10-21',
    },
    {
      key: 'pha-ahu',
      project: 'pharma',
      title: 'AHU selection & psychrometrics',
      assignee: 'pooja',
      status: 'TODO',
      priority: 'MEDIUM',
      estimatedHours: '120.00',
      dueDate: '2026-11-18',
    },
    {
      key: 'pha-util',
      project: 'pharma',
      title: 'Purified water loop layout',
      assignee: 'sneha',
      status: 'TODO',
      priority: 'LOW',
      estimatedHours: '85.00',
      dueDate: '2026-12-04',
    },
  ];

  const tasks: Record<string, string> = {};
  const orderByProject: Record<string, number> = {};
  for (const spec of taskSpecs) {
    const existing = await prisma.task.findFirst({
      where: { projectId: projects[spec.project], title: spec.title },
    });
    orderByProject[spec.project] = (orderByProject[spec.project] ?? 0) + 1;
    const row =
      existing ??
      (await prisma.task.create({
        data: {
          companyId,
          projectId: projects[spec.project],
          title: spec.title,
          assigneeId: people.employees[spec.assignee],
          status: spec.status,
          priority: spec.priority,
          estimatedHours: spec.estimatedHours,
          dueDate: d(spec.dueDate),
          sortOrder: orderByProject[spec.project],
          completedAt: spec.status === 'DONE' ? new Date(`${spec.dueDate}T12:00:00.000Z`) : null,
        },
      }));
    tasks[spec.key] = row.id;
  }

  const commentCount = await prisma.taskComment.count({ where: { companyId } });
  if (commentCount === 0) {
    await prisma.taskComment.createMany({
      data: [
        {
          companyId,
          taskId: tasks['hos-hvac'],
          employeeId: people.employees.vikram,
          body: 'OT complex ceiling void is tighter than the architect’s model shows. Hold the duct run at 450mm until the RFI comes back.',
        },
        {
          companyId,
          taskId: tasks['hos-hvac'],
          employeeId: people.employees.pooja,
          body: 'Noted. Re-routing the secondary branch above the corridor instead. Will re-issue the layout on Thursday.',
        },
        {
          companyId,
          taskId: tasks['dc-chw'],
          employeeId: people.employees.neha,
          body: 'Client wants N+1 on the secondary pumps. Please add the standby set and re-run the hydraulics.',
        },
      ],
    });
  }
  log(`${taskSpecs.length} tasks across the Kanban columns, with comments`);

  return { clients, bookings, projects, tasks };
}
