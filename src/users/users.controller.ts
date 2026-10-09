import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { assertUserAccess } from '../auth/request-access.util';
import { UsersService } from './users.service';
import { FullUserGuard } from '../auth/full-user.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { MAX_IMAGE_BYTES } from '../common/image-validation.util';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard, FullUserGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  getById(@Req() req: Request & { user?: { sub?: number; role?: string } }, @Param('id') id: string) {
    assertUserAccess(req.user, id);
    return this.usersService.getById(id);
  }

  @Patch(':id/profile')
  updateProfile(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    assertUserAccess(req.user, id);
    return this.usersService.updateProfile(id, body as never);
  }

  @Post(':id/avatar')
  uploadAvatar(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('id') id: string,
    @Body() body: { avatarUrl: string },
  ) {
    assertUserAccess(req.user, id);
    return this.usersService.uploadAvatar(id, body.avatarUrl);
  }

  @Patch(':id/allergies')
  setAllergies(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('id') id: string,
    @Body() body: { allergenIds: string[] },
  ) {
    assertUserAccess(req.user, id);
    return this.usersService.setAllergies(id, body.allergenIds);
  }

  @Get(':id/fridge')
  listFridgeItems(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('id') id: string,
  ) {
    assertUserAccess(req.user, id);
    return this.usersService.listFridgeItems(id);
  }

  /** Каких продуктов из рецепта не хватает в холодильнике. */
  @Post(':id/fridge/missing')
  missingFridge(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('id') id: string,
    @Body() body: { ingredients?: Array<{ name: string; grams?: number }> },
  ) {
    assertUserAccess(req.user, id);
    return this.usersService.missingFridgeIngredients(id, body?.ingredients ?? []);
  }

  @Post(':id/fridge')
  addFridgeItem(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('id') id: string,
    @Body() body: { name: string; quantity?: number; unit?: string; expiresAt?: string | null },
  ) {
    assertUserAccess(req.user, id);
    return this.usersService.addFridgeItem(id, body);
  }

  @Patch(':id/fridge/:itemId')
  updateFridgeItem(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: { name?: string; quantity?: number; unit?: string; expiresAt?: string | null },
  ) {
    assertUserAccess(req.user, id);
    return this.usersService.updateFridgeItem(id, itemId, body);
  }

  @Delete(':id/fridge/:itemId')
  deleteFridgeItem(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    assertUserAccess(req.user, id);
    return this.usersService.deleteFridgeItem(id, itemId);
  }

  /**
   * Загрузка фотографии продукта.
   *
   * Принимает multipart/form-data с полем `image`. Файл проверяется
   * по содержимому (JPEG/PNG/WebP, до 8 МБ), уменьшается и сохраняется
   * в том; в БД пишется публичный путь.
   *
   * Валидация внутри сервиса, а не в multer: так ошибки формата
   * возвращают понятный текст на русском, а не общее сообщение.
   */
  @Post(':id/fridge/:itemId/image')
  @UseInterceptors(
    FileInterceptor('image', {
      // Храним в памяти: файл всё равно перекодируется перед записью,
      // а временные файлы на диске не нужны.
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_BYTES },
    }),
  )
  uploadFridgeImage(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    assertUserAccess(req.user, id);
    if (!file?.buffer) {
      throw new BadRequestException('Файл не получен: ожидается поле «image».');
    }
    return this.usersService.setFridgeImage(id, itemId, file.buffer, file.originalname);
  }

  /** Удаление фотографии: возвращает заглушку по категории. */
  @Delete(':id/fridge/:itemId/image')
  deleteFridgeImage(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    assertUserAccess(req.user, id);
    return this.usersService.clearFridgeImage(id, itemId);
  }

  @Get(':id/calories')
  calculateCalories(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('id') id: string,
  ) {
    assertUserAccess(req.user, id);
    return this.usersService.calculateBmrAndCalories(id);
  }

  @Post(':id/block')
  @Roles('admin')
  blockUser(@Param('id') id: string) {
    return this.usersService.blockUser(id);
  }

  @Post(':id/change-password')
  changePassword(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('id') id: string,
    @Body() body: { oldPassword: string; newPassword: string },
  ) {
    assertUserAccess(req.user, id);
    return this.usersService.changePassword(id, body.oldPassword, body.newPassword);
  }

  @Post('allergens')
  @Roles('admin')
  createAllergen(@Body() body: Record<string, unknown>) {
    return this.usersService.createAllergen(body as never);
  }

  @Get('allergens/list')
  getAllergens() {
    return this.usersService.getAllergens();
  }

  @Patch('allergens/:id')
  @Roles('admin')
  updateAllergen(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.usersService.updateAllergen(id, body as never);
  }

  @Delete('allergens/:id')
  @Roles('admin')
  deleteAllergen(@Param('id') id: string) {
    return this.usersService.deleteAllergen(id);
  }
}
