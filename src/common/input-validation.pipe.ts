import { BadRequestException } from '@nestjs/common';
import { sanitize, Schema, ValidationError } from './sanitize';

/**
 * Обёртка над `sanitize()`, превращающая `ValidationError` в HTTP 400.
 *
 * Проект не использует class-validator (осознанно: без лишних зависимостей),
 * поэтому схемы описываются явно в контроллерах/сервисах:
 *
 *   const dto = validate<RegisterDto>(body, {
 *     email: { type: 'string', required: true, email: true },
 *     password: { type: 'string', required: true, minLength: 6, maxLength: 128 },
 *   });
 */
export function validate<T extends Record<string, unknown>>(input: unknown, schema: Schema): T {
  try {
    return sanitize<T>(input, schema);
  } catch (e) {
    if (e instanceof ValidationError) {
      throw new BadRequestException(e.message);
    }
    throw e;
  }
}
