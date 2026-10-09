import { Decimal } from 'decimal.js';
import { resetDatabase, testPrisma as prisma } from '../../../test/db';
import {
  activePostingVersion,
  computeTimesheetPostings,
  nextPostingVersion,
  netPostedAmount,
  postTimesheetCost,
  resolveRateForDate,
  reverseTimesheetCost,
} from './cost-posting.logic';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('resolveRateForDate', () => {
  const rates = [
    { hourlyRate: '650.00', effectiveFrom: d('2021-11-01') },
    { hourlyRate: '700.00', effectiveFrom: d('2026-10-01') },
  ];

  it('uses the rate effective on the work date, not the latest one', () => {
    expect(resolveRateForDate(rates, d('2026-09-30'))?.toFixed(2)).toBe('650.00');
    expect(resolveRateForDate(rates, d('2026-10-01'))?.toFixed(2)).toBe('700.00');
    expect(resolveRateForDate(rates, d('2026-10-04'))?.toFixed(2)).toBe('700.00');
  });

  it('is inclusive of the effectiveFrom date', () => {
    expect(resolveRateForDate(rates, d('2021-11-01'))?.toFixed(2)).toBe('650.00');
  });

  it('returns null before any rate exists, rather than falling back to zero', () => {
    expect(resolveRateForDate(rates, d('2021-10-31'))).toBeNull();
  });

  it('ignores row order', () => {
    expect(resolveRateForDate([...rates].reverse(), d('2026-09-30'))?.toFixed(2)).toBe('650.00');
  });
});

describe('computeTimesheetPostings', () => {
  const rates = [
    { hourlyRate: '650.00', effectiveFrom: d('2021-11-01') },
    { hourlyRate: '700.00', effectiveFrom: d('2026-10-01') },
  ];

  it('splits a week across projects and costs each day at that day rate', () => {
    const postings = computeTimesheetPostings(
      [
        { projectId: 'P-HOS', workDate: d('2026-09-28'), hours: '8.00' },
        { projectId: 'P-HOS', workDate: d('2026-09-29'), hours: '8.00' },
        { projectId: 'P-HOS', workDate: d('2026-09-30'), hours: '8.00' },
        { projectId: 'P-HOS', workDate: d('2026-10-01'), hours: '4.00' },
        { projectId: 'P-DC', workDate: d('2026-10-01'), hours: '4.00' },
        { projectId: 'P-DC', workDate: d('2026-10-03'), hours: '8.00' },
      ],
      rates,
    );

    const hospital = postings.find((p) => p.projectId === 'P-HOS')!;
    const datacentre = postings.find((p) => p.projectId === 'P-DC')!;

    // 24h at 650 + 4h at 700
    expect(hospital.hours).toBe('28.00');
    expect(hospital.amount).toBe('18400.00');
    // Two rates in one group, so no single rate can be recorded…
    expect(hospital.rateApplied).toBeNull();
    // …but the working is on the row, so the number is never unexplained.
    expect(hospital.rateBreakdown).toEqual([
      {
        from: '2026-09-28',
        to: '2026-09-30',
        hours: '24.00',
        rate: '650.00',
        amount: '15600.00',
      },
      {
        from: '2026-10-01',
        to: '2026-10-01',
        hours: '4.00',
        rate: '700.00',
        amount: '2800.00',
      },
    ]);

    expect(datacentre.hours).toBe('12.00');
    expect(datacentre.amount).toBe('8400.00');
    expect(datacentre.rateApplied).toBe('700.00');
    // Both days are at 700, so they merge into one segment despite the gap.
    expect(datacentre.rateBreakdown).toEqual([
      {
        from: '2026-10-01',
        to: '2026-10-03',
        hours: '12.00',
        rate: '700.00',
        amount: '8400.00',
      },
    ]);
  });

  it('segments always reconcile to the posting total', () => {
    const postings = computeTimesheetPostings(
      [
        { projectId: 'P-HOS', workDate: d('2026-09-29'), hours: '7.50' },
        { projectId: 'P-HOS', workDate: d('2026-09-30'), hours: '6.25' },
        { projectId: 'P-HOS', workDate: d('2026-10-02'), hours: '3.75' },
      ],
      rates,
    );

    for (const posting of postings) {
      const hours = posting.rateBreakdown.reduce(
        (acc, s) => acc.plus(new Decimal(s.hours)),
        new Decimal(0),
      );
      const amount = posting.rateBreakdown.reduce(
        (acc, s) => acc.plus(new Decimal(s.amount)),
        new Decimal(0),
      );
      expect(hours.toFixed(2)).toBe(posting.hours);
      expect(amount.toFixed(2)).toBe(posting.amount);
      // Each segment is self-consistent too.
      for (const s of posting.rateBreakdown) {
        expect(new Decimal(s.hours).times(s.rate).toFixed(2)).toBe(s.amount);
      }
    }
  });

  it('records the rate, and a single segment, when one rate covered everything', () => {
    const [posting] = computeTimesheetPostings(
      [{ projectId: 'P-HOS', workDate: d('2026-09-28'), hours: '7.50' }],
      rates,
    );
    expect(posting.rateApplied).toBe('650.00');
    expect(posting.amount).toBe('4875.00');
    // Populated for the single-rate case too, so the UI never has a blank.
    expect(posting.rateBreakdown).toEqual([
      {
        from: '2026-09-28',
        to: '2026-09-28',
        hours: '7.50',
        rate: '650.00',
        amount: '4875.00',
      },
    ]);
  });

  it('merges several entries on the same day into one day at one rate', () => {
    const [posting] = computeTimesheetPostings(
      [
        { projectId: 'P-HOS', workDate: d('2026-10-01'), hours: '4.00' },
        { projectId: 'P-HOS', workDate: d('2026-10-01'), hours: '3.00' },
      ],
      rates,
    );
    expect(posting.rateBreakdown).toHaveLength(1);
    expect(posting.rateBreakdown[0].hours).toBe('7.00');
    expect(posting.amount).toBe('4900.00');
  });

  it('starts a new segment each time the rate changes, in date order', () => {
    // Three rates, so a week can cross two boundaries.
    const threeRates = [
      { hourlyRate: '600.00', effectiveFrom: d('2021-11-01') },
      { hourlyRate: '650.00', effectiveFrom: d('2026-09-29') },
      { hourlyRate: '700.00', effectiveFrom: d('2026-10-01') },
    ];
    const [posting] = computeTimesheetPostings(
      [
        // Deliberately out of order: the segments must still come out sorted.
        { projectId: 'P-HOS', workDate: d('2026-10-01'), hours: '8.00' },
        { projectId: 'P-HOS', workDate: d('2026-09-28'), hours: '8.00' },
        { projectId: 'P-HOS', workDate: d('2026-09-29'), hours: '8.00' },
      ],
      threeRates,
    );

    expect(posting.rateBreakdown.map((s) => [s.from, s.rate])).toEqual([
      ['2026-09-28', '600.00'],
      ['2026-09-29', '650.00'],
      ['2026-10-01', '700.00'],
    ]);
    expect(posting.amount).toBe('15600.00');
    expect(posting.rateApplied).toBeNull();
  });

  it('refuses to cost a day with no effective rate', () => {
    expect(() =>
      computeTimesheetPostings(
        [{ projectId: 'P-HOS', workDate: d('2020-01-01'), hours: '8.00' }],
        rates,
      ),
    ).toThrow(/No cost rate effective on 2020-01-01/);
  });

  it('skips zero-hour rows', () => {
    expect(
      computeTimesheetPostings(
        [{ projectId: 'P-HOS', workDate: d('2026-09-28'), hours: '0.00' }],
        rates,
      ),
    ).toEqual([]);
  });
});

describe('cost ledger posting versions', () => {
  let companyId: string;
  let projectId: string;
  let secondProjectId: string;
  let employeeId: string;
  let timesheetId: string;

  beforeAll(async () => {
    await resetDatabase();

    const company = await prisma.company.create({
      data: { name: 'Ledger Test Co', codePrefix: 'LTC', fyStartMonth: 4 },
    });
    companyId = company.id;

    const office = await prisma.office.create({
      data: { companyId, name: 'Test Office', shortCode: 'TST' },
    });
    const projectType = await prisma.projectType.create({
      data: { companyId, name: 'Hospital', shortCode: 'HOS' },
    });
    const client = await prisma.client.create({ data: { companyId, name: 'Test Client' } });
    const role = await prisma.role.create({ data: { companyId, name: 'Tester' } });
    const user = await prisma.user.create({
      data: {
        companyId,
        email: 'ledger.test@example.com',
        fullName: 'Ledger Tester',
        roleId: role.id,
      },
    });
    const employee = await prisma.employee.create({
      data: {
        companyId,
        userId: user.id,
        employeeCode: 'LT-001',
        firstName: 'Ledger',
        lastName: 'Tester',
        joiningDate: d('2021-11-01'),
        officeId: office.id,
      },
    });
    employeeId = employee.id;

    await prisma.employeeCostRate.createMany({
      data: [
        { companyId, employeeId, hourlyRate: '650.00', effectiveFrom: d('2021-11-01') },
        { companyId, employeeId, hourlyRate: '700.00', effectiveFrom: d('2026-10-01') },
      ],
    });

    async function makeProject(code: string, name: string) {
      const booking = await prisma.booking.create({
        data: {
          companyId,
          bookingNumber: `BKG-${code}`,
          clientId: client.id,
          projectName: name,
          projectTypeId: projectType.id,
          officeId: office.id,
          bookingDate: d('2026-07-01'),
          projectValue: '1000000.00',
          budgetHours: '1000.00',
          expectedStartDate: d('2026-08-01'),
          expectedEndDate: d('2027-03-31'),
          status: 'PROJECT_CREATED',
        },
      });
      const project = await prisma.project.create({
        data: {
          companyId,
          projectCode: code,
          name,
          bookingId: booking.id,
          clientId: client.id,
          projectTypeId: projectType.id,
          officeId: office.id,
          projectValue: '1000000.00',
          budgetHours: '1000.00',
        },
      });
      return project.id;
    }

    projectId = await makeProject('LTC-26-27-HOS-0001', 'Primary');
    secondProjectId = await makeProject('LTC-26-27-HOS-0002', 'Secondary');

    const timesheet = await prisma.timesheet.create({
      data: {
        companyId,
        employeeId,
        weekStartDate: d('2026-09-28'),
        weekEndDate: d('2026-10-04'),
        status: 'APPROVED',
        totalHours: '40.00',
      },
    });
    timesheetId = timesheet.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** 40 hours on one project, all before the rate rise: 40 x 650 = 26,000. */
  const postings = [
    {
      projectId: '',
      hours: '40.00',
      amount: '26000.00',
      rateApplied: '650.00',
      rateBreakdown: [
        {
          from: '2026-09-28',
          to: '2026-10-03',
          hours: '40.00',
          rate: '650.00',
          amount: '26000.00',
        },
      ],
    },
  ];

  function withProject(id: string) {
    return postings.map((p) => ({ ...p, projectId: id }));
  }

  /** A single-segment breakdown, for the corrected re-approvals below. */
  function segment(hours: string, amount: string) {
    return [{ from: '2026-09-28', to: '2026-10-03', hours, rate: '650.00', amount }];
  }

  it('posts version 1 on first approval', async () => {
    const result = await postTimesheetCost(prisma, {
      companyId,
      timesheetId,
      employeeId,
      postingDate: d('2026-10-04'),
      postings: withProject(projectId),
    });

    expect(result.version).toBe(1);
    expect(await activePostingVersion(prisma, 'TIMESHEET', timesheetId)).toBe(1);
    expect(await netPostedAmount(prisma, 'TIMESHEET', timesheetId)).toBe('26000.00');
  });

  it('refuses to post the same version twice', async () => {
    // Simulates a double-click or a retried job: the unique key must stop it,
    // not silently double the project cost.
    await expect(
      prisma.costLedgerEntry.create({
        data: {
          companyId,
          projectId,
          employeeId,
          sourceType: 'TIMESHEET',
          sourceId: timesheetId,
          postingVersion: 1,
          isReversal: false,
          postingDate: d('2026-10-04'),
          hours: '40.00',
          amount: '26000.00',
        },
      }),
    ).rejects.toThrow(/Unique constraint/i);

    expect(await netPostedAmount(prisma, 'TIMESHEET', timesheetId)).toBe('26000.00');
  });

  /**
   * The sequence the client asked for: approve, reopen, approve, reopen,
   * approve. Five postings in all (v1, -v1, v2, -v2, v3) and a net equal to
   * the last approval alone.
   */
  it('survives approve -> reopen -> approve -> reopen -> approve', async () => {
    // Reopen 1
    const r1 = await reverseTimesheetCost(prisma, {
      companyId,
      timesheetId,
      reason: 'Monday hours were booked to the wrong task',
    });
    expect(r1.version).toBe(1);
    expect(await activePostingVersion(prisma, 'TIMESHEET', timesheetId)).toBeNull();
    expect(await netPostedAmount(prisma, 'TIMESHEET', timesheetId)).toBe('0.00');

    // Approve 2 — corrected to 36 hours.
    const p2 = await postTimesheetCost(prisma, {
      companyId,
      timesheetId,
      employeeId,
      postingDate: d('2026-10-04'),
      postings: [
        {
          projectId,
          hours: '36.00',
          amount: '23400.00',
          rateApplied: '650.00',
          rateBreakdown: segment('36.00', '23400.00'),
        },
      ],
    });
    expect(p2.version).toBe(2);
    expect(await activePostingVersion(prisma, 'TIMESHEET', timesheetId)).toBe(2);
    expect(await netPostedAmount(prisma, 'TIMESHEET', timesheetId)).toBe('23400.00');

    // Reopen 2
    const r2 = await reverseTimesheetCost(prisma, {
      companyId,
      timesheetId,
      reason: 'Client disputed Thursday',
    });
    expect(r2.version).toBe(2);
    expect(await netPostedAmount(prisma, 'TIMESHEET', timesheetId)).toBe('0.00');

    // Approve 3 — final, 32 hours.
    const p3 = await postTimesheetCost(prisma, {
      companyId,
      timesheetId,
      employeeId,
      postingDate: d('2026-10-04'),
      postings: [
        {
          projectId,
          hours: '32.00',
          amount: '20800.00',
          rateApplied: '650.00',
          rateBreakdown: segment('32.00', '20800.00'),
        },
      ],
    });
    expect(p3.version).toBe(3);
    expect(await nextPostingVersion(prisma, 'TIMESHEET', timesheetId)).toBe(4);

    // --- The ledger tells the whole story, in order --------------------
    const rows = await prisma.costLedgerEntry.findMany({
      where: { sourceType: 'TIMESHEET', sourceId: timesheetId },
      orderBy: [{ postingVersion: 'asc' }, { isReversal: 'asc' }],
      select: { postingVersion: true, isReversal: true, hours: true, amount: true },
    });

    expect(
      rows.map((r) => ({
        v: r.postingVersion,
        reversal: r.isReversal,
        hours: r.hours?.toString(),
        amount: r.amount.toString(),
      })),
    ).toEqual([
      { v: 1, reversal: false, hours: '40', amount: '26000' },
      { v: 1, reversal: true, hours: '-40', amount: '-26000' },
      { v: 2, reversal: false, hours: '36', amount: '23400' },
      { v: 2, reversal: true, hours: '-36', amount: '-23400' },
      { v: 3, reversal: false, hours: '32', amount: '20800' },
    ]);

    // Nothing was ever updated or deleted: five rows, net = the last approval.
    expect(rows).toHaveLength(5);
    expect(await netPostedAmount(prisma, 'TIMESHEET', timesheetId)).toBe('20800.00');
    expect(await activePostingVersion(prisma, 'TIMESHEET', timesheetId)).toBe(3);
  });

  it('leaves the project actuals equal to the live version only', async () => {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    // 40 - 40 + 36 - 36 + 32
    expect(new Decimal(project.actualHours.toString()).toFixed(2)).toBe('32.00');
    expect(new Decimal(project.actualLabourCost.toString()).toFixed(2)).toBe('20800.00');
    expect(new Decimal(project.actualTotalCost.toString()).toFixed(2)).toBe('20800.00');
  });

  /**
   * The rate-change case, end to end against the database: compute the postings
   * from the real rate history, post them, reopen, re-approve, and check that
   * every row carries a breakdown that reconciles to its own amount.
   */
  it('stores a rate breakdown that survives a reopen and re-approval', async () => {
    // Its own employee: timesheets are unique on (employeeId, weekStartDate),
    // and the week straddling the 01 Oct rise is already taken above.
    const office = await prisma.office.findFirstOrThrow({ where: { companyId } });
    const straddler = await prisma.employee.create({
      data: {
        companyId,
        employeeCode: 'LT-002',
        firstName: 'Rate',
        lastName: 'Straddler',
        joiningDate: d('2021-11-01'),
        officeId: office.id,
      },
    });
    await prisma.employeeCostRate.createMany({
      data: [
        {
          companyId,
          employeeId: straddler.id,
          hourlyRate: '650.00',
          effectiveFrom: d('2021-11-01'),
        },
        {
          companyId,
          employeeId: straddler.id,
          hourlyRate: '700.00',
          effectiveFrom: d('2026-10-01'),
        },
      ],
    });

    const straddling = await prisma.timesheet.create({
      data: {
        companyId,
        employeeId: straddler.id,
        weekStartDate: d('2026-09-28'),
        weekEndDate: d('2026-10-04'),
        status: 'APPROVED',
        totalHours: '28.00',
      },
    });

    const rates = await prisma.employeeCostRate.findMany({
      where: { employeeId: straddler.id },
      select: { hourlyRate: true, effectiveFrom: true },
    });

    // Three days before the 01 Oct rise, one day after it.
    const computed = computeTimesheetPostings(
      [
        { projectId, workDate: d('2026-09-28'), hours: '8.00' },
        { projectId, workDate: d('2026-09-29'), hours: '8.00' },
        { projectId, workDate: d('2026-09-30'), hours: '8.00' },
        { projectId, workDate: d('2026-10-01'), hours: '4.00' },
      ],
      rates,
    );

    await postTimesheetCost(prisma, {
      companyId,
      timesheetId: straddling.id,
      employeeId: straddler.id,
      postingDate: d('2026-10-04'),
      postings: computed,
    });

    const posted = await prisma.costLedgerEntry.findFirstOrThrow({
      where: { sourceType: 'TIMESHEET', sourceId: straddling.id, isReversal: false },
    });

    expect(posted.hours?.toString()).toBe('28');
    expect(posted.amount.toString()).toBe('18400');
    // Two rates, so no single rate — but the JSON explains the whole number.
    expect(posted.rateApplied).toBeNull();
    expect(posted.rateBreakdown).toEqual([
      { from: '2026-09-28', to: '2026-09-30', hours: '24.00', rate: '650.00', amount: '15600.00' },
      { from: '2026-10-01', to: '2026-10-01', hours: '4.00', rate: '700.00', amount: '2800.00' },
    ]);

    // Reopening mirrors the breakdown rather than dropping it.
    await reverseTimesheetCost(prisma, {
      companyId,
      timesheetId: straddling.id,
      reason: 'Thursday split was wrong',
    });

    const reversal = await prisma.costLedgerEntry.findFirstOrThrow({
      where: { sourceType: 'TIMESHEET', sourceId: straddling.id, isReversal: true },
    });

    expect(reversal.amount.toString()).toBe('-18400');
    expect(reversal.rateBreakdown).toEqual([
      {
        from: '2026-09-28',
        to: '2026-09-30',
        hours: '-24.00',
        rate: '650.00',
        amount: '-15600.00',
      },
      { from: '2026-10-01', to: '2026-10-01', hours: '-4.00', rate: '700.00', amount: '-2800.00' },
    ]);
    expect(await netPostedAmount(prisma, 'TIMESHEET', straddling.id)).toBe('0.00');

    // Re-approving posts v2 with its own, independent breakdown.
    const corrected = computeTimesheetPostings(
      [
        { projectId, workDate: d('2026-09-28'), hours: '8.00' },
        { projectId, workDate: d('2026-10-01'), hours: '8.00' },
      ],
      rates,
    );
    const v2 = await postTimesheetCost(prisma, {
      companyId,
      timesheetId: straddling.id,
      employeeId: straddler.id,
      postingDate: d('2026-10-04'),
      postings: corrected,
    });
    expect(v2.version).toBe(2);

    const reapproved = await prisma.costLedgerEntry.findFirstOrThrow({
      where: {
        sourceType: 'TIMESHEET',
        sourceId: straddling.id,
        postingVersion: 2,
        isReversal: false,
      },
    });
    expect(reapproved.rateBreakdown).toEqual([
      { from: '2026-09-28', to: '2026-09-28', hours: '8.00', rate: '650.00', amount: '5200.00' },
      { from: '2026-10-01', to: '2026-10-01', hours: '8.00', rate: '700.00', amount: '5600.00' },
    ]);
    // 8 x 650 + 8 x 700
    expect(await netPostedAmount(prisma, 'TIMESHEET', straddling.id)).toBe('10800.00');

    // Every labour row on the ledger carries a breakdown that adds up.
    const allRows = await prisma.costLedgerEntry.findMany({
      where: { sourceType: 'TIMESHEET', sourceId: straddling.id },
    });
    for (const row of allRows) {
      const segments = row.rateBreakdown as unknown as Array<{ hours: string; amount: string }>;
      expect(segments.length).toBeGreaterThan(0);
      const total = segments.reduce((acc, s) => acc.plus(new Decimal(s.amount)), new Decimal(0));
      expect(total.toFixed(2)).toBe(new Decimal(row.amount.toString()).toFixed(2));
    }
  });

  it('versions each project separately for a timesheet spanning two projects', async () => {
    const multi = await prisma.timesheet.create({
      data: {
        companyId,
        employeeId,
        weekStartDate: d('2026-10-05'),
        weekEndDate: d('2026-10-11'),
        status: 'APPROVED',
        totalHours: '40.00',
      },
    });

    await postTimesheetCost(prisma, {
      companyId,
      timesheetId: multi.id,
      employeeId,
      postingDate: d('2026-10-11'),
      postings: [
        {
          projectId,
          hours: '24.00',
          amount: '16800.00',
          rateApplied: '700.00',
          rateBreakdown: [
            {
              from: '2026-10-05',
              to: '2026-10-08',
              hours: '24.00',
              rate: '700.00',
              amount: '16800.00',
            },
          ],
        },
        {
          projectId: secondProjectId,
          hours: '16.00',
          amount: '11200.00',
          rateApplied: '700.00',
          rateBreakdown: [
            {
              from: '2026-10-09',
              to: '2026-10-10',
              hours: '16.00',
              rate: '700.00',
              amount: '11200.00',
            },
          ],
        },
      ],
    });

    // Two rows at version 1 — one per project. This is exactly what the key
    // (sourceType, sourceId, projectId, postingVersion, isReversal) allows and
    // what a key without projectId would have rejected.
    const v1 = await prisma.costLedgerEntry.findMany({
      where: { sourceType: 'TIMESHEET', sourceId: multi.id, postingVersion: 1 },
    });
    expect(v1).toHaveLength(2);

    // A reopen reverses both.
    const reversal = await reverseTimesheetCost(prisma, {
      companyId,
      timesheetId: multi.id,
      reason: 'Split between projects was wrong',
    });
    expect(reversal.rows).toBe(2);
    expect(await netPostedAmount(prisma, 'TIMESHEET', multi.id)).toBe('0.00');

    const after = await prisma.project.findUniqueOrThrow({ where: { id: secondProjectId } });
    expect(new Decimal(after.actualTotalCost.toString()).toFixed(2)).toBe('0.00');
  });
});
