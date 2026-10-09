import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { BodyAnalysis } from '../models/BodyAnalysis';
import { User } from '../models/User';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BodyAnalysisController } from './body-analysis.controller';
import { BodyAnalysisService } from './body-analysis.service';
import { OpenAiModule } from '../openai/openai.module';
import { resolveJwtSecret } from '../common/jwt.config';
import { FullUserGuard } from '../auth/full-user.guard';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [
    SubscriptionModule,
    SequelizeModule.forFeature([BodyAnalysis, User]),
    JwtModule.register({
      secret: resolveJwtSecret(),
    }),
    OpenAiModule,
  ],
  providers: [FullUserGuard, BodyAnalysisService, JwtAuthGuard],
  controllers: [BodyAnalysisController],
})
export class BodyAnalysisModule {}
