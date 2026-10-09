import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { HealthController } from './health.controller';

@Module({
  imports: [SequelizeModule.forFeature([])],
  controllers: [HealthController],
})
export class HealthModule {}
