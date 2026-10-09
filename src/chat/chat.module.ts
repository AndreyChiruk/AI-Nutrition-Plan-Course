import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Allergen } from '../models/Allergen';
import { ChatMessage } from '../models/ChatMessage';
import { User } from '../models/User';
import { OpenAiModule } from '../openai/openai.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { resolveJwtSecret } from '../common/jwt.config';
import { FullUserGuard } from '../auth/full-user.guard';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [
    SubscriptionModule,
    SequelizeModule.forFeature([ChatMessage, User, Allergen]),
    JwtModule.register({
      secret: resolveJwtSecret(),
    }),
    OpenAiModule,
  ],
  controllers: [ChatController],
  providers: [FullUserGuard, ChatService, JwtAuthGuard, RolesGuard],
})
export class ChatModule {}
