import 'reflect-metadata';
import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AdminService } from '../admin/admin.service';

dotenv.config();

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const admin = app.get(AdminService);
    const per = Number(process.argv[2] ?? process.env.THEMEALDB_PER_CATEGORY ?? '200');
    const delay = Number(process.argv[3] ?? process.env.THEMEALDB_DELAY_MS ?? '120');
    const withIngredientDetails = process.env.THEMEALDB_INGREDIENT_DETAILS === '1';
    const result = await admin.replaceCatalogFromTheMealDb({
      perCategory: per,
      delayMs: delay,
      withIngredientDetails,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await app.close();
  }
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
