/**
 * Генерация документации по API из исходного кода контроллеров.
 *
 * Зачем: в проекте не было документации эндпоинтов (Swagger не подключён),
 * поэтому состав и назначение маршрутов приходилось выяснять чтением кода.
 * Подключать Swagger ради курсового проекта — лишняя зависимость, а
 * рукописная документация быстро устаревает.
 *
 * Скрипт разбирает `@Controller`/`@Get`/`@Post`/... вместе с ближайшими
 * декораторами `@UseGuards` и `@Throttle`, а также комментариями, и
 * формирует `docs/API.md`. Источник — сам код, поэтому расхождений нет.
 *
 * Запуск: npm run docs:api
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

type Route = {
  method: string;
  path: string;
  controller: string;
  guards: string[];
  throttle?: string;
  description?: string;
};

const SRC = join(process.cwd(), 'src');
const OUT_DIR = join(process.cwd(), 'docs');
const OUT_FILE = join(OUT_DIR, 'API.md');

/** Рекурсивно собирает .ts файлы. */
function listFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'tests') continue;
      listFiles(full, acc);
    } else if (entry.name.endsWith('.controller.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

/** Извлекает описание из ближайшего блока комментария перед строкой. */
function commentBefore(lines: string[], index: number): string | undefined {
  const out: string[] = [];
  for (let i = index - 1; i >= 0 && i >= index - 30; i--) {
    const line = lines[i].trim();
    if (line.startsWith('@') || line === '') {
      if (out.length > 0) break;
      continue;
    }
    if (line.startsWith('*') || line.startsWith('/*')) {
      const text = line.replace(/^\/\*\*?/, '').replace(/\*\/$/, '').replace(/^\*/, '').trim();
      if (text) out.unshift(text);
      continue;
    }
    if (line.startsWith('//')) {
      out.unshift(line.replace(/^\/\//, '').trim());
      continue;
    }
    break;
  }
  if (out.length === 0) return undefined;
  // Первое предложение — самое информативное.
  const text = out.join(' ').replace(/\s+/g, ' ').trim();
  const firstSentence = text.split(/(?<=\.)\s/)[0];
  return firstSentence.length > 4 ? firstSentence : undefined;
}

function parseController(file: string): Route[] {
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const routes: Route[] = [];

  const controllerName = file.split('/').pop()?.replace('.controller.ts', '') ?? '';

  // Базовый путь контроллера
  const ctrlMatch = src.match(/@Controller\(([^)]*)\)/);
  const base = ctrlMatch ? ctrlMatch[1].replace(/['"`]/g, '').trim() : '';

  // Guard-ы уровня контроллера (до объявления класса)
  const classIndex = src.search(/\bclass\s+\w+/);
  const header = classIndex >= 0 ? src.slice(0, classIndex) : src;
  const ctrlGuards = [...header.matchAll(/@UseGuards\(([^)]*)\)/g)]
    .flatMap((m) => m[1].split(',').map((g) => g.trim()))
    .filter(Boolean);

  const methodRe = /@(Get|Post|Put|Patch|Delete)\(([^)]*)\)/;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(methodRe);
    if (!m) continue;

    const method = m[1].toUpperCase();
    const rawPath = m[2].replace(/['"`]/g, '').trim();
    const path = rawPath ? `${base}/${rawPath}` : base;
    const normalized = (path.startsWith('/') ? path : `/${path}`).replace(/\/+/g, '/');

    // Ищем guard-ы/троттлинг до конца объявления метода
    const guards = [...ctrlGuards];
    let throttle: string | undefined;
    for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
      const line = lines[j];
      if (/^\s*(async\s+)?[a-zA-Z_$][\w$]*\s*\(/.test(line)) break;
      const g = line.match(/@UseGuards\(([^)]*)\)/);
      if (g) guards.push(...g[1].split(',').map((x) => x.trim()).filter(Boolean));
      const t = line.match(/@Throttle\(\{\s*default:\s*\{\s*ttl:\s*([\d_]+),\s*limit:\s*(\d+)/);
      if (t) throttle = `${t[2]} запросов / ${Number(t[1].replace(/_/g, '')) / 1000} с`;
    }

    routes.push({
      method,
      path: normalized,
      controller: controllerName,
      guards: [...new Set(guards)],
      throttle,
      description: commentBefore(lines, i),
    });
  }

  return routes;
}

function main() {
  const files = [join(SRC, 'main.ts'), ...listFiles(SRC)].filter((f) => existsSync(f));
  const routes = listFiles(SRC).flatMap(parseController);

  // Группировка по контроллеру
  const byController = new Map<string, Route[]>();
  for (const r of routes) {
    const list = byController.get(r.controller) ?? [];
    list.push(r);
    byController.set(r.controller, list);
  }

  const total = routes.length;
  const publicRoutes = routes.filter((r) => !r.guards.includes('JwtAuthGuard')).length;

  const out: string[] = [];
  out.push('# API');
  out.push('');
  out.push(
    'Документация сгенерирована из исходного кода контроллеров командой `npm run docs:api`. ' +
      'При изменении маршрутов файл нужно перегенерировать — это исключает расхождения между кодом и описанием.',
  );
  out.push('');
  out.push(`Всего эндпоинтов: **${total}**, из них без авторизации: **${publicRoutes}**.`);
  out.push('');
  out.push('Базовый префикс: `/api` (задаётся переменной `GLOBAL_API_PREFIX`).');
  out.push('');
  out.push('## Заголовки');
  out.push('');
  out.push('| Заголовок | Назначение |');
  out.push('|---|---|');
  out.push('| `Authorization: Bearer <accessToken>` | Доступ к защищённым маршрутам |');
  out.push('| `Content-Type: application/json` | Тело запроса |');
  out.push('');
  out.push('## Ограничения');
  out.push('');
  out.push(
    '- Платные вызовы OpenAI (распознавание еды, анализ тела) ограничены по частоте: ' +
      'защита бюджета от массовых запросов.',
  );
  out.push('- Тело запроса — не более 12 МБ; изображения проверяются и сжимаются на сервере.');
  out.push('');
  out.push('## Проверка работоспособности');
  out.push('');
  out.push('| Метод | Путь | Назначение |');
  out.push('|---|---|---|');
  out.push('| GET | `/api/health` | Процесс жив (без обращения к БД) |');
  out.push('| GET | `/api/health/ready` | Готовность: проверяет доступность БД, при сбое 503 |');
  out.push('');

  const names = [...byController.keys()].sort((a, b) => a.localeCompare(b, 'en'));
  out.push('## Эндпоинты по разделам');
  out.push('');
  out.push('| Раздел | Эндпоинтов |');
  out.push('|---|---|');
  for (const name of names) {
    out.push(`| ${name} | ${byController.get(name)!.length} |`);
  }
  out.push('');

  for (const name of names) {
    const list = byController.get(name)!.sort((a, b) => a.path.localeCompare(b.path, 'en'));
    out.push(`### ${name}`);
    out.push('');
    out.push('| Метод | Путь | Доступ | Описание |');
    out.push('|---|---|---|---|');
    for (const r of list) {
      const access = r.guards.includes('JwtAuthGuard')
        ? r.guards.includes('AdminGuard')
          ? 'админ'
          : r.guards.includes('FullUserGuard')
            ? 'пользователь'
            : 'авторизация'
        : 'публичный';
      const desc = [r.description, r.throttle ? `_Ограничение: ${r.throttle}_` : '']
        .filter(Boolean)
        .join(' ');
      out.push(`| ${r.method} | \`${r.path}\` | ${access} | ${desc || '—'} |`);
    }
    out.push('');
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, out.join('\n'), 'utf8');

  console.log(`Документация записана: ${OUT_FILE}`);
  console.log(`  эндпоинтов: ${total} (публичных: ${publicRoutes})`);
  console.log(`  контроллеров: ${names.length}`);
}

main();
