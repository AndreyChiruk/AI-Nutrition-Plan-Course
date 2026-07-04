import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { BodyAnalysis } from '../models/BodyAnalysis';
import { User } from '../models/User';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BodyAnalysisController } from './body-analysis.controller';
import { BodyAnalysisService } from './body-analysis.service';
import { OpenAiModule } from '../openai/openai.module';

@Module({
  imports: [
    SequelizeModule.forFeature([BodyAnalysis, User]),
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'dev-secret',
    }),
    OpenAiModule,
  ],
  providers: [BodyAnalysisService, JwtAuthGuard],
  controllers: [BodyAnalysisController],
})
export class BodyAnalysisModule {}
