import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UsePipes,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  acceptInviteSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  type AcceptInviteInput,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type ResetPasswordInput,
} from '@opsvera/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AuthService, type RequestMeta } from './auth.service';
import { REFRESH_COOKIE, TokenService } from './token.service';

/** Auth routes are rate limited harder than the rest of the API. */
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiBody({ schema: { example: { email: 'you@example.com', password: '••••••••' } } })
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(
    @Body() body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(body, meta(req));
    this.tokens.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange the refresh cookie for a new access token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) {
      throw new BadRequestException({
        code: 'REFRESH_MISSING',
        message: 'No session to refresh. Sign in again.',
      });
    }
    const result = await this.auth.refresh(token, meta(req));
    this.tokens.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    this.tokens.clearRefreshCookie(res);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(202)
  @ApiOperation({ summary: 'Email a password reset link' })
  @UsePipes(new ZodValidationPipe(forgotPasswordSchema))
  async forgotPassword(@Body() body: ForgotPasswordInput) {
    await this.auth.forgotPassword(body);
    // Always the same answer, so this cannot be used to discover accounts.
    return { message: 'If that address has an account, a reset link is on its way.' };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('reset-password')
  @HttpCode(204)
  @ApiOperation({ summary: 'Set a new password using a reset token' })
  @UsePipes(new ZodValidationPipe(resetPasswordSchema))
  async resetPassword(@Body() body: ResetPasswordInput) {
    await this.auth.resetPassword(body);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('accept-invite')
  @HttpCode(204)
  @ApiOperation({ summary: 'First sign-in: set a password from an invitation' })
  @UsePipes(new ZodValidationPipe(acceptInviteSchema))
  async acceptInvite(@Body() body: AcceptInviteInput) {
    await this.auth.acceptInvite(body);
  }

  @Post('change-password')
  @HttpCode(204)
  @ApiOperation({ summary: 'Change your own password' })
  @UsePipes(new ZodValidationPipe(changePasswordSchema))
  async changePassword(@CurrentUser() user: AuthenticatedUser, @Body() body: ChangePasswordInput) {
    await this.auth.changePassword(user, body);
  }

  @Get('me')
  @ApiOperation({ summary: 'The signed-in user, their permissions and data scopes' })
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.sessionUser(user);
  }
}

function meta(req: Request): RequestMeta {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
    requestId: (req as Request & { requestId?: string }).requestId ?? null,
  };
}
