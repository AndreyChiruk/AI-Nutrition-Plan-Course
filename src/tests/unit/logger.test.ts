import { assert } from 'chai';
import { describe, it, after, beforeEach } from 'mocha';
import { LoggerService } from '../../logger/logger.service';

describe('Проверка работы функций логера', function () {
    const logger = new LoggerService();
    let stdoutOutput: string = '';
    const originalStdoutWrite = process.stdout.write;

    beforeEach(function () {
        stdoutOutput = '';
        process.stdout.write = (chunk: string) => {
            stdoutOutput += chunk;
            return true;
        };
    });

    it('Проверка функции info на вывод сообщения', function () {
        logger.info(`test data info`, 'unit-module-info');
        assert.include(stdoutOutput, `test data info`);
        assert.include(stdoutOutput, `unit-module-info`);
    });

    it('Проверка функции error на вывод сообщения', function () {
        logger.error(`test data error`, 'unit-module-error');
        assert.include(stdoutOutput, `test data error`);
        assert.include(stdoutOutput, `unit-module-error`);
    });

    after(function () {
        process.stdout.write = originalStdoutWrite;
    });
});
