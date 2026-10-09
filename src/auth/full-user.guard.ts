import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class FullUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<
      Request & { user?: { role?: string } }
    >();
    const role = request.user?.role;
    if (role === 'guest') {
      throw new ForbiddenException(
        'Для аккаунта «Гость» доступен только раздел «Распознавание еды». Полный доступ назначает администратор.',
      );
    }
    return true;
  }
}
