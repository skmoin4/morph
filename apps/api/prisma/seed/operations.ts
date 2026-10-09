import { Decimal } from 'decimal.js';
import {
  computeTimesheetPostings,
  postExpenseCost,
  postTimesheetCost,
} from '../../src/modules/cost/cost-posting.logic';
import { OFFSET, d, dateRange, dayOfWeek, log, prisma, utc } from './helpers';
import type { OrgIds } from './org';
import type { CommercialIds } from './commercial';
import type { EmployeeKey, PeopleIds } from './people';

/** The completed week whose timesheets are approved and costed. */
const WEEK_START = '2026-09-28';
const WEEK_END = '2026-10-04';
/** The week in progress — a running timer and a sheet awaiting approval. */
const CURRENT_WEEK_START = '2026-10-05';
const TODAY = '2026-10-06';

const INDIA_SHIFT = { start: '09:30', end: '18:30', grace: 10 };
const RIYADH_SHIFT = { start: '08:00', end: '17:00', grace: 15 };

type Status = 'PRESENT' | 'LATE' | 'HALF_DAY' | 'ABSENT' | 'ON_LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF';

interface DayOverride {
  status?: Status;
  inTime?: string;
  outTime?: string | null;
  flagDistanceM?: number;
}

/** `${employeeKey}|${date}` -> what happened that day, where it is not routine. */
const OVERRIDES: Record<string, DayOverride> = {
  'vikram|2026-09-29': { status: 'LATE', inTime: '10:05' },
  'amit|2026-09-30': { status: 'LATE', inTime: '09:52' },
  'amit|2026-10-03': { inTime: '09:25', outTime: '20:30' },
  'anil|2026-09-29': { status: 'ABSENT' },
  'priya|2026-10-03': { status: 'HALF_DAY', inTime: '09:30', outTime: '13:00' },
  'pooja|2026-10-01': { status: 'ON_LEAVE' },
  // Site punch from outside the 120 m geofence: accepted but flagged.
  'neha|2026-09-30': { flagDistanceM: 310 },
};

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export async function seedOperations(
  org: OrgIds,
  people: PeopleIds,
  commercial: CommercialIds,
): Promise<void> {
  const { companyId } = org;

  const employeeKeys = Object.keys(people.employees) as EmployeeKey[];
  const holidays = await prisma.holiday.findMany({ where: { companyId } });

  // ---------------------------------------------------------------------
  // Leave: one approved day inside the week, one request still pending.
  // ---------------------------------------------------------------------
  const existingLeave = await prisma.leaveRequest.count({ where: { companyId } });
  if (existingLeave === 0) {
    await prisma.leaveRequest.create({
      data: {
        companyId,
        employeeId: people.employees.pooja,
        leaveTypeId: org.leaveTypes.CL,
        fromDate: d('2026-10-01'),
        toDate: d('2026-10-01'),
        dayPart: 'FULL_DAY',
        totalDays: '1.00',
        reason: 'Family function at Nashik.',
        status: 'APPROVED',
        level1ApproverId: people.employees.sneha,
        level1DecidedAt: new Date('2026-09-26T07:30:00.000Z'),
        level1Note: 'Approved. Please hand over the pressure cascade sheet to Sneha.',
        decidedAt: new Date('2026-09-26T07:30:00.000Z'),
        attendanceApplied: true,
      },
    });
    await prisma.leaveBalance.update({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: people.employees.pooja,
          leaveTypeId: org.leaveTypes.CL,
          year: 2026,
        },
      },
      data: { used: '1.00' },
    });

    await prisma.leaveRequest.create({
      data: {
        companyId,
        employeeId: people.employees.amit,
        leaveTypeId: org.leaveTypes.EL,
        fromDate: d('2026-10-19'),
        toDate: d('2026-10-21'),
        dayPart: 'FULL_DAY',
        totalDays: '3.00',
        reason: 'Diwali travel to Pune.',
        status: 'PENDING',
      },
    });
    await prisma.leaveBalance.update({
      where: {
        employeeId_leaveTypeId_year: {
          employeeId: people.employees.amit,
          leaveTypeId: org.leaveTypes.EL,
          year: 2026,
        },
      },
      data: { pending: '3.00' },
    });
    log('2 leave requests (Pooja approved 01 Oct, Amit pending for Diwali)');
  }

  // ---------------------------------------------------------------------
  // Attendance + punches for the completed week and the days up to today.
  // ---------------------------------------------------------------------
  const attendanceDates = dateRange(WEEK_START, TODAY);
  const existingAttendance = await prisma.attendanceRecord.count({ where: { companyId } });

  if (existingAttendance === 0) {
    let records = 0;
    let punchRows = 0;

    for (const key of employeeKeys) {
      const employeeId = people.employees[key];
      const officeKey = people.offices[key];
      const officeId = org.offices[officeKey];
      const isRiyadh = officeKey === 'RUH';
      const shift = isRiyadh ? RIYADH_SHIFT : INDIA_SHIFT;
      const shiftId = isRiyadh ? org.shifts.GENERAL_SA : org.shifts.GENERAL_IN;
      const offset = isRiyadh ? OFFSET.RIYADH : OFFSET.KOLKATA;
      const weeklyOff = isRiyadh ? [5, 6] : [0];

      const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });

      for (const date of attendanceDates) {
        const override = OVERRIDES[`${key}|${date}`] ?? {};
        const holiday = holidays.find(
          (h) =>
            h.date.toISOString().slice(0, 10) === date &&
            (h.officeId === null || h.officeId === officeId),
        );

        let status: Status;
        if (weeklyOff.includes(dayOfWeek(date))) status = 'WEEKLY_OFF';
        else if (holiday) status = 'HOLIDAY';
        else status = override.status ?? 'PRESENT';

        const worksToday = status === 'PRESENT' || status === 'LATE' || status === 'HALF_DAY';
        const isToday = date === TODAY;

        const inTime = override.inTime ?? (isRiyadh ? '07:55' : '09:28');
        // Nobody has clocked out yet on the current day.
        const outTime = isToday
          ? null
          : override.outTime !== undefined
            ? override.outTime
            : isRiyadh
              ? '17:05'
              : '18:35';

        const firstInAt = worksToday ? utc(date, inTime, offset) : null;
        const lastOutAt = worksToday && outTime ? utc(date, outTime, offset) : null;

        const grossMinutes = worksToday && outTime ? minutes(outTime) - minutes(inTime) : 0;
        // The break is only deducted from a full day's stint.
        const breakMinutes = grossMinutes > 300 ? 60 : 0;
        const workedMinutes = Math.max(0, grossMinutes - breakMinutes);

        const lateMinutes = worksToday
          ? Math.max(0, minutes(inTime) - (minutes(shift.start) + shift.grace))
          : 0;
        const earlyExitMinutes =
          worksToday && outTime && status !== 'HALF_DAY'
            ? Math.max(0, minutes(shift.end) - 15 - minutes(outTime))
            : 0;
        const overtimeMinutes = Math.max(0, workedMinutes - 9 * 60);

        const dayValue =
          status === 'PRESENT' || status === 'LATE' || status === 'ON_LEAVE'
            ? '1.00'
            : status === 'HALF_DAY'
              ? '0.50'
              : '0.00';

        const record = await prisma.attendanceRecord.create({
          data: {
            companyId,
            employeeId,
            officeId,
            shiftId,
            attendanceDate: d(date),
            status,
            firstInAt,
            lastOutAt,
            workedMinutes,
            breakMinutes,
            lateMinutes,
            earlyExitMinutes,
            overtimeMinutes,
            isLate: lateMinutes > 0,
            isEarlyExit: earlyExitMinutes > 0,
            isFlagged: override.flagDistanceM !== undefined,
            flagReason:
              override.flagDistanceM !== undefined
                ? `Clock-in ${override.flagDistanceM} m from the site pin (limit 120 m)`
                : null,
            dayValue,
            computedAt: new Date(),
          },
        });
        records += 1;

        if (!worksToday) continue;

        // Mobile-first employees punch with GPS and a selfie; office-only staff
        // punch from an allowed IP. The evidence is what gets stored.
        const useGps =
          employee.attendanceMethod === 'MOBILE' ||
          (employee.attendanceMethod === 'BOTH' && officeKey === 'MUM') ||
          officeKey === 'MUM';
        const office = await prisma.office.findUniqueOrThrow({ where: { id: officeId } });

        const gpsPayload = (distanceM: number) => ({
          latitude: office.latitude,
          longitude: office.longitude,
          accuracyM: 12,
          distanceM,
          withinGeofence: distanceM <= office.geofenceRadiusM,
        });

        const distance = override.flagDistanceM ?? 18;

        await prisma.punch.create({
          data: {
            companyId,
            employeeId,
            attendanceRecordId: record.id,
            officeId,
            type: 'IN',
            source: useGps ? 'MOBILE_GPS' : 'OFFICE_IP',
            punchedAt: firstInAt!,
            attendanceDate: d(date),
            ...(useGps
              ? gpsPayload(distance)
              : {
                  ipAddress: officeKey === 'RUH' ? '212.118.10.42' : '103.21.58.17',
                  ipAllowed: true,
                }),
            deviceInfo: useGps ? 'Android 15 / Chrome 131' : 'Windows 11 / Edge 131',
            isFlagged: distance > office.geofenceRadiusM,
            flagReason:
              distance > office.geofenceRadiusM
                ? `${distance} m from the site pin (limit ${office.geofenceRadiusM} m)`
                : null,
          },
        });
        punchRows += 1;

        if (lastOutAt) {
          await prisma.punch.create({
            data: {
              companyId,
              employeeId,
              attendanceRecordId: record.id,
              officeId,
              type: 'OUT',
              source: useGps ? 'MOBILE_GPS' : 'OFFICE_IP',
              punchedAt: lastOutAt,
              attendanceDate: d(date),
              ...(useGps
                ? gpsPayload(22)
                : {
                    ipAddress: officeKey === 'RUH' ? '212.118.10.42' : '103.21.58.17',
                    ipAllowed: true,
                  }),
              deviceInfo: useGps ? 'Android 15 / Chrome 131' : 'Windows 11 / Edge 131',
            },
          });
          punchRows += 1;
        }
      }
    }
    log(`${records} attendance days and ${punchRows} punches (28 Sep - 06 Oct)`);
    log('02 Oct is a holiday in India, Riyadh is off Fri-Sat and works Sunday');

    // A late mark the employee wants corrected.
    await prisma.regularisationRequest.create({
      data: {
        companyId,
        employeeId: people.employees.vikram,
        attendanceDate: d('2026-09-29'),
        requestedInTime: '09:25',
        reason:
          'Was on site at Aarogya from 09:25 for the client walkthrough; punched only after reaching the office.',
        status: 'PENDING',
      },
    });
    log('1 pending regularisation request (Vikram, 29 Sep late mark)');
  }

  // ---------------------------------------------------------------------
  // Time entries, timesheets, approvals and the cost postings.
  // ---------------------------------------------------------------------
  interface Entry {
    employee: EmployeeKey;
    project: keyof CommercialIds['projects'];
    task: string;
    date: string;
    hours: string;
    billable?: boolean;
    note: string;
  }

  const weekEntries: Entry[] = [
    // Vikram — hospital clash detection, a full week.
    {
      employee: 'vikram',
      project: 'hospital',
      task: 'hos-clash',
      date: '2026-09-28',
      hours: '8.00',
      note: 'Clash round 2 — Blocks A/B services',
    },
    {
      employee: 'vikram',
      project: 'hospital',
      task: 'hos-clash',
      date: '2026-09-29',
      hours: '8.00',
      note: 'Clash resolution with structural',
    },
    {
      employee: 'vikram',
      project: 'hospital',
      task: 'hos-clash',
      date: '2026-09-30',
      hours: '8.00',
      note: 'Navisworks clash report issue',
    },
    {
      employee: 'vikram',
      project: 'hospital',
      task: 'hos-clash',
      date: '2026-10-01',
      hours: '8.00',
      note: 'Coordination meeting + rework list',
    },
    {
      employee: 'vikram',
      project: 'hospital',
      task: 'hos-clash',
      date: '2026-10-03',
      hours: '8.00',
      note: 'Clash close-out tracking',
    },

    // Amit — straddles his 01 Oct rate rise and two projects.
    {
      employee: 'amit',
      project: 'hospital',
      task: 'hos-struct',
      date: '2026-09-28',
      hours: '8.00',
      note: 'Block B structural model',
    },
    {
      employee: 'amit',
      project: 'hospital',
      task: 'hos-struct',
      date: '2026-09-29',
      hours: '8.00',
      note: 'Block B families and schedules',
    },
    {
      employee: 'amit',
      project: 'hospital',
      task: 'hos-elec',
      date: '2026-09-30',
      hours: '8.00',
      note: 'LV panel SLD markup',
    },
    {
      employee: 'amit',
      project: 'hospital',
      task: 'hos-elec',
      date: '2026-10-01',
      hours: '4.00',
      note: 'SLD review comments',
    },
    {
      employee: 'amit',
      project: 'datacentre',
      task: 'dc-coord',
      date: '2026-10-01',
      hours: '4.00',
      note: 'Containment coordination call',
    },
    {
      employee: 'amit',
      project: 'datacentre',
      task: 'dc-coord',
      date: '2026-10-03',
      hours: '8.00',
      note: 'Containment model updates',
    },

    // Sneha — data centre then pharma.
    {
      employee: 'sneha',
      project: 'datacentre',
      task: 'dc-chw',
      date: '2026-09-28',
      hours: '8.00',
      note: 'CHW hydraulic model build',
    },
    {
      employee: 'sneha',
      project: 'datacentre',
      task: 'dc-chw',
      date: '2026-09-29',
      hours: '8.00',
      note: 'Pump curve selection',
    },
    {
      employee: 'sneha',
      project: 'datacentre',
      task: 'dc-bod',
      date: '2026-09-30',
      hours: '8.00',
      note: 'BOD sign-off pack',
    },
    {
      employee: 'sneha',
      project: 'pharma',
      task: 'pha-urs',
      date: '2026-10-01',
      hours: '8.00',
      note: 'URS review with Veridia QA',
    },
    {
      employee: 'sneha',
      project: 'pharma',
      task: 'pha-urs',
      date: '2026-10-03',
      hours: '8.00',
      note: 'URS gap list',
    },

    // Pooja — on leave 01 Oct.
    {
      employee: 'pooja',
      project: 'hospital',
      task: 'hos-hvac',
      date: '2026-09-28',
      hours: '8.00',
      note: 'OT complex duct layout',
    },
    {
      employee: 'pooja',
      project: 'pharma',
      task: 'pha-zone',
      date: '2026-09-29',
      hours: '8.00',
      note: 'Pressure cascade schedule',
    },
    {
      employee: 'pooja',
      project: 'pharma',
      task: 'pha-zone',
      date: '2026-09-30',
      hours: '8.00',
      note: 'Cascade review with Sneha',
    },
    {
      employee: 'pooja',
      project: 'pharma',
      task: 'pha-zone',
      date: '2026-10-03',
      hours: '8.00',
      note: 'Room data sheet updates',
    },

    // Faisal — Riyadh, so Sunday is a working day and Friday is not.
    {
      employee: 'faisal',
      project: 'datacentre',
      task: 'dc-bus',
      date: '2026-09-28',
      hours: '8.00',
      note: 'Busway routing Hall 2',
    },
    {
      employee: 'faisal',
      project: 'datacentre',
      task: 'dc-bus',
      date: '2026-09-29',
      hours: '8.00',
      note: 'Busway supports detailing',
    },
    {
      employee: 'faisal',
      project: 'datacentre',
      task: 'dc-bus',
      date: '2026-09-30',
      hours: '8.00',
      note: 'Tap-off box coordination',
    },
    {
      employee: 'faisal',
      project: 'datacentre',
      task: 'dc-bus',
      date: '2026-10-01',
      hours: '8.00',
      note: 'Busway clash fixes',
    },
    {
      employee: 'faisal',
      project: 'datacentre',
      task: 'dc-fire',
      date: '2026-10-04',
      hours: '8.00',
      note: 'Fire suppression zoning draft',
    },

    // The two PMs bill time as well.
    {
      employee: 'sameer',
      project: 'hospital',
      task: 'hos-clash',
      date: '2026-09-28',
      hours: '3.00',
      note: 'Client coordination',
    },
    {
      employee: 'sameer',
      project: 'hospital',
      task: 'hos-clash',
      date: '2026-09-29',
      hours: '3.00',
      note: 'Progress review',
    },
    {
      employee: 'sameer',
      project: 'hospital',
      task: 'hos-shop',
      date: '2026-09-30',
      hours: '2.00',
      note: 'Shop drawing planning',
    },
    {
      employee: 'sameer',
      project: 'pharma',
      task: 'pha-urs',
      date: '2026-10-01',
      hours: '3.00',
      note: 'Veridia call',
    },
    {
      employee: 'sameer',
      project: 'pharma',
      task: 'pha-urs',
      date: '2026-10-03',
      hours: '3.00',
      note: 'Scope clarification note',
    },
    {
      employee: 'neha',
      project: 'datacentre',
      task: 'dc-chw',
      date: '2026-09-28',
      hours: '4.00',
      note: 'Client FM walkthrough',
    },
    {
      employee: 'neha',
      project: 'datacentre',
      task: 'dc-chw',
      date: '2026-09-29',
      hours: '4.00',
      note: 'N+1 pump decision',
    },
    {
      employee: 'neha',
      project: 'datacentre',
      task: 'dc-bod',
      date: '2026-09-30',
      hours: '4.00',
      note: 'BOD client review',
    },
    {
      employee: 'neha',
      project: 'datacentre',
      task: 'dc-coord',
      date: '2026-10-01',
      hours: '4.00',
      note: 'Containment workshop',
    },
    {
      employee: 'neha',
      project: 'datacentre',
      task: 'dc-coord',
      date: '2026-10-03',
      hours: '4.00',
      note: 'Action tracker update',
    },
  ];

  const existingEntries = await prisma.timeEntry.count({ where: { companyId } });
  if (existingEntries > 0) {
    log('time entries already seeded — skipping');
    return;
  }

  // Approvers: a Team Lead for engineers, the Director for the two PMs.
  const approverFor: Record<string, EmployeeKey> = {
    vikram: 'sameer',
    amit: 'vikram',
    sneha: 'neha',
    pooja: 'sneha',
    faisal: 'vikram',
    sameer: 'rajesh',
    neha: 'rajesh',
  };

  const byEmployee = new Map<EmployeeKey, Entry[]>();
  for (const entry of weekEntries) {
    const list = byEmployee.get(entry.employee) ?? [];
    list.push(entry);
    byEmployee.set(entry.employee, list);
  }

  let postedRows = 0;
  for (const [employeeKey, entries] of byEmployee) {
    const employeeId = people.employees[employeeKey];
    const totalHours = entries
      .reduce((acc, e) => acc.plus(new Decimal(e.hours)), new Decimal(0))
      .toFixed(2);

    const timesheet = await prisma.timesheet.create({
      data: {
        companyId,
        employeeId,
        weekStartDate: d(WEEK_START),
        weekEndDate: d(WEEK_END),
        status: 'APPROVED',
        totalHours,
        billableHours: totalHours,
        submittedAt: new Date('2026-10-04T13:00:00.000Z'),
        approvedAt: new Date('2026-10-05T04:30:00.000Z'),
        approvedById: people.users[approverFor[employeeKey]],
        costPostedAt: new Date('2026-10-05T04:30:00.000Z'),
      },
    });

    for (const entry of entries) {
      await prisma.timeEntry.create({
        data: {
          companyId,
          employeeId,
          projectId: commercial.projects[entry.project],
          taskId: commercial.tasks[entry.task],
          timesheetId: timesheet.id,
          workDate: d(entry.date),
          hours: entry.hours,
          isBillable: entry.billable ?? true,
          source: 'MANUAL',
          description: entry.note,
          // Approving the week locks every entry in it.
          isLocked: true,
        },
      });
    }

    await prisma.timesheetApproval.create({
      data: {
        companyId,
        timesheetId: timesheet.id,
        approverId: people.users[approverFor[employeeKey]],
        status: 'APPROVED',
        comment: 'Hours match the coordination log. Approved.',
        decidedAt: new Date('2026-10-05T04:30:00.000Z'),
      },
    });

    // Post the cost exactly as the real approval flow will.
    const rates = await prisma.employeeCostRate.findMany({
      where: { employeeId },
      select: { hourlyRate: true, effectiveFrom: true },
    });
    const postings = computeTimesheetPostings(
      entries.map((e) => ({
        projectId: commercial.projects[e.project],
        workDate: d(e.date),
        hours: e.hours,
      })),
      rates,
    );
    const result = await postTimesheetCost(prisma, {
      companyId,
      timesheetId: timesheet.id,
      employeeId,
      postingDate: d(WEEK_END),
      postings,
      createdById: people.users[approverFor[employeeKey]],
      description: `Approved timesheet ${WEEK_START} to ${WEEK_END}`,
    });
    postedRows += result.rows;
  }
  log(`${byEmployee.size} approved timesheets for ${WEEK_START} - ${WEEK_END}`);
  log(`${postedRows} labour cost postings (Amit's hospital row spans his rate rise)`);

  // --- Current week: a submitted sheet and a live timer -------------------
  const currentWeekEnd = '2026-10-11';

  const poojaCurrent = await prisma.timesheet.create({
    data: {
      companyId,
      employeeId: people.employees.pooja,
      weekStartDate: d(CURRENT_WEEK_START),
      weekEndDate: d(currentWeekEnd),
      status: 'SUBMITTED',
      totalHours: '16.00',
      billableHours: '16.00',
      submittedAt: new Date('2026-10-06T05:15:00.000Z'),
    },
  });
  for (const date of [CURRENT_WEEK_START, TODAY]) {
    await prisma.timeEntry.create({
      data: {
        companyId,
        employeeId: people.employees.pooja,
        projectId: commercial.projects.pharma,
        taskId: commercial.tasks['pha-zone'],
        timesheetId: poojaCurrent.id,
        workDate: d(date),
        hours: '8.00',
        source: 'MANUAL',
        description: 'Room data sheets — Zone 2',
      },
    });
  }

  const amitCurrent = await prisma.timesheet.create({
    data: {
      companyId,
      employeeId: people.employees.amit,
      weekStartDate: d(CURRENT_WEEK_START),
      weekEndDate: d(currentWeekEnd),
      status: 'DRAFT',
      totalHours: '8.00',
      billableHours: '8.00',
    },
  });
  await prisma.timeEntry.create({
    data: {
      companyId,
      employeeId: people.employees.amit,
      projectId: commercial.projects.hospital,
      taskId: commercial.tasks['hos-elec'],
      timesheetId: amitCurrent.id,
      workDate: d(CURRENT_WEEK_START),
      hours: '8.00',
      source: 'MANUAL',
      description: 'SLD revisions after review',
    },
  });

  // A live timer: source TIMER with no endedAt, so the generated runningKey is
  // set and the unique index now holds Amit's slot.
  await prisma.timeEntry.create({
    data: {
      companyId,
      employeeId: people.employees.amit,
      projectId: commercial.projects.hospital,
      taskId: commercial.tasks['hos-elec'],
      timesheetId: amitCurrent.id,
      workDate: d(TODAY),
      startedAt: utc(TODAY, '09:40', OFFSET.KOLKATA),
      hours: '0.00',
      source: 'TIMER',
      description: 'Panel schedule updates',
    },
  });
  log('current week: Pooja submitted (awaiting approval), Amit draft with a live timer');

  // ---------------------------------------------------------------------
  // Expenses across every stage of the two-step approval.
  // ---------------------------------------------------------------------
  interface ExpenseSpec {
    employee: EmployeeKey;
    project: keyof CommercialIds['projects'];
    category: string;
    date: string;
    amount: string;
    billable: boolean;
    description: string;
    status: 'DRAFT' | 'PENDING_MANAGER' | 'PENDING_FINANCE' | 'APPROVED' | 'REJECTED';
    reimbursed?: boolean;
    exceededLimit?: boolean;
    managerNote?: string;
    financeNote?: string;
  }

  const expenseSpecs: ExpenseSpec[] = [
    {
      employee: 'neha',
      project: 'datacentre',
      category: 'Travel',
      date: '2026-09-29',
      amount: '4850.00',
      billable: true,
      description: 'Cab to Northbridge site, three visits.',
      status: 'APPROVED',
      reimbursed: true,
      managerNote: 'Approved.',
      financeNote: 'Receipts verified, included in the 05 Oct payout.',
    },
    {
      employee: 'faisal',
      project: 'datacentre',
      category: 'Accommodation',
      date: '2026-09-30',
      amount: '9200.00',
      billable: true,
      description: 'Two nights in Mumbai for the coordination workshop.',
      status: 'APPROVED',
      managerNote: 'Approved — workshop was client-requested.',
      financeNote: 'Approved. Reimbursement scheduled.',
    },
    {
      employee: 'amit',
      project: 'hospital',
      category: 'Site Materials',
      date: '2026-10-01',
      amount: '27500.00',
      billable: true,
      description: 'Laser scanner rental for the as-built survey of Block C.',
      status: 'PENDING_FINANCE',
      exceededLimit: true,
      managerNote:
        'Over the 25,000 category limit but the scan was unavoidable. Passing to Finance.',
    },
    {
      employee: 'pooja',
      project: 'pharma',
      category: 'Travel',
      date: '2026-10-03',
      amount: '1250.00',
      billable: false,
      description: 'Local travel to the Veridia plant for the URS walkthrough.',
      status: 'PENDING_MANAGER',
    },
    {
      employee: 'vikram',
      project: 'hospital',
      category: 'Client Meals',
      date: '2026-09-28',
      amount: '3400.00',
      billable: false,
      description: 'Lunch with the Aarogya facilities team.',
      status: 'REJECTED',
      managerNote: 'Client entertainment is not reimbursable on fixed-price work.',
    },
    {
      employee: 'sneha',
      project: 'pharma',
      category: 'Software & Tools',
      date: '2026-10-05',
      amount: '18000.00',
      billable: false,
      description: 'Annual psychrometric calculation add-in licence.',
      status: 'DRAFT',
    },
  ];

  const approvers: Record<string, EmployeeKey> = {
    neha: 'rajesh',
    faisal: 'vikram',
    amit: 'vikram',
    pooja: 'sneha',
    vikram: 'sameer',
    sneha: 'neha',
  };

  for (const spec of expenseSpecs) {
    const submitted = spec.status !== 'DRAFT';
    const expense = await prisma.expense.create({
      data: {
        companyId,
        employeeId: people.employees[spec.employee],
        projectId: commercial.projects[spec.project],
        categoryId: org.expenseCategories[spec.category],
        expenseDate: d(spec.date),
        amount: spec.amount,
        isBillable: spec.billable,
        description: spec.description,
        status: spec.status,
        reimbursementStatus: spec.reimbursed ? 'REIMBURSED' : 'PENDING',
        exceededLimit: spec.exceededLimit ?? false,
        submittedAt: submitted ? new Date(`${spec.date}T12:00:00.000Z`) : null,
        approvedAt: spec.status === 'APPROVED' ? new Date(`${spec.date}T14:00:00.000Z`) : null,
        rejectedAt: spec.status === 'REJECTED' ? new Date(`${spec.date}T14:00:00.000Z`) : null,
        reimbursedAt: spec.reimbursed ? new Date('2026-10-05T06:00:00.000Z') : null,
        costPostedAt: spec.status === 'APPROVED' ? new Date(`${spec.date}T14:00:00.000Z`) : null,
      },
    });

    // Stage 1 — Manager.
    if (submitted) {
      const managerDecided =
        spec.status === 'APPROVED' ||
        spec.status === 'PENDING_FINANCE' ||
        spec.status === 'REJECTED';
      await prisma.expenseApproval.create({
        data: {
          companyId,
          expenseId: expense.id,
          stage: 'MANAGER',
          approverId: people.users[approvers[spec.employee]],
          status: managerDecided
            ? spec.status === 'REJECTED'
              ? 'REJECTED'
              : 'APPROVED'
            : 'PENDING',
          comment: spec.managerNote ?? null,
          decidedAt: managerDecided ? new Date(`${spec.date}T13:00:00.000Z`) : null,
        },
      });
    }

    // Stage 2 — Finance.
    if (spec.status === 'APPROVED' || spec.status === 'PENDING_FINANCE') {
      await prisma.expenseApproval.create({
        data: {
          companyId,
          expenseId: expense.id,
          stage: 'FINANCE',
          approverId: people.users.anil,
          status: spec.status === 'APPROVED' ? 'APPROVED' : 'PENDING',
          comment: spec.financeNote ?? null,
          decidedAt: spec.status === 'APPROVED' ? new Date(`${spec.date}T14:00:00.000Z`) : null,
        },
      });
    }

    if (spec.status === 'APPROVED') {
      await postExpenseCost(prisma, {
        companyId,
        expenseId: expense.id,
        projectId: commercial.projects[spec.project],
        employeeId: people.employees[spec.employee],
        postingDate: d(spec.date),
        amount: spec.amount,
        description: `Approved expense — ${spec.category}`,
        createdById: people.users.anil,
      });
    }
  }
  log(`${expenseSpecs.length} expenses across draft / manager / finance / approved / rejected`);

  // ---------------------------------------------------------------------
  // Cost brought forward, so the dashboards show a real burn position.
  // ---------------------------------------------------------------------
  const broughtForward: Array<[keyof CommercialIds['projects'], string, string, string]> = [
    ['hospital', '2650.00', '5850000.00', 'Cost brought forward: Aug-Sep 2026'],
    ['datacentre', '2100.00', '9400000.00', 'Cost brought forward: Aug-Sep 2026'],
    // Pharma is hourly and burning fast — this is the project that trips the alert.
    ['pharma', '2380.00', '4650000.00', 'Cost brought forward: Sep 2026'],
  ];

  for (const [projectKey, hours, amount, description] of broughtForward) {
    const projectId = commercial.projects[projectKey];
    await prisma.costLedgerEntry.create({
      data: {
        companyId,
        projectId,
        sourceType: 'ADJUSTMENT',
        sourceId: `OPENING-${projectKey.toUpperCase()}`,
        postingVersion: 1,
        postingDate: d('2026-09-27'),
        hours,
        amount,
        description,
      },
    });
    await prisma.project.update({
      where: { id: projectId },
      data: {
        actualHours: { increment: hours },
        actualLabourCost: { increment: amount },
        actualTotalCost: { increment: amount },
      },
    });
  }
  log('3 opening cost adjustments so budget vs actual is meaningful');

  // --- Budget health and alert levels -------------------------------------
  for (const projectId of Object.values(commercial.projects)) {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const budget = new Decimal(project.budgetHours.toString());
    const actual = new Decimal(project.actualHours.toString());
    const usedPercent = budget.isZero() ? new Decimal(0) : actual.dividedBy(budget).times(100);

    const alertLevel = usedPercent.gte(100) ? 100 : usedPercent.gte(80) ? 80 : 0;
    const health = alertLevel === 100 ? 'CRITICAL' : alertLevel === 80 ? 'AT_RISK' : 'HEALTHY';

    await prisma.project.update({
      where: { id: projectId },
      data: { budgetAlertLevel: alertLevel, health },
    });

    if (alertLevel > 0) {
      const watchers = await prisma.projectMember.findMany({
        where: { projectId },
        include: { employee: { select: { userId: true } } },
      });
      const userIds = new Set(
        [...watchers.map((w) => w.employee.userId), people.users.rajesh].filter(
          (id): id is string => Boolean(id),
        ),
      );
      for (const userId of userIds) {
        await prisma.notification.create({
          data: {
            companyId,
            userId,
            type: alertLevel === 100 ? 'BUDGET_ALERT_100' : 'BUDGET_ALERT_80',
            title: `${project.projectCode} has used ${usedPercent.toFixed(0)}% of its budget hours`,
            body: `${actual.toFixed(0)} of ${budget.toFixed(0)} budgeted hours are consumed.`,
            linkUrl: `/projects/${projectId}`,
            entityType: 'Project',
            entityId: projectId,
          },
        });
      }
    }
  }
  log('project health and budget alerts recomputed from the ledger');

  // --- A few other notifications for the bell -----------------------------
  await prisma.notification.createMany({
    data: [
      {
        companyId,
        userId: people.users.sneha,
        type: 'TIMESHEET_SUBMITTED',
        title: 'Pooja Shinde submitted her timesheet',
        body: 'Week of 05 Oct 2026 — 16.00 hours awaiting your approval.',
        linkUrl: '/timesheets/approvals',
      },
      {
        companyId,
        userId: people.users.anil,
        type: 'EXPENSE_SUBMITTED',
        title: 'Expense needs Finance approval',
        body: 'Amit Chavan — ₹27,500 site materials, over the category limit.',
        linkUrl: '/expenses/approvals',
      },
      {
        companyId,
        userId: people.users.sameer,
        type: 'REGULARISATION_SUBMITTED',
        title: 'Vikram Rane requested a regularisation',
        body: '29 Sep 2026 — late mark, client walkthrough on site.',
        linkUrl: '/attendance/regularisations',
      },
      {
        companyId,
        userId: people.users.rajesh,
        type: 'BOOKING_CONFIRMED',
        title: 'Veridia booking confirmed verbally',
        body: 'MOR-26-27-PHA-0003 created. Confirmation email still pending.',
        linkUrl: '/bookings',
      },
      {
        companyId,
        userId: people.users.vikram,
        type: 'LEAVE_SUBMITTED',
        title: 'Amit Chavan applied for 3 days earned leave',
        body: '19 Oct 2026 to 21 Oct 2026 — Diwali travel.',
        linkUrl: '/leave/approvals',
      },
    ],
  });
  log('5 in-app notifications for the bell');
}
