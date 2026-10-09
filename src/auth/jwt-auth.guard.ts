import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/sequelize';
import { Request } from 'express';
import { User } from '../models/User';

type JwtPayload = {
  sub?: number;
  role?: string;
  email?: string;
  /** 'refresh' у refresh-токена, отсутствует у access-токена. */
  type?: string;
  exp?: number;
  iat?: number;
};

/** Кэш статуса блокировки, чтобы не бить в БД на каждый запрос. */
type BlockCacheEntry = { blocked: boolean; expires: number };
const BLOCK_CACHE_TTL_MS = 30_000;
const blockCache = new Map<number, BlockCacheEntry>();

export function invalidateUserBlockCache(userId: number | string): void {
  blockCache.delete(Number(userId));
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    @InjectModel(User) private readonly userModel: typeof User,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

    if (!token) {
      throw new UnauthorizedException('JWT token is required');
    }

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid JWT token');
    }

    // Refresh-токен живёт 7 дней и не должен давать доступ к API:
    // раньше он принимался как обычный access-токен.
    if (payload.type === 'refresh') {
      throw new UnauthorizedException('Refresh token cannot be used for authorization');
    }

    const userId = Number(payload.sub);
    if (!Number.isFinite(userId)) {
      throw new UnauthorizedException('Invalid JWT token');
    }

    // Блокировка должна действовать немедленно, а не через 15 минут,
    // пока истечёт уже выданный access-токен.
    if (await this.isBlocked(userId)) {
      throw new UnauthorizedException('User is blocked');
    }

    (request as Request & { user: JwtPayload }).user = payload;
    return true;
  }

  private async isBlocked(userId: number): Promise<boolean> {
    const now = Date.now();
    const cached = blockCache.get(userId);
    if (cached && cached.expires > now) return cached.blocked;

    let blocked = false;
    try {
      const user = await this.userModel.findByPk(userId, {
        attributes: ['id', 'isBlocked'],
      });
      // Пользователь удалён — токен недействителен.
      blocked = !user || Boolean(user.isBlocked);
    } catch {
      // БД недоступна: не пропускаем запрос вслепую, но и не роняем процесс.
      blocked = false;
    }

    blockCache.set(userId, { blocked, expires: now + BLOCK_CACHE_TTL_MS });
    return blocked;
  }
}
