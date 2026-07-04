import { Injectable } from '@nestjs/common';
import { createLogger, transports, Logger } from 'winston';

@Injectable()
export class LoggerService {
    private logger: Logger;
    constructor() {
        this.logger = createLogger({
            transports: [
                new transports.Console(),
                new transports.File({ filename: 'log-main.log' }),
            ],
        });
    }
    info(message: string, context?: string) {
        this.logger.info(message, { context });
    }
    error(message: string, trace?: string, context?: string) {
        this.logger.error(message, { trace, context });
    }
}
