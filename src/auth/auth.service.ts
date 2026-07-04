import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/sequelize';
import { createHash } from 'crypto';
import { MailService } from '../mail/mail.service';
import { EmailVerificationCode, EmailCodePurpose } from '../models/EmailVerificationCode';
import { User, UserRole } from '../models/User';

type RegisterPayload = {
  email: string;
  password: string;
  emailCode: string;
  role?: UserRole;
  height: number;
  weight: number;
  gender: 'male' | 'female';
  birthDate: Date;
  goal: 'lose' | 'maintain' | 'gain';
  targetWeight?: number;
  activityLevel:
    | 'sedentary'
    | 'light'
    | 'moderate'
    | 'active'
    | 'very_active';
};

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(EmailVerificationCode)
    private readonly emailCodeModel: typeof EmailVerificationCode,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  async sendEmailCode(email: string, purpose: EmailCodePurpose) {
    const normalized = this.normalizeEmail(email);
    const user = await this.userModel.findOne({
      where: { email: normalized },
      attributes: ['id'],
    });

    if (purpose === 'register' && user) {
      throw new BadRequestException('User already exists');
    }
    if (purpose !== 'register' && !user) {
      throw new BadRequestException('User not found');
    }

    await this.emailCodeModel.destroy({
      where: { email: normalized, purpose },
    });

    const plain = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const subject =
      purpose === 'register'
        ? 'Регистрация — код подтверждения'
        : purpose === 'login'
          ? 'Вход — код подтверждения'
          : 'Сброс пароля — код';

    await this.mailService.sendVerificationCode(normalized, plain, subject);

    await this.emailCodeModel.create({
      email: normalized,
      purpose,
      codeHash: this.hash(plain),
      expiresAt,
    } as never);

    const mailDebug = process.env.MAIL_DEBUG === 'true';
    return {
      ok: true,
      message: 'Код отправлен на email',
      ...(mailDebug ? { devCode: plain } : {}),
    };
  }

  private async verifyAndConsume(
    email: string,
    purpose: EmailCodePurpose,
    plainCode: string,
  ) {
    const normalized = this.normalizeEmail(email);
    const record = await this.emailCodeModel.findOne({
      where: { email: normalized, purpose },
      order: [['createdAt', 'DESC']],
    });
    if (!record || new Date(record.expiresAt) < new Date()) {
      throw new BadRequestException('Неверный или просроченный код');
    }
    if (record.codeHash !== this.hash(plainCode.trim())) {
      throw new BadRequestException('Неверный или просроченный код');
    }
    await record.destroy();
  }

  async register(payload: RegisterPayload) {
    if (!payload.emailCode?.trim()) {
      throw new BadRequestException('Требуется код из письма');
    }

    const normalized = this.normalizeEmail(payload.email);
    await this.verifyAndConsume(normalized, 'register', payload.emailCode);

    const exists = await this.userModel.findOne({
      where: { email: normalized },
      attributes: ['id', 'email'],
    });
    if (exists) {
      throw new BadRequestException('User already exists');
    }

    const user = await this.userModel.create(
      {
        email: normalized,
        password: this.hash(payload.password),
        role: payload.role ?? 'user',
        height: payload.height ?? 170,
        weight: payload.weight ?? 70,
        gender: payload.gender ?? 'male',
        birthDate: payload.birthDate ?? new Date('1995-01-01'),
        goal: payload.goal ?? 'maintain',
        targetWeight: payload.targetWeight,
        activityLevel: payload.activityLevel ?? 'moderate',
      } as never,
    );

    return this.issueTokens(user);
  }

  async login(email: string, password: string) {
    const normalized = this.normalizeEmail(email);
    const user = await this.userModel.findOne({
      where: { email: normalized },
      attributes: ['id', 'email', 'password', 'role', 'isBlocked'],
    });
    if (!user || user.password !== this.hash(password)) {
      throw new UnauthorizedException('Wrong email or password');
    }
    if (user.isBlocked) {
      throw new ForbiddenException('User is blocked');
    }
    return this.issueTokens(user);
  }

  async loginWithEmailCode(email: string, code: string) {
    const normalized = this.normalizeEmail(email);
    await this.verifyAndConsume(normalized, 'login', code);
    const user = await this.userModel.findOne({
      where: { email: normalized },
      attributes: ['id', 'email', 'password', 'role', 'isBlocked'],
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    if (user.isBlocked) {
      throw new ForbiddenException('User is blocked');
    }
    return this.issueTokens(user);
  }

  async resetPassword(email: string, code: string, newPassword: string) {
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('Пароль должен быть не короче 6 символов');
    }
    const normalized = this.normalizeEmail(email);
    await this.verifyAndConsume(normalized, 'reset_password', code);
    const user = await this.userModel.findOne({ where: { email: normalized } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    await user.update({ password: this.hash(newPassword) } as never);
    return { ok: true };
  }

  async refresh(refreshToken: string) {
    const payload = this.jwtService.verify(refreshToken) as {
      sub: number;
      type?: string;
    };
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Refresh token invalid');
    }
    const user = await this.userModel.findByPk(payload.sub, {
      attributes: ['id', 'email', 'role', 'refreshTokenHash', 'isBlocked'],
    });
    if (!user) throw new UnauthorizedException('Refresh token invalid');
    if (user.isBlocked) {
      throw new ForbiddenException('User is blocked');
    }
    if (!user.refreshTokenHash || user.refreshTokenHash !== this.hash(refreshToken)) {
      throw new UnauthorizedException('Refresh token invalid');
    }
    return this.issueTokens(user as User);
  }

  private async issueTokens(user: User) {
    const accessToken = this.jwtService.sign(
      { sub: user.id, role: user.role, email: user.email },
      { expiresIn: '15m' },
    );
    const refreshToken = this.jwtService.sign(
      { sub: user.id, role: user.role, type: 'refresh' },
      { expiresIn: '7d' },
    );
    try {
      await user.update({
        lastActiveAt: new Date(),
        refreshTokenHash: this.hash(refreshToken),
      } as never);
    } catch {
      try {
        await user.update({ refreshTokenHash: this.hash(refreshToken) } as never);
      } catch {
        try {
          await user.update({ lastActiveAt: new Date() } as never);
        } catch {

        }
      }
    }

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
}
