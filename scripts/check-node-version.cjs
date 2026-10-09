#!/usr/bin/env node
/**
 * Проверка версии Node перед запуском тестов.
 *
 * Актуальная версия — 22 (см. .nvmrc): именно она используется в Docker-образе,
 * поэтому расхождение с ней может дать разное поведение.
 *
 * Начиная с Node 26 требуется исправление встроенного в mocha пакета yargs
 * (его CommonJS-шим без расширения .cjs разбирается как ES-модуль).
 * Это исправление применяется автоматически в scripts/mocha-register.cjs,
 * поэтому Node 26+ поддерживается, но о нестандартной версии сообщаем.
 */
const major = Number(process.versions.node.split('.')[0]);
const MIN = 20;
const RECOMMENDED = 22;

if (major < MIN) {
  console.error(
    `\nNode.js ${process.versions.node} не поддерживается. Требуется Node ${MIN}+.\n` +
      `Рекомендуется Node ${RECOMMENDED} (см. .nvmrc) — как в Docker-образе.\n`,
  );
  process.exit(1);
}

if (major !== RECOMMENDED) {
  console.warn(
    `\nВнимание: используется Node ${process.versions.node}, а рекомендуется ${RECOMMENDED}.\n` +
      `На Node 26+ применяется автоматическое исправление yargs (см. scripts/mocha-register.cjs).\n`,
  );
}
