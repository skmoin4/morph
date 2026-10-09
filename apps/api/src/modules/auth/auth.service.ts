import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import type {
  AcceptInviteInput,
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  ResetPasswordInput,
  SessionUser,
} from '@opsvera/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { runUnscoped } from '../../prisma/tenant-context';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { TokenService } from './token.service';
import { UserPermissionsService } from './user-permissions.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';

/** After this many failed attempts the account locks for LOCK_MINUTES. */
const MAX_FAILED_ATTEMPTS = 8;
const LOCK_MINUTES = 15;
const RESET_TOKEN_TTL_MINUTES = 60;
const INVITE_TOKEN_TTL_HOURS = 72;

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly users: UserPermissionsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Email + password sign-in.
   *
   * Runs unscoped because the company is not known until the user is found —
   * which is also why `users.email` is unique globally rather than per company.
   */
  async login(input: LoginInput, meta: RequestMeta) {
    const user = await runUnscoped(() =>
      this.prisma.user.findFirst({
        where: { email: input.email, deletedAt: null },
        include: { employee: { select: { id: true } } },
      }),
    );

    // One message for "no such user" and "wrong password", so the response
    // cannot be used to enumerate accounts.
    const invalid = new UnauthorizedException({
      code: 'INVALID_CREDENTIALS',
      message: 'That email and password do not match.',
    });

    if (!user || !user.passwordHash) throw invalid;

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException({
        code: 'ACCOUNT_LOCKED',
        message: `Too many failed attempts. Try again after ${user.lockedUntil.toISOString().slice(11, 16)} UTC.`,
      });
    }

    const matches = await bcrypt.compare(input.password, user.passwordHash);
    if (!matches) {
      await this.registerFailedAttempt(user.id, user.failedLoginCount);
      throw invalid;
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        code: 'ACCOUNT_INACTIVE',
        message:
          user.status === 'INVITED'
            ? 'Accept your invitation email to set a password first.'
            : 'This account is suspended. Contact your administrator.',
      });
    }

    await runUnscoped(() =>
      this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
      }),
    );

    const issueOptions = {
      userId: user.id,
      companyId: user.companyId,
      employeeId: user.employee?.id ?? null,
      roleId: user.roleId,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.tokens.issueAccessToken(issueOptions),
      this.tokens.issueRefreshToken(issueOptions),
    ]);

    await this.audit.record({
      companyId: user.companyId,
      userId: user.id,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      summary: `${user.fullName} signed in`,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
    });

    return { accessToken, refreshToken, userId: user.id, companyId: user.companyId };
  }

  /** Rotates the refresh token and mints a new access token. */
  async refresh(refreshToken: string, meta: RequestMeta) {
    const payload = await this.tokens.consumeRefreshToken(refreshToken);

    const loaded = await this.users.load(payload.sub, payload.cid);
    if (!loaded || loaded.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        code: 'ACCOUNT_INACTIVE',
        message: 'Your account is no longer active.',
      });
    }

    const issueOptions = {
      userId: loaded.user.userId,
      companyId: loaded.user.companyId,
      employeeId: loaded.user.employeeId,
      roleId: loaded.user.roleId,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    };

    const [accessToken, nextRefreshToken] = await Promise.all([
      this.tokens.issueAccessToken(issueOptions),
      this.tokens.issueRefreshToken(issueOptions),
    ]);

    return { accessToken, refreshToken: nextRefreshToken };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    try {
      const payload = await this.tokens.consumeRefreshToken(refreshToken);
      await this.tokens.revoke(payload.jti);
    } catch {
      // Logging out with an already-dead token is a no-op, not an error.
    }
  }

  /**
   * Starts a password reset.
   *
   * Always reports success: whether an address has an account is not something
   * this endpoint will confirm.
   */
  async forgotPassword(input: ForgotPasswordInput): Promise<void> {
    const user = await runUnscoped(() =>
      this.prisma.user.findFirst({ where: { email: input.email, deletedAt: null } }),
    );

    if (!user || user.status === 'SUSPENDED') {
      this.logger.log(`Password reset requested for unknown address ${input.email}`);
      return;
    }

    const token = TokenService.randomToken();
    await runUnscoped(() =>
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          resetTokenHash: TokenService.hash(token),
          resetExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000),
        },
      }),
    );

    const url = `${this.config.get<string>('WEB_ORIGIN')}/reset-password?token=${token}`;
    await this.mail.send({
      to: user.email,
      subject: 'Reset your OPSVERA password',
      text: `Hello ${user.fullName},\n\nUse the link below to set a new password. It expires in ${RESET_TOKEN_TTL_MINUTES} minutes and can be used once.\n\n${url}\n\nIf you did not ask for this, you can ignore this email — your current password still works.`,
    });
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const user = await this.findByOneTimeToken('resetTokenHash', 'resetExpiresAt', input.token);
    const passwordHash = await this.hashPassword(input.password);

    await runUnscoped(() =>
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          resetTokenHash: null,
          resetExpiresAt: null,
          failedLoginCount: 0,
          lockedUntil: null,
          mustChangePassword: false,
          status: user.status === 'INVITED' ? 'ACTIVE' : user.status,
        },
      }),
    );

    // A password change invalidates every existing session.
    await this.tokens.revokeAllForUser(user.id);

    await this.audit.record({
      companyId: user.companyId,
      userId: user.id,
      action: 'UPDATE',
      entityType: 'User',
      entityId: user.id,
      summary: `${user.fullName} reset their password`,
    });
  }

  /** First sign-in from an invite: sets the password and activates the account. */
  async acceptInvite(input: AcceptInviteInput): Promise<void> {
    const user = await this.findByOneTimeToken('inviteTokenHash', 'inviteExpiresAt', input.token);
    const passwordHash = await this.hashPassword(input.password);

    await runUnscoped(() =>
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          inviteTokenHash: null,
          inviteExpiresAt: null,
          status: 'ACTIVE',
          mustChangePassword: false,
        },
      }),
    );

    await this.audit.record({
      companyId: user.companyId,
      userId: user.id,
      action: 'UPDATE',
      entityType: 'User',
      entityId: user.id,
      summary: `${user.fullName} accepted their invitation`,
    });
  }

  async changePassword(user: AuthenticatedUser, input: ChangePasswordInput): Promise<void> {
    const row = await runUnscoped(() =>
      this.prisma.user.findUniqueOrThrow({ where: { id: user.userId } }),
    );

    const matches =
      row.passwordHash && (await bcrypt.compare(input.currentPassword, row.passwordHash));
    if (!matches) {
      throw new BadRequestException({
        code: 'INVALID_CREDENTIALS',
        message: 'Your current password is not correct.',
        details: [{ path: 'currentPassword', message: 'Not correct' }],
      });
    }

    const passwordHash = await this.hashPassword(input.password);
    await runUnscoped(() =>
      this.prisma.user.update({
        where: { id: user.userId },
        data: { passwordHash, mustChangePassword: false },
      }),
    );
    await this.tokens.revokeAllForUser(user.userId);

    await this.audit.record({
      action: 'UPDATE',
      entityType: 'User',
      entityId: user.userId,
      summary: `${user.fullName} changed their password`,
      userId: user.userId,
    });
  }

  /** Sends (or re-sends) a login invitation. */
  async sendInvite(userId: string, invitedBy: AuthenticatedUser): Promise<void> {
    const user = await this.prisma.scoped.user.findUniqueOrThrow({ where: { id: userId } });

    const token = TokenService.randomToken();
    await this.prisma.scoped.user.update({
      where: { id: user.id },
      data: {
        inviteTokenHash: TokenService.hash(token),
        inviteExpiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_HOURS * 3_600_000),
        status: user.status === 'ACTIVE' ? 'ACTIVE' : 'INVITED',
      },
    });

    const url = `${this.config.get<string>('WEB_ORIGIN')}/accept-invite?token=${token}`;
    await this.mail.send({
      to: user.email,
      subject: 'Your OPSVERA account is ready',
      text: `Hello ${user.fullName},\n\n${invitedBy.fullName} has set up your OPSVERA account. Use the link below to choose a password and sign in. It expires in ${INVITE_TOKEN_TTL_HOURS} hours.\n\n${url}`,
    });

    await this.audit.record({
      action: 'UPDATE',
      entityType: 'User',
      entityId: user.id,
      summary: `Login invitation sent to ${user.email}`,
      userId: invitedBy.userId,
    });
  }

  /** The payload GET /auth/me returns — everything the shell needs to render. */
  async sessionUser(user: AuthenticatedUser): Promise<SessionUser> {
    const [company, employee] = await Promise.all([
      runUnscoped(() =>
        this.prisma.company.findUniqueOrThrow({
          where: { id: user.companyId },
          select: { name: true, currency: true, currencySymbol: true },
        }),
      ),
      user.employeeId
        ? this.prisma.scoped.employee.findUnique({
            where: { id: user.employeeId },
            select: {
              photoDocumentId: true,
              office: { select: { id: true, name: true, timezone: true } },
            },
          })
        : Promise.resolve(null),
    ]);

    return {
      id: user.userId,
      companyId: user.companyId,
      companyName: company.name,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: null,
      roleId: user.roleId,
      roleName: user.roleName,
      employeeId: user.employeeId,
      officeId: employee?.office.id ?? null,
      officeName: employee?.office.name ?? null,
      officeTimezone: employee?.office.timezone ?? 'Asia/Kolkata',
      currency: company.currencySymbol,
      permissions: [...user.permissions].sort(),
      scopes: Object.fromEntries(user.scopes),
    };
  }

  // -------------------------------------------------------------------------

  private async hashPassword(plain: string): Promise<string> {
    const rounds = Number(this.config.get<string>('BCRYPT_ROUNDS') ?? 10);
    return bcrypt.hash(plain, rounds);
  }

  private async registerFailedAttempt(userId: string, current: number): Promise<void> {
    const next = current + 1;
    await runUnscoped(() =>
      this.prisma.user.update({
        where: { id: userId },
        data: {
          failedLoginCount: next,
          lockedUntil:
            next >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      }),
    );
  }

  /**
   * Looks a user up by a single-use token. The token is compared by hash, and
   * the expiry is checked in the query so an expired row simply does not match.
   */
  private async findByOneTimeToken(
    hashField: 'resetTokenHash' | 'inviteTokenHash',
    expiryField: 'resetExpiresAt' | 'inviteExpiresAt',
    token: string,
  ) {
    const user = await runUnscoped(() =>
      this.prisma.user.findFirst({
        where: {
          [hashField]: TokenService.hash(token),
          [expiryField]: { gt: new Date() },
          deletedAt: null,
        },
      }),
    );

    if (!user) {
      throw new BadRequestException({
        code: 'TOKEN_INVALID',
        message: 'This link has expired or has already been used. Request a new one.',
      });
    }
    return user;
  }
}
