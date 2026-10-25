import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter | null;

  constructor() {
    const host = process.env.SMTP_HOST?.trim();
    const port = Number(process.env.SMTP_PORT ?? 587);
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS?.trim();
    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
    } else {
      this.transporter = null;
    }
  }

  async sendVerificationCode(to: string, code: string, subject: string) {
    if (!this.transporter) {
      throw new ServiceUnavailableException(
        // Текст для пользователя, а не для разработчика:
        // раньше здесь перечислялись переменные .env, что ничего
        // не говорит человеку на экране регистрации.
        'Не удалось отправить код на почту. Попробуйте ещё раз через минуту или войдите по паролю.',
      );
    }

    const from = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER || 'noreply@localhost';
    const text = `Ваш код подтверждения: ${code}\n\nКод действует 15 минут.`;
    const html = `<p>Ваш код подтверждения: <strong>${code}</strong></p><p>Код действует 15 минут.</p>`;

    try {
      await this.transporter.sendMail({
        from,
        to,
        subject,
        text,
        html,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Ошибка SMTP при отправке на ${to}: ${reason}`);
      // Наружу — понятное сообщение. Причина сбоя уже записана
      // в лог строкой выше и видна администратору.
      throw new ServiceUnavailableException(
        'Не удалось отправить код на почту. Проверьте адрес и попробуйте ещё раз через минуту.',
      );
    }
  }
}
