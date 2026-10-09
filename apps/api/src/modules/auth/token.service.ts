import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { runUnscoped } from '../../prisma/tenant-context';
import type {
  AccessTokenPayload,
  RefreshTokenPayload,
} from '../../common/types/authenticated-user';

export const REFRESH_COOKIE = 'opsvera_rt';

interface IssueOptions {
  userId: string;
  companyId: string;
  employeeId: string | null;
  roleId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}

/**
 * Access and refresh tokens.
 *
 * The access token is short-lived (15 min) and travels in the Authorization
 * header. The refresh token travels only in an httpOnly cookie, is stored
 * hashed, and is rotated on every use: presenting a token that has already been
 * rotated revokes the whole family, which is how a stolen cookie is detected.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** SHA-256: the raw token only ever exists in the cookie. */
  static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  static randomToken(): string {
    return randomBytes(48).toString('base64url');
  }

  async issueAccessToken(options: IssueOptions): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: options.userId,
      cid: options.companyId,
      eid: options.employeeId,
      rid: options.roleId,
    };
    return this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get<string>('JWT_ACCESS_TTL') ?? '15m',
    });
  }

  async issueRefreshToken(options: IssueOptions): Promise<string> {
    const jti = randomUUID();
    const ttl = this.config.get<string>('JWT_REFRESH_TTL') ?? '7d';

    const token = await this.jwt.signAsync(
      { sub: options.userId, cid: options.companyId, jti } satisfies RefreshTokenPayload,
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: ttl,
      },
    );

    const decoded = this.jwt.decode(token) as { exp: number };

    await runUnscoped(() =>
      this.prisma.refreshToken.create({
        data: {
          id: jti,
          companyId: options.companyId,
          userId: options.userId,
          tokenHash: TokenService.hash(token),
          expiresAt: new Date(decoded.exp * 1000),
          userAgent: options.userAgent?.slice(0, 300) ?? null,
          ipAddress: options.ipAddress ?? null,
        },
      }),
    );

    return token;
  }

  /**
   * Verifies a refresh token and consumes it.
   *
   * Reuse of an already-revoked token is treated as theft: every live token for
   * that user is revoked, forcing a fresh sign-in.
   */
  async consumeRefreshToken(token: string): Promise<RefreshTokenPayload> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException({
        code: 'REFRESH_INVALID',
        message: 'Your session has expired. Sign in again.',
      });
    }

    const stored = await runUnscoped(() =>
      this.prisma.refreshToken.findUnique({ where: { id: payload.jti } }),
    );

    const invalid =
      !stored ||
      stored.tokenHash !== TokenService.hash(token) ||
      stored.expiresAt.getTime() < Date.now();

    if (stored?.revokedAt) {
      await this.revokeAllForUser(payload.sub);
      throw new UnauthorizedException({
        code: 'REFRESH_REUSED',
        message: 'This session was signed out. Sign in again.',
      });
    }

    if (invalid) {
      throw new UnauthorizedException({
        code: 'REFRESH_INVALID',
        message: 'Your session has expired. Sign in again.',
      });
    }

    await runUnscoped(() =>
      this.prisma.refreshToken.update({
        where: { id: payload.jti },
        data: { revokedAt: new Date() },
      }),
    );

    return payload;
  }

  async revoke(jti: string): Promise<void> {
    await runUnscoped(() =>
      this.prisma.refreshToken.updateMany({
        where: { id: jti, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await runUnscoped(() =>
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
  }

  setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.config.get<string>('COOKIE_SECURE') === 'true',
      sameSite: 'lax',
      domain: this.config.get<string>('COOKIE_DOMAIN') || undefined,
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure: this.config.get<string>('COOKIE_SECURE') === 'true',
      sameSite: 'lax',
      domain: this.config.get<string>('COOKIE_DOMAIN') || undefined,
      path: '/api/v1/auth',
    });
  }
}
