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
    // Лимит тела запроса.
    //
    // Раньше по умолчанию было 35 МБ — с запасом на «сырой» base64 фотографии
    // любого размера. Теперь изображения проверяются и нормализуются на сервере
    // (`validateAndNormalizePhoto`: не более 8 МБ и уменьшение до 1600 px),
    // поэтому такой запас не нужен: он лишь позволял отправлять на сервер
    // десятки мегабайт мусора и нагружать память процесса.
    const BODY_LIMIT = process.env.JSON_BODY_LIMIT?.trim() || '12mb';
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        bodyParser: false,
    });
    // Stripe проверяет подпись по СЫРОМУ телу запроса. Обычный разбор JSON
    // меняет байты (порядок ключей, пробелы), и подпись перестаёт сходиться,
    // поэтому сохраняем исходный буфер в req.rawBody.
    app.use(
        express.json({
            limit: BODY_LIMIT,
            verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => {
                req.rawBody = buf;
            },
        }),
    );
    app.use(express.urlencoded({ limit: BODY_LIMIT, extended: true }));

    // Понятное сообщение при превышении лимита.
    // По умолчанию express отвечает «PayloadTooLargeError» без пояснений,
    // и пользователь не понимает, что делать.
    app.use(
        (
            err: { type?: string; status?: number },
            _req: express.Request,
            res: express.Response,
            next: express.NextFunction,
        ) => {
            if (err?.type === 'entity.too.large' || err?.status === 413) {
                res.status(413).json({
                    statusCode: 413,
                    error: 'Payload Too Large',
                    message:
                        `Слишком большое тело запроса (лимит ${BODY_LIMIT}). ` +
                        'Уменьшите размер фотографии — сервер принимает изображения до 8 МБ.',
                });
                return;
            }
            next(err);
        },
    );
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
