import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  addDays,
  applyLateMarkPenalty,
  attributeDate,
  computeDay,
  distanceMetres,
  ipAllowed,
  judgeGeofence,
  looksLikeImage,
  SELFIE_EXTENSIONS,
  SELFIE_MAX_BYTES,
  toOfficeDateString,
  type BoardQuery,
  type DayResult,
  type MobilePunchInput,
  type OfficePunchInput,
  type RegisterQuery,
  type PunchEvent,
} from '@opsvera/shared';
import path from 'node:path';
import { Clock } from '../../common/clock';
import { DataScopeService } from '../../common/scope/data-scope.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PrismaService } from '../../prisma/prisma.service';
import { FilesService } from '../files/files.service';
import {
  AttendanceContextLoader,
  dateRange,
  type ContextEmployee,
  type ResolvedDay,
} from './attendance-context';

const d = (value: string) => new Date(`${value}T00:00:00.000Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);

/** Most punches one person can make in a day; a guard against a stuck client. */
const MAX_PUNCHES_PER_DAY = 20;
/** Two punches closer together than this are a double tap, not two events. */
const DOUBLE_TAP_SECONDS = 20;

export interface PunchRow {
  id: string;
  type: 'IN' | 'OUT';
  source: 'MOBILE_GPS' | 'OFFICE_IP' | 'MANUAL' | 'REGULARISED';
  punchedAt: Date;
  attendanceDate: Date;
  isFlagged: boolean;
  flagReason: string | null;
  distanceM: number | null;
  withinGeofence: boolean | null;
  accuracyM: number | null;
  ipAddress: string | null;
  ipAllowed: boolean | null;
  selfieDocumentId: string | null;
  createdAt: Date;
  note: string | null;
}

export interface DayEval {
  employeeId: string;
  date: string;
  ctx: ResolvedDay;
  result: DayResult;
  /** Every punch of the day, as recorded. */
  punches: PunchRow[];
  /**
   * True when `result` was read from a settled attendance record rather than
   * re-judged. A settled day keeps the result it was given even if the policy
   * or the shift is edited afterwards: history does not move.
   */
  settled: boolean;
  /** Every reason the day needs a look: the punches' and the rule engine's. */
  flagReason: string | null;
}

/** The reasons a day was flagged, once each. */
function mergeFlags(punches: PunchRow[], extra: string | null): string | null {
  const reasons = [
    ...new Set(punches.filter((p) => p.isFlagged && p.flagReason).map((p) => p.flagReason!)),
    ...(extra ? [extra] : []),
  ];
  return reasons.length > 0 ? reasons.join('; ').slice(0, 400) : null;
}

/**
 * A regularised punch outranks the raw punch of the same kind: the approved
 * correction replaces the clock-in or clock-out it corrects, while the raw
 * punches stay on record as evidence. If a day has been regularised more than
 * once, the latest correction wins.
 */
export function effectivePunches(punches: PunchRow[]): PunchEvent[] {
  const latestRegularised = (type: 'IN' | 'OUT') =>
    punches
      .filter((p) => p.source === 'REGULARISED' && p.type === type)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))[0];

  const overrideIn = latestRegularised('IN');
  const overrideOut = latestRegularised('OUT');

  const kept = punches.filter((p) => {
    if (p.source === 'REGULARISED') return p === overrideIn || p === overrideOut;
    if (p.type === 'IN' && overrideIn) return false;
    if (p.type === 'OUT' && overrideOut) return false;
    return true;
  });
  return kept.map((p) => ({ type: p.type, at: p.punchedAt }));
}

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly loader: AttendanceContextLoader,
    private readonly scope: DataScopeService,
    private readonly files: FilesService,
    private readonly clock: Clock,
  ) {}

  // -------------------------------------------------------------------------
  // Evaluation: what each person's day looks like
  // -------------------------------------------------------------------------

  async loadEmployees(ids: string[]): Promise<ContextEmployee[]> {
    if (ids.length === 0) return [];
    return this.prisma.scoped.employee.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, officeId: true, departmentId: true, joiningDate: true, exitDate: true },
    });
  }

  /**
   * Runs the rule engine for every (person, day) in the range from the punches
   * as they stand. Nothing is read from stored attendance records, so the answer
   * always reflects the latest leave, holidays and shift assignments.
   */
  async evaluate(
    employees: ContextEmployee[],
    from: string,
    to: string,
    now: Date = this.clock.now(),
    options: { live?: boolean } = {},
  ): Promise<Map<string, DayEval>> {
    const out = new Map<string, DayEval>();
    if (employees.length === 0) return out;

    const ctx = await this.loader.load(employees, from, to);
    const punches = (await this.prisma.scoped.punch.findMany({
      where: {
        employeeId: { in: employees.map((e) => e.id) },
        attendanceDate: { gte: d(from), lte: d(to) },
      },
      orderBy: { punchedAt: 'asc' },
    })) as unknown as PunchRow[] & Array<{ employeeId: string }>;

    // `live` re-judges every day from the punches, ignoring settled records —
    // what the writers (a new punch, a regularisation, a recompute) need.
    const settledRecords = options.live
      ? []
      : await this.prisma.scoped.attendanceRecord.findMany({
          where: {
            employeeId: { in: employees.map((e) => e.id) },
            attendanceDate: { gte: d(from), lte: d(to) },
            isFinal: true,
          },
        });
    const settledByKey = new Map(
      settledRecords.map((r) => [`${r.employeeId}|${iso(r.attendanceDate)}`, r]),
    );

    const byKey = new Map<string, PunchRow[]>();
    for (const punch of punches as Array<PunchRow & { employeeId: string }>) {
      const key = `${punch.employeeId}|${iso(punch.attendanceDate)}`;
      byKey.set(key, [...(byKey.get(key) ?? []), punch]);
    }

    for (const employee of employees) {
      for (const date of dateRange(from, to)) {
        const resolved = ctx.resolve(employee.id, date);
        if (!resolved) continue;
        const dayPunches = byKey.get(`${employee.id}|${date}`) ?? [];

        const live = computeDay({
          date,
          timeZone: resolved.office.timezone,
          weeklyOff: resolved.weeklyOff,
          holiday: Boolean(resolved.holiday),
          leave: resolved.leave
            ? { dayPart: resolved.leave.dayPart, isPaid: resolved.leave.isPaid }
            : null,
          shift: resolved.shiftRule,
          policy: resolved.policy,
          punches: effectivePunches(dayPunches),
          now,
        });

        const record = settledByKey.get(`${employee.id}|${date}`);
        const result: DayResult = record
          ? {
              ...live,
              status: record.status,
              final: true,
              notInYet: false,
              firstInAt: record.firstInAt,
              lastOutAt: record.lastOutAt,
              workedMinutes: record.workedMinutes,
              breakMinutes: record.breakMinutes,
              lateMinutes: record.lateMinutes,
              earlyExitMinutes: record.earlyExitMinutes,
              overtimeMinutes: record.overtimeMinutes,
              isLate: record.isLate,
              isEarlyExit: record.isEarlyExit,
              clockedIn: false,
              dayValue: Number(record.dayValue),
              flagReason: null,
            }
          : live;

        out.set(`${employee.id}|${date}`, {
          employeeId: employee.id,
          date,
          ctx: resolved,
          result,
          punches: dayPunches,
          settled: Boolean(record),
          flagReason: record ? record.flagReason : mergeFlags(dayPunches, live.flagReason),
        });
      }
    }
    return out;
  }

  /** "Today" in an office's own calendar. */
  today(timeZone: string, now: Date = this.clock.now()): string {
    return toOfficeDateString(now, timeZone);
  }

  // -------------------------------------------------------------------------
  // Materialising days into attendance records
  // -------------------------------------------------------------------------

  /**
   * Writes the evaluated days to `attendance_records`, which the timesheet,
   * leave and payroll modules read. A day in the future, a day before joining,
   * and a working day nobody has punched into yet are not written.
   */
  async persist(evals: DayEval[], now: Date = this.clock.now()): Promise<number> {
    let written = 0;
    const months = new Map<string, { employeeId: string; month: string; perHalfDay: number }>();

    for (const ev of evals) {
      const { ctx, result, punches } = ev;
      if (!ctx.eligible) continue;
      if (ev.date > this.today(ctx.office.timezone, now)) continue;
      if (punches.length === 0 && result.notInYet) continue;

      const data = {
        employeeId: ev.employeeId,
        officeId: ctx.office.id,
        shiftId: ctx.shift?.id ?? null,
        attendanceDate: d(ev.date),
        status: result.status,
        firstInAt: result.firstInAt,
        lastOutAt: result.lastOutAt,
        workedMinutes: result.workedMinutes,
        breakMinutes: result.breakMinutes,
        lateMinutes: result.lateMinutes,
        earlyExitMinutes: result.earlyExitMinutes,
        overtimeMinutes: result.overtimeMinutes,
        isLate: result.isLate,
        isEarlyExit: result.isEarlyExit,
        isFlagged: ev.flagReason !== null,
        flagReason: ev.flagReason,
        leaveRequestId: ctx.leave?.id ?? null,
        holidayId: ctx.holiday?.id ?? null,
        dayValue: result.dayValue.toFixed(2),
        isFinal: result.final,
        computedAt: now,
      };

      const existing = await this.prisma.scoped.attendanceRecord.findFirst({
        where: { employeeId: ev.employeeId, attendanceDate: d(ev.date) },
        select: { id: true },
      });
      const record = existing
        ? await this.prisma.scoped.attendanceRecord.update({ where: { id: existing.id }, data })
        : await this.prisma.scoped.attendanceRecord.create({ data: data as never });

      if (punches.length > 0) {
        await this.prisma.scoped.punch.updateMany({
          where: { id: { in: punches.map((p) => p.id) } },
          data: { attendanceRecordId: record.id },
        });
      }
      written += 1;

      if (result.final) {
        months.set(`${ev.employeeId}|${ev.date.slice(0, 7)}`, {
          employeeId: ev.employeeId,
          month: ev.date.slice(0, 7),
          perHalfDay: ctx.policy.lateMarksPerHalfDay,
        });
      }
    }

    for (const { employeeId, month, perHalfDay } of months.values()) {
      await this.applyMonthlyLateMarks(employeeId, month, perHalfDay);
    }
    return written;
  }

  /**
   * The "N late marks cost half a day" rule, applied across a month of settled
   * days. Re-runnable: it sets every LATE day's deduction from scratch, so a
   * regularisation that removes a late mark also removes the penalty it caused.
   */
  private async applyMonthlyLateMarks(employeeId: string, month: string, perHalfDay: number) {
    const [year, mm] = month.split('-').map(Number);
    const last = new Date(Date.UTC(year, mm, 0)).getUTCDate();
    const records = await this.prisma.scoped.attendanceRecord.findMany({
      where: {
        employeeId,
        isFinal: true,
        attendanceDate: {
          gte: d(`${month}-01`),
          lte: d(`${month}-${String(last).padStart(2, '0')}`),
        },
      },
      select: {
        id: true,
        attendanceDate: true,
        status: true,
        dayValue: true,
        lateMarkDeduction: true,
      },
    });

    const penalties = applyLateMarkPenalty(
      records.map((r) => ({
        date: iso(r.attendanceDate),
        status: r.status,
        dayValue: Number(r.dayValue),
      })),
      perHalfDay,
    );

    for (const record of records) {
      const wanted = penalties.has(iso(record.attendanceDate)) ? 0.5 : 0;
      if (Number(record.lateMarkDeduction) !== wanted) {
        await this.prisma.scoped.attendanceRecord.update({
          where: { id: record.id },
          data: { lateMarkDeduction: wanted.toFixed(2) },
        });
      }
    }
  }

  /** Recompute and store a range. `force` redoes days that were already settled. */
  async recomputeRange(
    employeeIds: string[],
    from: string,
    to: string,
    options: { force?: boolean; now?: Date } = {},
  ): Promise<number> {
    const now = options.now ?? this.clock.now();
    const employees = await this.loadEmployees(employeeIds);
    const evals = [...(await this.evaluate(employees, from, to, now, { live: true })).values()];

    let todo = evals;
    if (!options.force) {
      const settled = await this.prisma.scoped.attendanceRecord.findMany({
        where: {
          employeeId: { in: employeeIds },
          isFinal: true,
          attendanceDate: { gte: d(from), lte: d(to) },
        },
        select: { employeeId: true, attendanceDate: true },
      });
      const done = new Set(settled.map((r) => `${r.employeeId}|${iso(r.attendanceDate)}`));
      todo = evals.filter((e) => !done.has(`${e.employeeId}|${e.date}`));
    }
    return this.persist(todo, now);
  }

  /**
   * The nightly pass: settle the last few days for everyone. Idempotent, so it
   * can run as often as it likes and a missed run is simply caught next time.
   */
  async settleRecentDays(days = 3): Promise<number> {
    const employees = await this.prisma.scoped.employee.findMany({
      where: { deletedAt: null, status: { in: ['ACTIVE', 'NOTICE_PERIOD'] } },
      select: { id: true },
    });
    const now = this.clock.now();
    // One day past UTC's "today" so an office ahead of UTC (India, Saudi) is
    // covered; days that have not happened yet in an office are skipped there.
    const to = addDays(toOfficeDateString(now, 'UTC'), 1);
    const from = addDays(to, -(days + 1));
    const written = await this.recomputeRange(
      employees.map((e) => e.id),
      from,
      to,
      { now },
    );
    this.logger.log(
      `Settled ${written} attendance days (${from} to ${to}) for ${employees.length} people`,
    );
    return written;
  }

  // -------------------------------------------------------------------------
  // Punching
  // -------------------------------------------------------------------------

  private async requirePunchingEmployee(user: AuthenticatedUser) {
    if (!user.employeeId) {
      throw new ForbiddenException({
        code: 'NO_EMPLOYEE_PROFILE',
        message:
          'Your login is not linked to an employee record, so there is no attendance to record.',
      });
    }
    const employee = await this.prisma.scoped.employee.findFirst({
      where: { id: user.employeeId, deletedAt: null },
      include: { office: true },
    });
    if (!employee || !['ACTIVE', 'NOTICE_PERIOD'].includes(employee.status)) {
      throw new ForbiddenException({
        code: 'EMPLOYEE_NOT_ACTIVE',
        message: 'Your employee record is not active, so you cannot punch.',
      });
    }
    return employee;
  }

  /** Mobile: GPS + selfie + geofence. */
  async punchMobile(
    input: MobilePunchInput,
    selfie: { originalName: string; mimeType: string; size: number; buffer: Buffer } | undefined,
    user: AuthenticatedUser,
  ) {
    const employee = await this.requirePunchingEmployee(user);

    if (employee.attendanceMethod === 'OFFICE') {
      throw new ForbiddenException({
        code: 'METHOD_NOT_ALLOWED',
        message: 'You are set up to punch from the office network, not from a phone.',
      });
    }

    this.assertSelfie(selfie);

    const office = employee.office;
    const lat = office.latitude === null ? null : Number(office.latitude);
    const lng = office.longitude === null ? null : Number(office.longitude);
    const distance =
      lat === null || lng === null
        ? null
        : distanceMetres({ lat, lng }, { lat: input.latitude, lng: input.longitude });

    const verdict = judgeGeofence(
      { latitude: lat, longitude: lng, radiusM: office.geofenceRadiusM, mode: office.geofenceMode },
      distance,
      input.accuracyM,
    );
    if (!verdict.allowed) {
      throw new UnprocessableEntityException({
        code: verdict.code,
        message: verdict.message,
        details: { distanceM: verdict.distanceM, radiusM: office.geofenceRadiusM },
      });
    }

    const document = await this.files.store(
      {
        originalName: selfie!.originalName,
        mimeType: selfie!.mimeType,
        size: selfie!.size,
        buffer: selfie!.buffer,
      },
      { ownerType: 'PUNCH', category: 'Attendance selfie' },
      user,
    );

    return this.recordPunch({
      employee,
      user,
      requestedType: input.type,
      source: 'MOBILE_GPS',
      evidence: {
        latitude: input.latitude.toFixed(7),
        longitude: input.longitude.toFixed(7),
        accuracyM: input.accuracyM === undefined ? null : Math.round(input.accuracyM),
        distanceM: verdict.distanceM,
        withinGeofence: verdict.within,
        selfieDocumentId: document.id,
        deviceInfo: input.deviceInfo ?? null,
      },
      flagReason: verdict.flagReason,
    });
  }

  /** Office: only from an address on the office's allow-list. */
  async punchOffice(input: OfficePunchInput, user: AuthenticatedUser, ip: string | undefined) {
    const employee = await this.requirePunchingEmployee(user);
    const office = employee.office;

    if (employee.attendanceMethod === 'MOBILE') {
      throw new ForbiddenException({
        code: 'METHOD_NOT_ALLOWED',
        message: 'You are set up to punch from your phone, not from the office network.',
      });
    }
    if (office.requiresGps) {
      throw new ForbiddenException({
        code: 'GPS_REQUIRED',
        message: `${office.name} requires a GPS punch from your phone. Office-network punches are not accepted there.`,
      });
    }

    const allowed = ipAllowed(ip, office.allowedIPs);
    if (!allowed) {
      throw new ForbiddenException({
        code: 'OUTSIDE_NETWORK',
        message: `Your network address (${ip ?? 'unknown'}) is not one of ${office.name}'s office addresses. Connect to the office network, or punch from your phone.`,
        details: { ip: ip ?? null },
      });
    }

    return this.recordPunch({
      employee,
      user,
      requestedType: input.type,
      source: 'OFFICE_IP',
      evidence: {
        ipAddress: ip ?? null,
        ipAllowed: true,
        deviceInfo: input.deviceInfo ?? null,
      },
      flagReason: null,
    });
  }

  private assertSelfie(
    selfie: { originalName: string; size: number; buffer: Buffer } | undefined,
  ): asserts selfie is { originalName: string; mimeType: string; size: number; buffer: Buffer } {
    if (!selfie) {
      throw new BadRequestException({
        code: 'SELFIE_REQUIRED',
        message: 'Take a selfie to punch from your phone.',
      });
    }
    const extension = path.extname(selfie.originalName).toLowerCase();
    if (!(SELFIE_EXTENSIONS as readonly string[]).includes(extension)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_FILE',
        message: 'The selfie must be a JPEG, PNG or WebP photo.',
      });
    }
    if (selfie.size === 0 || selfie.size > SELFIE_MAX_BYTES) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_FILE',
        message: `The selfie must be under ${SELFIE_MAX_BYTES / 1024 / 1024} MB.`,
      });
    }
    // A renamed document is not a photo: check what the bytes actually are.
    if (!looksLikeImage(selfie.buffer.subarray(0, 16))) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_FILE',
        message: 'That file is not a photo.',
      });
    }
  }

  private async recordPunch(args: {
    employee: Awaited<ReturnType<AttendanceService['requirePunchingEmployee']>>;
    user: AuthenticatedUser;
    requestedType?: 'IN' | 'OUT';
    source: 'MOBILE_GPS' | 'OFFICE_IP';
    evidence: Record<string, unknown>;
    flagReason: string | null;
  }) {
    const { employee, user } = args;
    // Server time, always. A phone's clock is whatever its owner has set it to.
    const now = this.clock.now();
    const timeZone = employee.office.timezone;

    // Which day does this punch belong to? Matters for shifts that cross midnight.
    const local = toOfficeDateString(now, timeZone);
    const ctx = await this.loader.load(
      [
        {
          id: employee.id,
          officeId: employee.officeId,
          departmentId: employee.departmentId,
          joiningDate: employee.joiningDate,
          exitDate: employee.exitDate,
        },
      ],
      addDays(local, -1),
      addDays(local, 1),
    );
    const attendanceDate = attributeDate(
      now,
      timeZone,
      (date) => ctx.resolve(employee.id, date)?.shiftRule ?? null,
    );

    const created = await this.prisma.scoped.$transaction(async (tx) => {
      // One punch at a time per person: without the lock, a double tap reads
      // "not clocked in" twice and records two clock-ins.
      await tx.$queryRaw`SELECT id FROM employees WHERE id = ${employee.id} FOR UPDATE`;

      const todays = await tx.punch.findMany({
        where: { employeeId: employee.id, attendanceDate: d(attendanceDate) },
        orderBy: { punchedAt: 'asc' },
      });
      const last = todays[todays.length - 1];

      if (todays.length >= MAX_PUNCHES_PER_DAY) {
        throw new ConflictException({
          code: 'TOO_MANY_PUNCHES',
          message:
            'That is a lot of punches for one day. Ask your manager to regularise the day instead.',
        });
      }
      if (last && (now.getTime() - last.punchedAt.getTime()) / 1000 < DOUBLE_TAP_SECONDS) {
        throw new ConflictException({
          code: 'DOUBLE_PUNCH',
          message: 'You punched a moment ago. Wait a few seconds before punching again.',
        });
      }

      const nextType: 'IN' | 'OUT' = last?.type === 'IN' ? 'OUT' : 'IN';
      if (args.requestedType && args.requestedType !== nextType) {
        throw new ConflictException({
          code: nextType === 'OUT' ? 'ALREADY_CLOCKED_IN' : 'NOT_CLOCKED_IN',
          message:
            nextType === 'OUT'
              ? 'You are already clocked in. Clock out instead.'
              : 'You are not clocked in, so there is nothing to clock out of.',
        });
      }

      return tx.punch.create({
        data: {
          employeeId: employee.id,
          officeId: employee.officeId,
          type: nextType,
          source: args.source,
          punchedAt: now,
          attendanceDate: d(attendanceDate),
          isFlagged: Boolean(args.flagReason),
          flagReason: args.flagReason,
          createdById: user.userId,
          ...args.evidence,
        } as never,
      });
    });

    // Re-judge the day with the new punch in it.
    const evals = await this.evaluate(
      [
        {
          id: employee.id,
          officeId: employee.officeId,
          departmentId: employee.departmentId,
          joiningDate: employee.joiningDate,
          exitDate: employee.exitDate,
        },
      ],
      attendanceDate,
      attendanceDate,
      now,
      { live: true },
    );
    await this.persist([...evals.values()], now);

    return {
      punch: {
        id: created.id,
        type: created.type,
        source: created.source,
        punchedAt: created.punchedAt,
        attendanceDate,
        isFlagged: created.isFlagged,
        flagReason: created.flagReason,
        distanceM: (created as { distanceM?: number | null }).distanceM ?? null,
      },
      today: await this.meToday(user),
    };
  }

  // -------------------------------------------------------------------------
  // "My day": what the clock-in card needs
  // -------------------------------------------------------------------------

  async meToday(user: AuthenticatedUser, ip?: string) {
    const employee = await this.requirePunchingEmployee(user);
    const now = this.clock.now();
    const office = employee.office;
    const local = toOfficeDateString(now, office.timezone);

    const self: ContextEmployee = {
      id: employee.id,
      officeId: employee.officeId,
      departmentId: employee.departmentId,
      joiningDate: employee.joiningDate,
      exitDate: employee.exitDate,
    };
    const ctx = await this.loader.load([self], addDays(local, -1), addDays(local, 1));
    const date = attributeDate(
      now,
      office.timezone,
      (day) => ctx.resolve(employee.id, day)?.shiftRule ?? null,
    );

    const evals = await this.evaluate([self], date, date, now);
    const ev = evals.get(`${employee.id}|${date}`)!;
    const punches = [...ev.punches].sort((a, b) => a.punchedAt.getTime() - b.punchedAt.getTime());

    const lastType = punches[punches.length - 1]?.type;
    const methodMobile = employee.attendanceMethod !== 'OFFICE';
    const methodOffice = employee.attendanceMethod !== 'MOBILE' && !office.requiresGps;

    const openSince = ev.result.clockedIn
      ? (effectivePunches(punches)
          .filter((p) => p.type === 'IN')
          .sort((a, b) => b.at.getTime() - a.at.getTime())[0]?.at ?? null)
      : null;

    return {
      date,
      now,
      employeeId: employee.id,
      office: {
        id: office.id,
        name: office.name,
        shortCode: office.shortCode,
        timezone: office.timezone,
        latitude: office.latitude === null ? null : Number(office.latitude),
        longitude: office.longitude === null ? null : Number(office.longitude),
        geofenceRadiusM: office.geofenceRadiusM,
        requiresGps: office.requiresGps,
        geofenceMode: office.geofenceMode,
      },
      shift: ev.ctx.shift
        ? {
            name: ev.ctx.shift.name,
            startTime: ev.ctx.shift.startTime,
            endTime: ev.ctx.shift.endTime,
            crossesMidnight: ev.ctx.shift.crossesMidnight,
          }
        : null,
      methods: { mobile: methodMobile, office: methodOffice },
      network: {
        ip: ip ?? null,
        // Only said when this person could use the office network at all.
        allowed: methodOffice ? ipAllowed(ip, office.allowedIPs) : false,
      },
      dayType: ev.ctx.weeklyOff
        ? 'WEEKLY_OFF'
        : ev.ctx.holiday
          ? 'HOLIDAY'
          : ev.ctx.leave
            ? 'LEAVE'
            : 'WORKING',
      holidayName: ev.ctx.holiday?.name ?? null,
      status: ev.result.notInYet ? 'NOT_IN' : ev.result.status,
      clockedIn: ev.result.clockedIn,
      clockedInSince: openSince,
      nextAction: lastType === 'IN' ? 'OUT' : 'IN',
      firstInAt: ev.result.firstInAt,
      lastOutAt: ev.result.lastOutAt,
      workedMinutes: ev.result.workedMinutes,
      isLate: ev.result.isLate,
      lateMinutes: ev.result.lateMinutes,
      punches: punches.map((p) => ({
        id: p.id,
        type: p.type,
        source: p.source,
        punchedAt: p.punchedAt,
        isFlagged: p.isFlagged,
        flagReason: p.flagReason,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Scope helpers shared by the read endpoints
  // -------------------------------------------------------------------------

  /** People the caller may see, narrowed by the screen's own filters. */
  async scopedEmployees(
    user: AuthenticatedUser,
    permission: string,
    filters: { officeId?: string; departmentId?: string; q?: string },
    asOf?: { from: string; to: string },
  ) {
    const visible = await this.scope.visibleEmployeeIds(
      user,
      this.scope.scopeFor(user, permission),
    );

    const where: Prisma.EmployeeWhereInput = {
      deletedAt: null,
      status: { in: ['ACTIVE', 'NOTICE_PERIOD'] },
      ...(visible === null ? {} : { id: { in: visible } }),
      ...(filters.officeId ? { officeId: filters.officeId } : {}),
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      ...(asOf
        ? {
            joiningDate: { lte: d(asOf.to) },
            OR: [{ exitDate: null }, { exitDate: { gte: d(asOf.from) } }],
          }
        : {}),
      ...(filters.q
        ? {
            AND: [
              {
                OR: [
                  { firstName: { contains: filters.q } },
                  { lastName: { contains: filters.q } },
                  { employeeCode: { contains: filters.q } },
                ],
              },
            ],
          }
        : {}),
    };

    return this.prisma.scoped.employee.findMany({
      where,
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        officeId: true,
        departmentId: true,
        joiningDate: true,
        exitDate: true,
        attendanceMethod: true,
        office: { select: { id: true, name: true, shortCode: true, timezone: true } },
        department: { select: { id: true, name: true } },
        designation: { select: { name: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
  }

  /** Offices and departments for the screens' filters; names only. */
  async lookups() {
    const [offices, departments] = await Promise.all([
      this.prisma.scoped.office.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, name: true, shortCode: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.scoped.department.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { offices, departments };
  }

  // -------------------------------------------------------------------------
  // Live board
  // -------------------------------------------------------------------------

  async board(query: BoardQuery, user: AuthenticatedUser) {
    const now = this.clock.now();
    // "Today" for a mixed-office board is the earliest office's today, so no
    // office is ever shown a day that has not started there yet.
    const date = query.date ?? this.earliestToday(now);

    const people = await this.scopedEmployees(user, 'attendance.view', query, {
      from: date,
      to: date,
    });
    const evals = await this.evaluate(people, date, date, now);

    const rows = people
      .map((person) => {
        const ev = evals.get(`${person.id}|${date}`);
        if (!ev || !ev.ctx.eligible) return null;
        const { result } = ev;
        const effective = effectivePunches(ev.punches);
        const status = result.notInYet ? 'NOT_IN' : result.status;

        // Live hours: a clock that is still running keeps counting.
        const open = result.clockedIn
          ? effective
              .filter((p) => p.type === 'IN')
              .sort((a, b) => b.at.getTime() - a.at.getTime())[0]
          : null;
        const liveMinutes = open
          ? result.workedMinutes +
            Math.max(0, Math.round((now.getTime() - open.at.getTime()) / 60_000))
          : result.workedMinutes;

        const first = ev.punches.find((p) => p.type === 'IN');
        const flagged = ev.flagReason !== null;
        return {
          employeeId: person.id,
          employeeCode: person.employeeCode,
          fullName: `${person.firstName} ${person.lastName}`,
          designation: person.designation?.name ?? null,
          office: person.office,
          department: person.department,
          status,
          dayType: ev.ctx.weeklyOff
            ? 'WEEKLY_OFF'
            : ev.ctx.holiday
              ? 'HOLIDAY'
              : ev.ctx.leave
                ? 'LEAVE'
                : 'WORKING',
          shift: ev.ctx.shift ? `${ev.ctx.shift.startTime}–${ev.ctx.shift.endTime}` : null,
          firstInAt: result.firstInAt,
          lastOutAt: result.lastOutAt,
          clockedIn: result.clockedIn,
          workedMinutes: liveMinutes,
          isLate: result.isLate,
          lateMinutes: result.lateMinutes,
          isEarlyExit: result.isEarlyExit,
          overtimeMinutes: result.overtimeMinutes,
          method: first?.source ?? null,
          distanceM: first?.distanceM ?? null,
          flagged,
          flagReason: ev.flagReason,
          isRegularised: ev.punches.some((p) => p.source === 'REGULARISED'),
          final: result.final,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    const summary = {
      total: rows.length,
      present: rows.filter((r) => r.status === 'PRESENT').length,
      late: rows.filter((r) => r.status === 'LATE').length,
      halfDay: rows.filter((r) => r.status === 'HALF_DAY').length,
      absent: rows.filter((r) => r.status === 'ABSENT').length,
      onLeave: rows.filter((r) => r.status === 'ON_LEAVE').length,
      notIn: rows.filter((r) => r.status === 'NOT_IN').length,
      holiday: rows.filter((r) => r.status === 'HOLIDAY').length,
      weeklyOff: rows.filter((r) => r.status === 'WEEKLY_OFF').length,
      flagged: rows.filter((r) => r.flagged).length,
      clockedIn: rows.filter((r) => r.clockedIn).length,
    };

    let shown = rows;
    if (query.status) shown = shown.filter((r) => r.status === query.status);
    if (query.flagged) shown = shown.filter((r) => r.flagged);

    const total = shown.length;
    const page = shown.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);

    return {
      date,
      generatedAt: now,
      summary,
      data: page,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  private earliestToday(now: Date): string {
    // Offices run from UTC-ish to UTC+5:30 here; the earliest "today" in any
    // zone is UTC-12's, but nobody is there. UTC itself is a safe floor.
    return toOfficeDateString(now, 'UTC');
  }

  // -------------------------------------------------------------------------
  // Monthly register
  // -------------------------------------------------------------------------

  async register(query: RegisterQuery, user: AuthenticatedUser) {
    const { from, to } = monthBounds(query.month);
    const now = this.clock.now();

    const everyone = await this.scopedEmployees(user, 'attendance.view', query, { from, to });
    const total = everyone.length;
    const people = everyone.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);

    const evals = await this.evaluate(people, from, to, now);
    const days = dateRange(from, to);

    const rows = people.map((person) => {
      const cells = days.map((date) => {
        const ev = evals.get(`${person.id}|${date}`);
        if (!ev || !ev.ctx.eligible) return { date, status: null };
        // Days that have not happened yet in this person's office are blank.
        if (date > this.today(ev.ctx.office.timezone, now)) return { date, status: null };
        const status = ev.result.notInYet ? 'NOT_IN' : ev.result.status;
        return {
          date,
          status,
          isLate: ev.result.isLate,
          flagged: ev.flagReason !== null,
          regularised: ev.punches.some((p) => p.source === 'REGULARISED'),
          final: ev.result.final,
          dayValue: ev.result.dayValue,
          firstInAt: ev.result.firstInAt,
          lastOutAt: ev.result.lastOutAt,
          workedMinutes: ev.result.workedMinutes,
          lateMinutes: ev.result.lateMinutes,
          overtimeMinutes: ev.result.overtimeMinutes,
        };
      });

      // The late-mark rule, applied across the month in date order.
      const sample = [...evals.values()].find((e) => e.employeeId === person.id);
      const penalties = applyLateMarkPenalty(
        cells
          .filter((c) => c.status === 'LATE' && c.final)
          .map((c) => ({ date: c.date, status: 'LATE' as const, dayValue: c.dayValue ?? 1 })),
        sample?.ctx.policy.lateMarksPerHalfDay ?? 0,
      );

      const count = (...statuses: string[]) =>
        cells.filter((c) => c.status && statuses.includes(c.status)).length;
      const credited =
        cells.reduce((sum, c) => sum + (c.final ? (c.dayValue ?? 0) : 0), 0) - penalties.size * 0.5;

      return {
        employeeId: person.id,
        employeeCode: person.employeeCode,
        fullName: `${person.firstName} ${person.lastName}`,
        office: person.office,
        department: person.department,
        days: cells,
        totals: {
          present: count('PRESENT'),
          late: count('LATE'),
          halfDay: count('HALF_DAY'),
          absent: count('ABSENT'),
          onLeave: count('ON_LEAVE'),
          weeklyOff: count('WEEKLY_OFF'),
          holiday: count('HOLIDAY'),
          overtimeMinutes: [...evals.values()]
            .filter((e) => e.employeeId === person.id)
            .reduce((sum, e) => sum + e.result.overtimeMinutes, 0),
          lateMarkPenaltyDays: penalties.size * 0.5,
          creditedDays: Math.max(0, credited),
        },
      };
    });

    return {
      month: query.month,
      days,
      data: rows,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  // -------------------------------------------------------------------------
  // One person, one day / range
  // -------------------------------------------------------------------------

  /** 404 for someone outside the caller's attendance scope. */
  async assertCanSee(employeeId: string, user: AuthenticatedUser, permission = 'attendance.view') {
    const visible = await this.scope.visibleEmployeeIds(
      user,
      this.scope.scopeFor(user, permission),
    );
    if (visible !== null && !visible.includes(employeeId)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Employee not found.' });
    }
    const employee = await this.prisma.scoped.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        officeId: true,
        departmentId: true,
        joiningDate: true,
        exitDate: true,
      },
    });
    if (!employee) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Employee not found.' });
    }
    return employee;
  }

  async employeeRange(employeeId: string, from: string, to: string, user: AuthenticatedUser) {
    if (to < from || dateRange(from, to).length > 93) {
      throw new BadRequestException({
        code: 'INVALID_RANGE',
        message: 'Choose a range of up to three months, starting before it ends.',
      });
    }
    const employee = await this.assertCanSee(employeeId, user);
    const now = this.clock.now();
    const evals = await this.evaluate([employee], from, to, now);

    const days = dateRange(from, to)
      .map((date) => {
        const ev = evals.get(`${employeeId}|${date}`);
        if (!ev || !ev.ctx.eligible) return null;
        if (date > this.today(ev.ctx.office.timezone, now)) return null;
        return {
          date,
          status: ev.result.notInYet ? 'NOT_IN' : ev.result.status,
          dayType: ev.ctx.weeklyOff
            ? 'WEEKLY_OFF'
            : ev.ctx.holiday
              ? 'HOLIDAY'
              : ev.ctx.leave
                ? 'LEAVE'
                : 'WORKING',
          holidayName: ev.ctx.holiday?.name ?? null,
          shift: ev.ctx.shift ? `${ev.ctx.shift.startTime}–${ev.ctx.shift.endTime}` : null,
          firstInAt: ev.result.firstInAt,
          lastOutAt: ev.result.lastOutAt,
          workedMinutes: ev.result.workedMinutes,
          lateMinutes: ev.result.lateMinutes,
          earlyExitMinutes: ev.result.earlyExitMinutes,
          overtimeMinutes: ev.result.overtimeMinutes,
          isLate: ev.result.isLate,
          isEarlyExit: ev.result.isEarlyExit,
          dayValue: ev.result.dayValue,
          final: ev.result.final,
          flagged: ev.flagReason !== null,
          flagReason: ev.flagReason,
          regularised: ev.punches.some((p) => p.source === 'REGULARISED'),
          punchCount: ev.punches.length,
        };
      })
      .filter((day): day is NonNullable<typeof day> => day !== null);

    const count = (...s: string[]) => days.filter((x) => s.includes(x.status)).length;
    return {
      employee: {
        id: employee.id,
        employeeCode: employee.employeeCode,
        fullName: `${employee.firstName} ${employee.lastName}`,
      },
      from,
      to,
      days,
      totals: {
        present: count('PRESENT'),
        late: count('LATE'),
        halfDay: count('HALF_DAY'),
        absent: count('ABSENT'),
        onLeave: count('ON_LEAVE'),
        overtimeMinutes: days.reduce((sum, x) => sum + x.overtimeMinutes, 0),
      },
    };
  }

  /** Everything about one day: the punches, the evidence and the rule outcome. */
  async dayDetail(employeeId: string, date: string, user: AuthenticatedUser) {
    const employee = await this.assertCanSee(employeeId, user);
    const now = this.clock.now();
    const evals = await this.evaluate([employee], date, date, now);
    const ev = evals.get(`${employeeId}|${date}`);
    if (!ev) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'No attendance for that day.' });
    }

    const regularisations = await this.prisma.scoped.regularisationRequest.findMany({
      where: { employeeId, attendanceDate: d(date) },
      orderBy: { createdAt: 'desc' },
    });

    const { result, ctx } = ev;
    return {
      employee: {
        id: employee.id,
        employeeCode: employee.employeeCode,
        fullName: `${employee.firstName} ${employee.lastName}`,
      },
      date,
      office: { id: ctx.office.id, name: ctx.office.name, timezone: ctx.office.timezone },
      shift: ctx.shift,
      policy: ctx.policyRow
        ? { name: ctx.policyRow.name, ...ctx.policy }
        : { name: 'Built-in defaults', ...ctx.policy },
      dayType: ctx.weeklyOff
        ? 'WEEKLY_OFF'
        : ctx.holiday
          ? 'HOLIDAY'
          : ctx.leave
            ? 'LEAVE'
            : 'WORKING',
      holidayName: ctx.holiday?.name ?? null,
      result: { ...result, status: result.notInYet ? 'NOT_IN' : result.status },
      punches: ev.punches.map((p) => ({
        id: p.id,
        type: p.type,
        source: p.source,
        punchedAt: p.punchedAt,
        isFlagged: p.isFlagged,
        flagReason: p.flagReason,
        distanceM: p.distanceM,
        withinGeofence: p.withinGeofence,
        accuracyM: p.accuracyM,
        ipAddress: p.ipAddress,
        ipAllowed: p.ipAllowed,
        hasSelfie: Boolean(p.selfieDocumentId),
        note: p.note,
        // A raw punch that a regularisation has replaced.
        superseded: !effectivePunches(ev.punches).some(
          (e) => e.type === p.type && e.at.getTime() === p.punchedAt.getTime(),
        ),
      })),
      regularisations,
    };
  }

  /** The selfie behind a punch, for the people entitled to see that attendance. */
  async openSelfie(punchId: string, user: AuthenticatedUser) {
    const punch = await this.prisma.scoped.punch.findFirst({
      where: { id: punchId },
      select: { employeeId: true, selfieDocumentId: true },
    });
    if (!punch?.selfieDocumentId) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'No selfie for that punch.' });
    }
    // Your own selfie is yours; anyone else's needs attendance.view over them.
    if (punch.employeeId !== user.employeeId) {
      await this.assertCanSee(punch.employeeId, user);
    }
    return this.files.openForDownload(punch.selfieDocumentId);
  }
}

/** First and last day of a "YYYY-MM" month. */
export function monthBounds(month: string): { from: string; to: string } {
  const [year, mm] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, mm, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}
