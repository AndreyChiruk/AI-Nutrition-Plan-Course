import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { resolveJwtSecret } from '../common/jwt.config';
import { Notification } from '../models/Notification';
import { User } from '../models/User';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { FullUserGuard } from '../auth/full-user.guard';

@Module({
  imports: [
    SequelizeModule.forFeature([Notification, User]),
    JwtModule.register({ secret: resolveJwtSecret() }),
  ],
  controllers: [NotificationsController],
  providers: [FullUserGuard, NotificationsService, JwtAuthGuard],
  exports: [NotificationsService],
})
export class NotificationsModule {}
