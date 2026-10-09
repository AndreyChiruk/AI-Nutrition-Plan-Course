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
import { resolveJwtSecret } from '../common/jwt.config';
import { FullUserGuard } from '../auth/full-user.guard';
import { FridgeImageStorage } from '../fridge/fridge-image.storage';

@Module({
  controllers: [UsersController],
  providers: [
    FridgeImageStorage,FullUserGuard, UsersService, JwtAuthGuard, RolesGuard],
  imports: [
    SequelizeModule.forFeature([User, Allergen, FridgeItem, Ingredient]),
    JwtModule.register({
      secret: resolveJwtSecret(),
    }),
  ],
  exports: [UsersService],
})
export class UsersModule {}
