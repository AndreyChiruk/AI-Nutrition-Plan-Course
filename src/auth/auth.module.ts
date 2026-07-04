import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from '../models/User';
import { EmailVerificationCode } from '../models/EmailVerificationCode';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthBootstrapService } from './auth.bootstrap.service';
import { AuthService } from './auth.service';

@Module({
  imports: [
    MailModule,
    SequelizeModule.forFeature([User, EmailVerificationCode]),
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'dev-secret',
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthBootstrapService],
  exports: [JwtModule],
})
export class AuthModule {}
