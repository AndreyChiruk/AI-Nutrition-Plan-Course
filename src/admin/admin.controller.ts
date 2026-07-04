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
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
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
  pendingMeals() {
    return this.adminService.getPendingMeals();
  }

  @Get('meals/:id')
  getMeal(@Param('id') id: string) {
    return this.adminService.getMealById(id);
  }

  @Put('meals/:id/correct')
  correctMeal(
    @Param('id') id: string,
    @Body()
    body: { items: Array<Record<string, unknown>>; adminNote?: string; adminId?: number },
  ) {
    return this.adminService.correctMeal(id, body as never);
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
  getProducts() {
    return this.adminService.getProducts();
  }

  @Get('ingredients')
  getIngredients(
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.adminService.listIngredients({
      category,
      search,
      limit: Number(limit ?? 100),
      offset: Number(offset ?? 0),
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

  @Post('products/import-public')
  importPublicProducts(@Query('limit') limit?: string) {
    return this.adminService.importPublicProducts(Number(limit ?? 24));
  }

  @Post('products/backfill-ingredients')
  backfillIngredients() {
    return this.adminService.backfillProductIngredients();
  }

  @Post('products/replace-catalog-themealdb')
  replaceCatalogTheMealDb(
    @Query('perCategory') perCategory?: string,
    @Query('delayMs') delayMs?: string,
    @Query('ingredientDetails') ingredientDetails?: string,
  ) {
    return this.adminService.replaceCatalogFromTheMealDb({
      perCategory: Number(perCategory ?? 200),
      delayMs: Number(delayMs ?? 120),
      withIngredientDetails: ingredientDetails === '1' || ingredientDetails === 'true',
    });
  }

  @Post('products/localize-catalog-ru')
  localizeCatalogRu() {
    return this.adminService.localizeCatalogToRussian();
  }

  @Post('products/ai-localize-batch')
  aiLocalizeBatch(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('onlyMissingDetailed') onlyMissingDetailed?: string,
  ) {
    return this.adminService.aiLocalizeCatalogBatch({
      limit: Number(limit ?? 10),
      offset: Number(offset ?? 0),
      onlyMissingDetailed: onlyMissingDetailed === '1' || onlyMissingDetailed === 'true',
    });
  }

  @Post('products/ai-localize-all')
  aiLocalizeAll(
    @Query('batchSize') batchSize?: string,
    @Query('delayMs') delayMs?: string,
    @Query('onlyMissingDetailed') onlyMissingDetailed?: string,
  ) {
    return this.adminService.aiLocalizeCatalogAll({
      batchSize: Number(batchSize ?? 10),
      delayMs: Number(delayMs ?? 300),
      onlyMissingDetailed: onlyMissingDetailed === '1' || onlyMissingDetailed === 'true',
    });
  }

  @Post('products/:id/ai-localize')
  aiLocalizeById(@Param('id') id: string) {
    return this.adminService.aiLocalizeProductById(id);
  }
}
