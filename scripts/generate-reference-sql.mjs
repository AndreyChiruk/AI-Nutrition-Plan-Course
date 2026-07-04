import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const esc = (s) => String(s).replace(/'/g, "''");

const A = ['', ' с овощами', ' с зеленью', ' с йогуртом', ' с ягодами', ' с семенами'];
const lunchPairs = [
  ['Куриная грудка', 'рис отварной'],
  ['Индейка', 'гречка'],
  ['Лосось', 'киноа'],
  ['Треска', 'брокколи на пару'],
  ['Фасоль с овощами', 'кускус'],
  ['Тофу обжаренный', 'лапша соба'],
  ['Куриное филе', 'булгур'],
  ['Индейка', 'кабачки'],
  ['Рыба минтай', 'рис с овощами'],
  ['Говядина тушёная', 'перловка'],
  ['Куриные котлеты на пару', 'пюре'],
  ['Мидии', 'паста твердых сортов'],
  ['Боул с лососем', 'авокадо'],
  ['Куриное бедро', 'картофель запечённый'],
  ['Треска', 'цветная капуста'],
];
const B = ['Куриная грудка', 'Индейка', 'Рыба запечённая', 'Тофу', 'Говядина', 'Фасоль', 'Чечевица'];
const garnishes = ['рис', 'гречка', 'киноа', 'перловка', 'паста из нута', 'булгур'];
const breakfastNames = [
  'Овсянка на молоке',
  'Овсянка на воде',
  'Гречка с молоком',
  'Рисовая каша',
  'Пшенная каша',
  'Сырники запечённые',
  'Творог 5%',
  'Творог 2%',
  'Омлет белковый',
  'Омлет с овощами',
  'Скрэмбл',
  'Тост с авокадо',
  'Смузи боул',
  'Гранола с йогуртом',
  'Запеканка творожная',
  'Шакшука',
  'Чиа-пудинг',
  'Йогурт с мюсли',
  'Овсянка протеиновая',
  'Яйцо пашот',
  'Ролл с лососем',
  'Суши с огурцом',
  'Бутерброд с индейкой',
  'Оладьи овсяные',
  'Запеканка овсяная',
  'Блины гречневые',
  'Каша из полбы',
  'Ролл с тунцом',
  'Мюсли с молоком',
  'Каша кукурузная',
  'Омлет с ветчиной',
  'Бутерброды с рыбой',
  'Драники картофельные',
  'Сырники из творога',
  'Тост с арахисовой пастой',
  'Бутерброд творожный',
];
const dinnerNames = [
  'Запечённая рыба с овощами',
  'Котлеты куриные с салатом',
  'Стейк индейки с брокколи',
  'Треска с цветной капустой',
  'Тефтели в томате',
  'Плов на говядине',
  'Чечевица с овощами',
  'Салат Цезарь с курицей',
  'Салат Греческий',
  'Овощное карри с тофу',
  'Запечённый картофель с рыбой',
  'Борщ без сметаны',
  'Суп куриный с лапшой',
  'Пицца тонкая с курицей',
  'Рататуй',
  'Баклажаны с мясом',
  'Лосось с брокколи',
  'Куриное филе в духовке',
  'Овощная запеканка',
  'Судак на пару',
  'Шашлык из курицы с овощами гриль',
  'Жаркое из курицы',
  'Рыбные фрикадельки',
  'Тыква запечённая',
  'Уха лёгкая',
  'Суп-пюре из тыквы',
  'Лазанья с индейкой',
  'Паста с морепродуктами',
  'Креветки с овощами',
  'Голубцы лёгкие',
  'Тушённая говядина с гречкой',
  'Салат с тунцом',
  'Салат с авокадо',
  'Пицца с овощами',
  'Овощное рагу с фасолью',
];
const snacks = [
  ['Йогурт греческий', ['молоко']],
  ['Творог 2% с бананом', ['молоко']],
  ['Яблоко + горсть орехов', ['орехи']],
  ['Батончик протеиновый', ['молоко', 'орехи']],
  ['Творожок с ягодами', ['молоко']],
  ['Смузи ягодный', []],
  ['Тост с арахисовой пастой', ['арахис']],
  ['Морковь с хумусом', ['сезам']],
  ['Сырки творожные', ['молоко']],
  ['Сухофрукты + орехи', ['орехи']],
  ['Кефир + банан', ['молоко']],
  ['Фрукт + кефир', ['молоко']],
  ['Сыр + крекеры', ['молоко', 'глютен']],
  ['Эддамаме', ['соя']],
  ['Миндаль горсть', ['орехи']],
  ['Финики', []],
  ['Апельсин + миндаль', ['орехи']],
  ['Вафли протеиновые', ['глютен', 'молоко']],
  ['Коктейль молочный', ['молоко']],
  ['Печенье овсяное', ['глютен']],
  ['Орехи + сухофрукты', ['орехи']],
  ['Кешью горсть', ['орехи']],
];

let sql = `-- Справочные данные каталога блюд (PostgreSQL). Сгенерировано scripts/generate-reference-sql.mjs\n`;

sql += `CREATE TABLE IF NOT EXISTS ref_dish_modifiers (id SERIAL PRIMARY KEY, suffix VARCHAR(255) NOT NULL, sort_index INTEGER NOT NULL DEFAULT 0);\n`;
sql += `CREATE TABLE IF NOT EXISTS ref_breakfast_names (id SERIAL PRIMARY KEY, base_name VARCHAR(240) NOT NULL, sort_index INTEGER NOT NULL);\n`;
sql += `CREATE TABLE IF NOT EXISTS ref_lunch_pairs (id SERIAL PRIMARY KEY, protein_part VARCHAR(200) NOT NULL, garnish_part VARCHAR(200) NOT NULL, sort_index INTEGER NOT NULL);\n`;
sql += `CREATE TABLE IF NOT EXISTS ref_lunch_proteins (id SERIAL PRIMARY KEY, name VARCHAR(200) NOT NULL, sort_index INTEGER NOT NULL);\n`;
sql += `CREATE TABLE IF NOT EXISTS ref_grain_garnishes (id SERIAL PRIMARY KEY, name VARCHAR(120) NOT NULL, sort_index INTEGER NOT NULL);\n`;
sql += `CREATE TABLE IF NOT EXISTS ref_dinner_names (id SERIAL PRIMARY KEY, name VARCHAR(300) NOT NULL, sort_index INTEGER NOT NULL);\n`;
sql += `CREATE TABLE IF NOT EXISTS ref_snacks (id SERIAL PRIMARY KEY, name VARCHAR(300) NOT NULL, allergens VARCHAR(100)[] NOT NULL DEFAULT '{}', sort_index INTEGER NOT NULL);\n`;

sql += `TRUNCATE ref_dish_modifiers, ref_breakfast_names, ref_lunch_pairs, ref_lunch_proteins, ref_grain_garnishes, ref_dinner_names, ref_snacks RESTART IDENTITY CASCADE;\n`;

sql +=
  'INSERT INTO ref_dish_modifiers (suffix, sort_index) VALUES ' +
  A.map((s, i) => `('${esc(s)}',${i})`).join(',') +
  ';\n';

sql +=
  'INSERT INTO ref_breakfast_names (base_name, sort_index) VALUES ' +
  breakfastNames.map((n, i) => `('${esc(n)}',${i})`).join(',') +
  ';\n';

sql +=
  'INSERT INTO ref_lunch_pairs (protein_part, garnish_part, sort_index) VALUES ' +
  lunchPairs.map(([a, b], i) => `('${esc(a)}','${esc(b)}',${i})`).join(',') +
  ';\n';

sql +=
  'INSERT INTO ref_lunch_proteins (name, sort_index) VALUES ' +
  B.map((n, i) => `('${esc(n)}',${i})`).join(',') +
  ';\n';

sql +=
  'INSERT INTO ref_grain_garnishes (name, sort_index) VALUES ' +
  garnishes.map((n, i) => `('${esc(n)}',${i})`).join(',') +
  ';\n';

sql +=
  'INSERT INTO ref_dinner_names (name, sort_index) VALUES ' +
  dinnerNames.map((n, i) => `('${esc(n)}',${i})`).join(',') +
  ';\n';

sql +=
  'INSERT INTO ref_snacks (name, allergens, sort_index) VALUES ' +
  snacks
    .map(([n, a], i) => {
      const arr = a.length ? `ARRAY[${a.map((x) => `'${esc(x)}'`).join(',')}]::varchar(100)[]` : `ARRAY[]::varchar(100)[]`;
      return `('${esc(n)}',${arr},${i})`;
    })
    .join(',') +
  ';\n';

const training = [
  [
    'session1',
    'Силовая: верх тела',
    'Базовые тяги и жимы, умеренная интенсивность.',
    45,
    ['Разминка 8 мин', 'Жим гантелей 3×12', 'Тяга блока 3×12', 'Разводки 3×15', 'Заминка'],
  ],
  [
    'session1',
    'HIIT кардио',
    'Интервалы 30/30 на дорожке или эллипсе.',
    25,
    ['Разминка 5 мин', '8 раундов интервала', 'Заминка 5 мин'],
  ],
  [
    'session1',
    'Круговая тренировка',
    '5 упражнений по кругу.',
    35,
    ['Берпи 40с', 'Планка 40с', 'Прыжки на ящик 40с', 'Бег на месте 40с', '4 круга'],
  ],
  [
    'session1',
    'Спина и кор',
    'Стабилизация и осанка.',
    40,
    ['Кошка-корова', 'Планка боковая', 'Супермен', 'Скручивания на фитболе'],
  ],
  [
    'session1',
    'Лёгкая зарядка',
    'Активация и мобильность.',
    20,
    ['Суставная гимнастика', 'Динамические растяжки', 'Кардио шаг 5 мин'],
  ],
  [
    'session2',
    'Ноги и ягодицы',
    'Приседы, выпады, тяга сумо.',
    50,
    ['Гоблет-присед 4×10', 'Выпады 3×12', 'Ягодичный мост 3×15', 'Икры 3×20'],
  ],
  [
    'session2',
    'Стабильность колена',
    'Контролируемые движения без прыжков.',
    35,
    ['Стульчик у стены', 'Шаг в сторону с резиной', 'Подъёмы на носки'],
  ],
  [
    'session2',
    'Беговая дорожка: темп',
    'Равномерный бег.',
    30,
    ['5 мин разминка', '18 мин рабочий темп', '5 мин заминка'],
  ],
  [
    'session2',
    'Велоэргометр интервалы',
    '4 блока по интенсивности.',
    35,
    ['2 мин лёгко', '6×(1 мин тяжело + 1 легко)', 'заминка'],
  ],
  [
    'session2',
    'Функциональный день',
    'Комплекс с акцентом на мощь.',
    40,
    ['Гири: махи', 'TRX тяга', 'Медбол слэмы', '3 подхода каждое'],
  ],
  [
    'session3',
    'Йога-флоу',
    'Плавные переходы, дыхание.',
    45,
    ['Приветствие солнцу ×4', 'Воины 1-2', 'Треугольник', 'Шавасана'],
  ],
  [
    'session3',
    'Мобильность и растяжка',
    'Миофасциальный релиз + стретчинг.',
    30,
    ['Валик грудной отдел', '90/90 бёдра', 'растяжка сгибателей бедра'],
  ],
  [
    'session3',
    'Плавание техника',
    'Кроль с доской.',
    40,
    ['200 м разминка', '6×50 м кроль', '100 заминка'],
  ],
  [
    'session3',
    'Кор и пресс',
    'Без сгибания поясницы.',
    25,
    ['Планка 3×45с', 'Дед-баг', 'Велосипед'],
  ],
  [
    'session3',
    'Пилатес мат',
    'Контроль корпуса.',
    40,
    ['The Hundred', 'Rolling', 'Single leg stretch'],
  ],
  [
    'session4',
    'Восстановительная прогулка',
    'Низкая интенсивность.',
    30,
    ['Шаг 30 мин в комфортном темпе'],
  ],
  [
    'session4',
    'Лёгкий домашний комплекс',
    'Без оборудования.',
    20,
    ['Отжимания от пола 3×12', 'Присед с весом тела 3×15', 'Планка 1 мин'],
  ],
  [
    'session4',
    'Эллипс средняя нагрузка',
    'Монотонное кардио.',
    35,
    ['25 мин устойчивый пульс 120–135'],
  ],
  [
    'session4',
    'Степ-платформа',
    'Упорядоченные шаги.',
    30,
    ['Разминка', 'комбинации базовый шаг', 'заминка'],
  ],
  [
    'session4',
    'Растяжка перед сном',
    'Пассивные удержания.',
    15,
    ['Шина на спине', 'клишоны', 'дыхание 4-7-8'],
  ],
];

sql += `\n-- Шаблоны тренировок: заполняем training_blocks только если пусто\n`;
sql += `DO $$\nBEGIN\n`;
sql += `  IF NOT EXISTS (SELECT 1 FROM "training_blocks" LIMIT 1) THEN\n`;
for (const [slot, title, descr, dmin, ex] of training) {
  const arr = `ARRAY[${ex.map((e) => `'${esc(e)}'`).join(',')}]::varchar[]`;
  sql += `    INSERT INTO "training_blocks" (id, slot, title, description, "durationMin", exercises, "createdAt", "updatedAt") VALUES `;
  sql += `(gen_random_uuid(), '${esc(slot)}', '${esc(title)}', '${esc(descr)}', ${dmin}, ${arr}, NOW(), NOW());\n`;
}
sql += `  END IF;\nEND $$;\n`;

const out = path.join(root, 'database', 'migrations', '001_reference_catalog.sql');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, sql);
console.log('Written', out);
