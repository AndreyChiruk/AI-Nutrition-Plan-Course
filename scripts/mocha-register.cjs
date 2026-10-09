/**
 * Подготовка окружения для mocha.
 *
 * Помимо загрузки .env и ts-node здесь исправляется несовместимость
 * встроенного в mocha пакета yargs с Node.js 26+.
 *
 * Проблема: файл-шим `node_modules/mocha/node_modules/yargs/yargs` написан
 * как CommonJS, но лежит в пакете с `"type": "module"` и НЕ имеет расширения
 * `.cjs`. Node 26 разбирает его как ES-модуль, и вызов `require()` внутри
 * падает с «require is not defined in ES module scope». На Node 20–24
 * поведение прежнее, поэтому Docker-образ собирается и работает.
 *
 * Решение: при старте создаём рядом копию `yargs.cjs` и указываем её
 * в экспортах пакета. Правка идемпотентна и не требует изменения версии Node.
 */
const fs = require('fs');
const path = require('path');

function patchYargsForModernNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 26) return;

  const yargsDir = path.resolve(__dirname, '..', 'node_modules', 'mocha', 'node_modules', 'yargs');
  const shim = path.join(yargsDir, 'yargs');
  const shimCjs = path.join(yargsDir, 'yargs.cjs');
  const pkgPath = path.join(yargsDir, 'package.json');

  try {
    if (!fs.existsSync(shim) || !fs.existsSync(pkgPath)) return;

    if (!fs.existsSync(shimCjs)) {
      fs.copyFileSync(shim, shimCjs);
    }

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const current = pkg.exports && pkg.exports['./yargs'];
    const alreadyPatched =
      Array.isArray(current) && current.some((e) => e && e.require === './yargs.cjs');

    if (!alreadyPatched) {
      pkg.exports = pkg.exports || {};
      pkg.exports['./yargs'] = [{ require: './yargs.cjs' }, './yargs.cjs'];
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    }
  } catch {
    // Если патч не удался — mocha сообщит о проблеме сама.
  }
}

patchYargsForModernNode();

require('dotenv').config({
  path: path.resolve(__dirname, '..', '.env'),
});
require('ts-node').register({
  project: path.resolve(__dirname, '..', 'tsconfig.test.json'),
  transpileOnly: true,
});
