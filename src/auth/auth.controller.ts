import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('email/send-code')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  sendEmailCode(
    @Body() body: { email: string; purpose: 'register' | 'login' | 'reset_password' },
  ) {
    return this.authService.sendEmailCode(body.email, body.purpose);
  }

  @Post('register')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  register(@Body() body: Record<string, never>) {
    return this.authService.register(body as never);
  }

  @Post('login')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  login(
    @Body()
    body: { email: string; password?: string; code?: string },
  ) {
    if (body.code?.trim()) {
      return this.authService.loginWithEmailCode(body.email, body.code);
    }
    if (!body.password) {
      throw new BadRequestException('Укажите пароль или код из письма');
    }
    return this.authService.login(body.email, body.password);
  }

  @Post('password-reset')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  resetPassword(
    @Body() body: { email: string; code: string; newPassword: string },
  ) {
    return this.authService.resetPassword(body.email, body.code, body.newPassword);
  }

  @Post('refresh')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refresh(body.refreshToken);
  }
}
