import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { SequelizeModule } from '@nestjs/sequelize';
import { User } from '../models/User';
import { Allergen } from '../models/Allergen';
import { FridgeItem } from '../models/FridgeItem';
import { Ingredient } from '../models/Ingredient';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';

@Module({
  controllers: [UsersController],
  providers: [UsersService, JwtAuthGuard, RolesGuard],
  imports: [
    SequelizeModule.forFeature([User, Allergen, FridgeItem, Ingredient]),
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'dev-secret',
    }),
  ],
  exports: [UsersService],
})
export class UsersModule {}
