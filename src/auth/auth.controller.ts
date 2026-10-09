import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthService, RegisterPayload } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { validate } from '../common/input-validation.pipe';

const EMAIL_PURPOSES = ['register', 'login', 'reset_password'] as const;

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('email/send-code')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  sendEmailCode(@Body() body: Record<string, unknown>) {
    const dto = validate<{ email: string; purpose: (typeof EMAIL_PURPOSES)[number] }>(body, {
      email: { type: 'string', required: true, email: true },
      purpose: { type: 'string', required: true, enum: EMAIL_PURPOSES },
    });
    return this.authService.sendEmailCode(dto.email, dto.purpose);
  }

  @Post('register')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  register(@Body() body: Record<string, unknown>) {
    // Схема работает как whitelist: всё, чего в ней нет (в первую очередь `role`),
    // отбрасывается ещё до вызова сервиса.
    const dto = validate<RegisterPayload>(body, {
      // Имя необязательно — при отсутствии подставится часть email.
      name: { type: 'string', maxLength: 120 },
      email: { type: 'string', required: true, email: true },
      password: { type: 'string', required: true, minLength: 6, maxLength: 128 },
      emailCode: { type: 'string', required: true, minLength: 4, maxLength: 12 },
      height: { type: 'number', min: 50, max: 280, default: 170 },
      weight: { type: 'number', min: 20, max: 500, default: 70 },
      gender: { type: 'string', enum: ['male', 'female'], default: 'male' },
      birthDate: { type: 'date', required: true },
      goal: { type: 'string', enum: ['lose', 'maintain', 'gain'], default: 'maintain' },
      targetWeight: { type: 'number', min: 20, max: 500 },
      activityLevel: {
        type: 'string',
        enum: ['sedentary', 'light', 'moderate', 'active', 'very_active'],
        default: 'moderate',
      },
    });
    // Отсекаем нереалистичные даты рождения (будущее, возраст > 120 лет).
    const years = (Date.now() - new Date(dto.birthDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    if (years < 0 || years > 120) {
      throw new BadRequestException('Поле «birthDate»: некорректная дата рождения');
    }
    return this.authService.register(dto);
  }

  @Post('login')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  login(@Body() body: Record<string, unknown>) {
    const dto = validate<{ email: string; password?: string; code?: string }>(body, {
      email: { type: 'string', required: true, email: true },
      password: { type: 'string', maxLength: 128 },
      code: { type: 'string', maxLength: 12 },
    });
    if (dto.code?.trim()) {
      return this.authService.loginWithEmailCode(dto.email, dto.code);
    }
    if (!dto.password) {
      throw new BadRequestException('Укажите пароль или код из письма');
    }
    return this.authService.login(dto.email, dto.password);
  }

  @Post('password-reset')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  resetPassword(@Body() body: Record<string, unknown>) {
    const dto = validate<{ email: string; code: string; newPassword: string }>(body, {
      email: { type: 'string', required: true, email: true },
      code: { type: 'string', required: true, minLength: 4, maxLength: 12 },
      newPassword: { type: 'string', required: true, minLength: 6, maxLength: 128 },
    });
    return this.authService.resetPassword(dto.email, dto.code, dto.newPassword);
  }

  @Post('refresh')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  refresh(@Body() body: Record<string, unknown>) {
    const dto = validate<{ refreshToken: string }>(body, {
      refreshToken: { type: 'string', required: true, maxLength: 4096 },
    });
    return this.authService.refresh(dto.refreshToken);
  }

  /**
   * Серверный выход: аннулирует refresh-токен в БД.
   * Раньше «выход» был только клиентским (удаление из localStorage),
   * поэтому украденный refresh-токен жил все 7 дней.
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  logout(@Req() req: Request & { user?: { sub?: number } }) {
    return this.authService.logout(req.user?.sub ?? 0);
  }
}
