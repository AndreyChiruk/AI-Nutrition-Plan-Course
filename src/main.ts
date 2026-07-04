import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import dotenv from 'dotenv';
import { AppModule } from './app.module';
import { LoggerService } from './logger/logger.service';

dotenv.config();

function corsOrigins(): string[] {
    const raw = process.env.CORS_ORIGINS?.trim();
    if (raw) {
        return raw.split(',').map((o) => o.trim()).filter(Boolean);
    }
    return ['http://localhost:5173', 'https://localhost', 'http://localhost'];
}

async function start() {
    const logger = new LoggerService();
    const PORT = process.env.PORT || 3000;
    const BODY_LIMIT = process.env.JSON_BODY_LIMIT?.trim() || '35mb';
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        bodyParser: false,
    });
    app.use(express.json({ limit: BODY_LIMIT }));
    app.use(express.urlencoded({ limit: BODY_LIMIT, extended: true }));
    const prefix = process.env.GLOBAL_API_PREFIX?.trim();
    if (prefix) {
        app.setGlobalPrefix(prefix);
    }
    if (process.env.TRUST_PROXY === '1') {
        app.set('trust proxy', 1);
    }
    app.enableCors({
        origin: corsOrigins(),
        credentials: true,
    });
    await app.listen(PORT, '0.0.0.0', () => {
        logger.info(`Server listening on 0.0.0.0:${PORT}`, 'main.ts');
    });
}

start();
