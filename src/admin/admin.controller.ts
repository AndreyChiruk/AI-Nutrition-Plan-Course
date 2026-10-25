import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { validate } from '../common/input-validation.pipe';
import { AdminService } from './admin.service';
import { OpenAiBillingService } from './openai-billing.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly openAiBillingService: OpenAiBillingService,
  ) {}

  @Get('users')
  getUsers(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.adminService.getUsers(Number(limit ?? 20), Number(offset ?? 0));
  }

  @Get('users/:id')
  getUser(@Param('id') id: string) {
    return this.adminService.getUser(id);
  }

  @Post('users')
  createUser(
    @Body()
    body: {
      email: string;
      password: string;
      role?: 'guest' | 'user' | 'admin';
      height?: number;
      weight?: number;
      gender?: 'male' | 'female';
      birthDate?: string;
      goal?: 'lose' | 'maintain' | 'gain';
      targetWeight?: number;
      activityLevel?: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
      avatarUrl?: string;
    },
  ) {
    return this.adminService.createUser(body);
  }

  @Post('users/:id/block')
  blockUser(@Param('id') id: string) {
    return this.adminService.blockUser(id);
  }

  @Post('users/:id/unblock')
  unblockUser(@Param('id') id: string) {
    return this.adminService.unblockUser(id);
  }

  @Patch('users/:id')
  updateUser(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.adminService.updateUser(id, body);
  }

  @Delete('users/:id')
  deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  @Get('meals/pending')
  pendingMeals(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.adminService.getPendingMeals({
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get('meals/:id')
  getMeal(@Param('id') id: string) {
    return this.adminService.getMealById(id);
  }

  @Put('meals/:id/correct')
  correctMeal(
    @Req() req: Request & { user?: { sub?: number } },
    @Param('id') id: string,
    @Body()
    body: { items: Array<Record<string, unknown>>; adminNote?: string },
  ) {
    const dto = validate<{ items?: Array<Record<string, unknown>>; adminNote?: string }>(body, {
      items: { type: 'array', default: [] },
      adminNote: { type: 'string', maxLength: 2000 },
    });
    return this.adminService.correctMeal(id, {
      items: dto.items ?? [],
      adminNote: dto.adminNote,
      adminId: req.user?.sub,
    });
  }

  @Delete('meals/:id/reject')
  rejectMeal(@Param('id') id: string) {
    return this.adminService.rejectMeal(id);
  }

  @Post('meals/:id/confirm')
  confirmMeal(@Param('id') id: string) {
    return this.adminService.confirmMeal(id);
  }

  @Get('stats/overview')
  overview() {
    return this.adminService.overviewStats();
  }

  @Get('openai/billing')
  openAiBilling() {
    return this.openAiBillingService.getSnapshot();
  }

  @Get('stats/users')
  usersStats() {
    return this.adminService.usersStats();
  }

  @Get('stats/recognition')
  recognitionStats() {
    return this.adminService.recognitionStats();
  }

  @Get('stats/meals')
  mealsStats() {
    return this.adminService.mealsStats();
  }

  @Get('base-recommendations')
  getBaseRecommendations() {
    return this.adminService.getBaseRecommendations();
  }

  @Post('base-recommendations')
  createBaseRecommendation(@Body() body: Record<string, unknown>) {
    return this.adminService.createBaseRecommendation(body as never);
  }

  @Put('base-recommendations/:id')
  updateBaseRecommendation(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.adminService.updateBaseRecommendation(id, body as never);
  }

  @Delete('base-recommendations/:id')
  deleteBaseRecommendation(@Param('id') id: string) {
    return this.adminService.deleteBaseRecommendation(id);
  }

  @Get('products')
  getProducts(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('search') search?: string,
    @Query('category') category?: string,
  ) {
    return this.adminService.getProducts({
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      search,
      category,
    });
  }

  @Post('products')
  createProduct(@Body() body: Record<string, unknown>) {
    return this.adminService.createProduct(body as never);
  }

  @Put('products/:id')
  updateProduct(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.adminService.updateProduct(id, body as never);
  }

  @Delete('products/:id')
  deleteProduct(@Param('id') id: string) {
    return this.adminService.deleteProduct(id);
  }

  @Post('products/:id/ai-localize')
  aiLocalizeById(@Param('id') id: string) {
    return this.adminService.aiLocalizeProductById(id);
  }
}
