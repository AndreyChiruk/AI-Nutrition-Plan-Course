import { ForbiddenException } from '@nestjs/common';

type RequestUser = {
  sub?: number | string;
  role?: string;
};

export const assertUserAccess = (requestUser: RequestUser | undefined, userId: string) => {
  if (!requestUser) {
    throw new ForbiddenException('Access denied');
  }
  if (requestUser.role === 'admin') {
    return;
  }
  if (String(requestUser.sub) !== String(userId)) {
    throw new ForbiddenException('Access denied for this userId');
  }
};
