import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const role = (request as Request & { user?: { role?: string } }).user?.role;
    if (role !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
