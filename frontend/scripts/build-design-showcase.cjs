/**
 * Сборка визуального превью дизайна.
 *
 * Запуск: node scripts/build-design-showcase.cjs
 *
 * Зачем: показать обновлённый интерфейс целиком — все ключевые экраны
 * с реальными стилями приложения, но без запуска бэкенда. Скрипт берёт
 * собранный CSS и шрифты из `dist`, поэтому превью всегда соответствует
 * текущей сборке, а не отдельной «демонстрационной» вёрстке.
 */
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const OUT = path.join(__dirname, '..', '..', 'docs', 'design-showcase.html');

// Собираем весь CSS приложения в один блок
const assets = fs.readdirSync(path.join(DIST, 'assets'));
const cssFiles = assets.filter((f) => f.endsWith('.css'));
const appCss = cssFiles.map((f) => fs.readFileSync(path.join(DIST, 'assets', f), 'utf8')).join('\n');

// Шрифты встраиваем как base64, чтобы превью работало автономно
const fontsDir = path.join(DIST, 'assets');
const fontMap = {};
for (const f of assets.filter((x) => x.endsWith('.woff2'))) {
  const b64 = fs.readFileSync(path.join(fontsDir, f)).toString('base64');
  fontMap[`/assets/${f}`] = `data:font/woff2;base64,${b64}`;
}
let css = appCss;
for (const [url, data] of Object.entries(fontMap)) {
  css = css.split(`url(${url})`).join(`url(${data})`);
}

// ── Разметка экранов ───────────────────────────────────────────────────
// Каждый экран воспроизводит реальную структуру страницы приложения
// и использует те же классы, поэтому стили берутся из сборки.

const nav = [
  ['Главная', 'home', true],
  ['Холодильник', 'refrigerator', false],
  ['План питания', 'utensils', false],
  ['Мои планы', 'list', false],
  ['План тренировок', 'dumbbell', false],
  ['Статистика', 'chart', false],
  ['Рекомендации ИИ', 'sparkles', false],
  ['Профиль', 'user', false],
];

const icon = (name, size = 18) => {
  const paths = {
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    refrigerator: '<path d="M5 2h14a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M3 10h18"/><path d="M7 6v2"/><path d="M7 14v3"/>',
    utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
    list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    dumbbell: '<path d="m6.5 6.5 11 11"/><path d="m21 21-1-1"/><path d="m3 3 1 1"/><path d="m18 22 4-4"/><path d="m2 6 4-4"/><path d="m3 10 7-7"/><path d="m14 21 7-7"/>',
    chart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
    sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    arrow: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    chevron: '<polyline points="9 18 15 12 9 6"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
    trend: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
    scale: '<path d="M12 3v18"/><path d="m3 7 3-4 3 4"/><path d="m15 7 3-4 3 4"/><path d="M3 7h6"/><path d="M15 7h6"/><path d="M3 7a3 3 0 0 0 6 0"/><path d="M15 7a3 3 0 0 0 6 0"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
};

const sidebar = () => `
<aside class="sidebar">
  <div class="brand">Питание<span class="brand-dot">.</span></div>
  <nav>
    ${nav.map(([label, ic, active]) => `
      <a class="nav-item ${active ? 'active' : ''}">${icon(ic, 17)}<span>${label}</span></a>
    `).join('')}
  </nav>
</aside>`;

const topbar = (title) => `
<header class="topbar show">
  <div class="topbar-title">${title}</div>
  <div class="topbar-actions">
    <span class="avatar">АД</span>
  </div>
</header>`;

// ── 1. Главная ─────────────────────────────────────────────────────────
const SECTIONS = [
  ['utensils', 'План питания', 'Сборка рациона на 7–30 дней с расчётом КБЖУ по составу блюд.'],
  ['refrigerator', 'Мой холодильник', 'Продукты по категориям, сроки годности и список покупок.'],
  ['trend', 'Анализ тела', 'Замеры по зонам силуэта и прогноз изменения фигуры.'],
  ['sparkles', 'Распознавание еды', 'Фото блюда — состав, калории и предупреждения об аллергенах.'],
  ['dumbbell', 'План тренировок', 'Нагрузка согласована с целью по весу и с питанием.'],
  ['chart', 'Статистика', 'Динамика веса, калорий и тренировок по дням.'],
];

const screenDashboard = () => `
<div class="dashboard">
  <header class="dashboard-intro">
    <p class="eyebrow">Главная</p>
    <h1>Здравствуйте, Андрей</h1>
    <p class="lead">Планирование рациона, учёт продуктов и анализ прогресса — в одном месте.
    Расчёты строятся на составе блюд, а не на приблизительных оценках.</p>
  </header>
  <section class="section-grid">
    ${SECTIONS.map(([ic, title, text]) => `
      <a class="section-tile">
        <span class="section-tile-head">${icon(ic, 18)}<span class="section-tile-title">${title}</span></span>
        <span class="section-tile-text">${text}</span>
        <span class="section-tile-more">Перейти ${icon('arrow', 13)}</span>
      </a>`).join('')}
  </section>
</div>`;

// ── 2. Холодильник ─────────────────────────────────────────────────────
const FRIDGE = [
  ['Овощи', [['Картофель', '1.5', 'кг', null], ['Морковь', '400', 'г', 'ok'], ['Лук репчатый', '300', 'г', null]]],
  ['Молочные продукты', [['Творог', '400', 'г', 'soon'], ['Молоко', '900', 'мл', 'ok'], ['Сметана', '250', 'г', null]]],
  ['Крупы и мучное', [['Гречка', '800', 'г', null], ['Рис', '500', 'г', null], ['Мука пшеничная', '1', 'кг', 'exp']]],
];

const screenFridge = () => `
<div class="fridge-page">
  <header class="fridge-head">
    <div>
      <p class="eyebrow">Продукты</p>
      <h1>Мой холодильник</h1>
      <p class="muted">Продукты, которые уже есть дома. Планировщик отдаёт им приоритет,
      а на странице плана видно, чего не хватает для готовки.</p>
    </div>
    <a class="btn-secondary">К плану питания</a>
  </header>

  <section class="fridge-summary">
    <div class="fridge-stat"><span class="fridge-stat-value">9</span><span class="fridge-stat-label">продуктов</span></div>
    <div class="fridge-stat"><span class="fridge-stat-value">3</span><span class="fridge-stat-label">категории</span></div>
    <div class="fridge-stat is-warn"><span class="fridge-stat-value">1</span><span class="fridge-stat-label">скоро истекает</span></div>
  </section>

  <section class="card stack fridge-add">
    <div class="fridge-add-head">${icon('plus', 16)}<strong>Добавить продукт</strong></div>
    <div class="fridge-add-grid">
      <div class="fridge-name-field"><input type="text" placeholder="Начните вводить: гречка, куриная грудка…" value="Куриная грудка"></div>
      <input type="text" value="500">
      <select><option>г</option></select>
      <input type="date" value="2026-10-14">
      <button class="btn-primary">${icon('plus', 16)} Добавить</button>
    </div>
  </section>

  <div class="fridge-groups">
    ${FRIDGE.map(([cat, items]) => `
      <section class="fridge-group">
        <h2 class="fridge-group-title">${cat}<span class="fridge-group-count">${items.length}</span></h2>
        <ul class="fridge-items">
          ${items.map(([name, qty, unit, state]) => `
            <li class="fridge-item ${state === 'soon' ? 'is-expiring' : state === 'exp' ? 'is-expired' : ''}">
              <div class="fridge-item-main"><span class="fridge-item-name">${name}</span></div>
              <div class="fridge-item-qty">
                <span class="macro-value">${qty}</span><span class="muted small">${unit}</span>
                <button class="fridge-item-btn">${icon('pencil', 13)}</button>
              </div>
              ${state ? `<span class="fridge-item-expiry">${state === 'soon' ? '2 дн.' : state === 'exp' ? 'просрочен' : '12 дн.'}</span>` : ''}
              <button class="fridge-item-btn is-danger">${icon('trash', 14)}</button>
            </li>`).join('')}
        </ul>
      </section>`).join('')}
  </div>
</div>`;

// ── 3. План питания ────────────────────────────────────────────────────
const MEALS = [
  ['Завтрак', 'Сырники со сметаной', '511', 'Б 24.3 · Ж 21.8 · У 38.4'],
  ['Обед', 'Борщ украинский', '393', 'Б 18.2 · Ж 19.5 · У 29.1'],
  ['Ужин', 'Куриная грудка запечённая с овощами', '458', 'Б 42.6 · Ж 18.2 · У 21.4'],
  ['Перекус', 'Творог со сметаной и мёдом', '272', 'Б 22.1 · Ж 12.4 · У 16.8'],
];

const screenMealPlan = () => `
<div class="plan-surface">
  <header class="dashboard-intro">
    <p class="eyebrow">Питание</p>
    <h1>План питания</h1>
    <p class="lead">Рацион на 7 дней с расчётом по составу блюд.</p>
  </header>

  <section class="metrics plan-metrics">
    <div class="metric"><span class="metric-label">Цель</span><span class="metric-value">2 200</span><span class="metric-unit">ккал</span></div>
    <div class="metric"><span class="metric-label">В плане</span><span class="metric-value">2 184</span><span class="metric-unit">ккал</span></div>
    <div class="metric"><span class="metric-label">Белки</span><span class="metric-value">142</span><span class="metric-unit">г</span></div>
    <div class="metric"><span class="metric-label">Уникальных</span><span class="metric-value">28</span><span class="metric-unit">блюд</span></div>
  </section>

  <div class="meal-cards">
    ${MEALS.map(([slot, name, kcal, macros]) => `
      <article class="meal-row">
        <div class="meal-row-slot">${slot}</div>
        <div class="meal-row-body">
          <div class="meal-row-name">${name}</div>
          <div class="macro-row">
            <span class="macro-label">КБЖУ</span>
            <span class="macro-value">${macros}</span>
          </div>
        </div>
        <div class="meal-row-kcal"><span class="calorie-value">${kcal}</span><span class="meal-row-unit">ккал</span></div>
      </article>`).join('')}
  </div>

  <p class="meal-fridge-missing">${icon('cart', 14)} Докупить: <span class="meal-fridge-missing-list">морковь, лук, сметана</span></p>
</div>`;

// ── 4. Анализ тела ─────────────────────────────────────────────────────
const ZONES = [
  ['Грудь', '104.2 см', 'normal'],
  ['Талия', '82.4 см', 'normal'],
  ['Бёдра', '98.1 см', 'normal'],
  ['Плечо', '34.6 см', 'normal'],
];

const screenBody = () => {
  // Силуэт подключаем как data-URI: витрина должна работать автономно.
  const svgPath = path.join(DIST, 'silhouettes', 'body-front.svg');
  const svg = fs.readFileSync(svgPath, 'utf8');
  const uri = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  const mask = (color) =>
    `<span style="display:block;aspect-ratio:960/2195;width:150px;background:${color};` +
    `mask-image:url(&quot;${uri}&quot;);-webkit-mask-image:url(&quot;${uri}&quot;);` +
    `mask-repeat:no-repeat;mask-position:center;mask-size:contain;` +
    `-webkit-mask-repeat:no-repeat;-webkit-mask-position:center;-webkit-mask-size:contain"></span>`;

  return `
<div class="body-page">
  <header class="dashboard-intro">
    <p class="eyebrow">Прогресс</p>
    <h1>Анализ тела</h1>
    <p class="lead">Оценка состояния фигуры по ИМТ и прогноз изменения.</p>
  </header>

  <section class="card section-card">
    <div class="section-head"><h3>Показатели</h3></div>
    <div class="metric-strip">
      <div class="metric"><span class="metric-label">Вес</span><span class="metric-value">72.5</span><span class="metric-unit">кг</span></div>
      <div class="metric"><span class="metric-label">Рост</span><span class="metric-value">178</span><span class="metric-unit">см</span></div>
      <div class="metric"><span class="metric-label">ИМТ</span><span class="metric-value">22.9</span></div>
      <div class="metric"><span class="metric-label">Возраст</span><span class="metric-value">31</span><span class="metric-unit">лет</span></div>
    </div>
    <p class="muted small metric-hint">Норма · норма веса 58.6–78.9 кг · цель: поддерживать</p>
  </section>

  <section class="card section-card">
    <div class="section-head"><h3>Силуэт</h3></div>
    <p class="muted small">Цвет показывает состояние фигуры по ИМТ.</p>
    <div class="showcase-silhouettes">
      <div class="showcase-silhouette">
        ${mask('var(--zone-low)')}
        <span class="silhouette-current"><span class="silhouette-dot" style="background:var(--zone-low)"></span><strong>ниже нормы</strong></span>
        <span class="muted small">ИМТ 17.4</span>
      </div>
      <div class="showcase-silhouette">
        ${mask('var(--zone-normal)')}
        <span class="silhouette-current"><span class="silhouette-dot" style="background:var(--zone-normal)"></span><strong>норма</strong></span>
        <span class="muted small">ИМТ 22.9</span>
      </div>
      <div class="showcase-silhouette">
        ${mask('var(--zone-high)')}
        <span class="silhouette-current"><span class="silhouette-dot" style="background:var(--zone-high)"></span><strong>выше нормы</strong></span>
        <span class="muted small">ИМТ 28.1</span>
      </div>
    </div>
  </section>
</div>`;
};

// ── 5. Профиль / предпочтения ──────────────────────────────────────────
const screenProfile = () => `
<div class="profile-page">
  <header class="dashboard-intro">
    <p class="eyebrow">Настройки</p>
    <h1>Профиль</h1>
    <p class="lead">Данные профиля и предпочтения в питании.</p>
  </header>

  <section class="card section-card">
    <div class="section-head"><h3>Основное</h3></div>
    <div class="form-grid">
      <label>Имя<input type="text" value="Андрей"></label>
      <label>Дата рождения<input type="date" value="1994-03-18"></label>
      <label>Рост, см<input type="text" value="178"></label>
      <label>Вес, кг<input type="text" value="72.5"></label>
    </div>
  </section>

  <section class="card section-card">
    <div class="section-head"><h3>Предпочтения в еде</h3></div>
    <div class="form-grid">
      <div class="pref-picker pref-picker-like">
        <label class="pref-picker-label">Любимые продукты и блюда<span class="pref-picker-hint">выбираются из каталога</span></label>
        <ul class="pref-chips">
          <li class="pref-chip"><span class="pref-chip-type">П</span><span class="pref-chip-name">Гречка</span><button class="pref-chip-remove">×</button></li>
          <li class="pref-chip"><span class="pref-chip-type">П</span><span class="pref-chip-name">Куриная грудка</span><button class="pref-chip-remove">×</button></li>
          <li class="pref-chip"><span class="pref-chip-type">Б</span><span class="pref-chip-name">Сырники со сметаной</span><button class="pref-chip-remove">×</button></li>
        </ul>
        <div class="pref-search">
          <input type="text" placeholder="Начните вводить название…" value="твор">
        </div>
        <div class="pref-suggest">
          <button class="pref-suggest-item is-active"><span class="pref-suggest-name">Творог</span><span class="pref-suggest-meta">продукт · Молочные продукты</span></button>
          <button class="pref-suggest-item"><span class="pref-suggest-name">Творожная запеканка</span><span class="pref-suggest-meta">блюдо · breakfast</span></button>
        </div>
      </div>
      <div class="pref-picker pref-picker-dislike">
        <label class="pref-picker-label">Нежелательные продукты<span class="pref-picker-hint">не будут предлагаться</span></label>
        <ul class="pref-chips">
          <li class="pref-chip"><span class="pref-chip-type">П</span><span class="pref-chip-name">Майонез</span><button class="pref-chip-remove">×</button></li>
          <li class="pref-chip"><span class="pref-chip-type">П</span><span class="pref-chip-name">Грибы</span><button class="pref-chip-remove">×</button></li>
        </ul>
        <div class="pref-search"><input type="text" placeholder="Начните вводить название…"></div>
      </div>
    </div>
  </section>

  <section class="card section-card">
    <div class="section-head"><h3>Цель и план питания</h3></div>
    <div class="goal-cards">
      <button class="goal-card">${icon('trend', 18)}<span>Похудеть</span></button>
      <button class="goal-card active">${icon('scale', 18)}<span>Поддерживать</span></button>
      <button class="goal-card">${icon('dumbbell', 18)}<span>Набрать массу</span></button>
    </div>
  </section>
</div>`;

// ── 6. Кнопки, формы, таблица (элементы) ───────────────────────────────
const screenElements = () => `
<div class="elements-page">
  <header class="dashboard-intro">
    <p class="eyebrow">Основа</p>
    <h1>Элементы интерфейса</h1>
    <p class="lead">Кнопки, поля, таблицы и метки в едином стиле.</p>
  </header>

  <section class="card section-card">
    <div class="section-head"><h3>Кнопки</h3></div>
    <div class="btns">
      <button class="btn-primary">Сгенерировать план</button>
      <button class="btn-secondary">Настроить</button>
      <button class="btn-link-outline">Подробнее</button>
      <button class="btn-primary" disabled>Недоступно</button>
    </div>
  </section>

  <section class="card section-card">
    <div class="section-head"><h3>Поля ввода</h3></div>
    <div class="form-grid">
      <label>Целевая калорийность<input type="text" value="2200"></label>
      <label>Тип питания<select><option>Сбалансированное</option><option>Веганское</option></select></label>
      <label>Дата<input type="date" value="2026-10-08"></label>
      <label>Поиск<input type="search" placeholder="Найти блюдо…"></label>
    </div>
  </section>

  <section class="card section-card">
    <div class="section-head"><h3>Таблица блюд</h3></div>
    <table>
      <thead><tr><th>Блюдо</th><th>Категория</th><th>Кухня</th><th style="text-align:right">Ккал</th><th style="text-align:right">Белок</th></tr></thead>
      <tbody>
        <tr><td>Борщ украинский</td><td>Обед</td><td>Украинская</td><td class="mono" style="text-align:right">393</td><td class="mono" style="text-align:right">18.2</td></tr>
        <tr><td>Харчо с говядиной</td><td>Обед</td><td>Кавказская</td><td class="mono" style="text-align:right">442</td><td class="mono" style="text-align:right">21.6</td></tr>
        <tr><td>Плов с курицей</td><td>Обед</td><td>Среднеазиатская</td><td class="mono" style="text-align:right">585</td><td class="mono" style="text-align:right">24.1</td></tr>
        <tr><td>Сырники со сметаной</td><td>Завтрак</td><td>Русская</td><td class="mono" style="text-align:right">511</td><td class="mono" style="text-align:right">24.3</td></tr>
      </tbody>
    </table>
  </section>

  <section class="card section-card">
    <div class="section-head"><h3>Метки диет</h3></div>
    <div class="badges">
      <span class="badge badge-veg">веган</span>
      <span class="badge badge-veg">без глютена</span>
      <span class="badge badge-neutral">без лактозы</span>
      <span class="badge badge-warn">содержит рыбу</span>
    </div>
  </section>
</div>`;

const SCREENS = [
  ['Главная', screenDashboard()],
  ['Холодильник', screenFridge()],
  ['План питания', screenMealPlan()],
  ['Анализ тела', screenBody()],
  ['Профиль и предпочтения', screenProfile()],
  ['Элементы интерфейса', screenElements()],
];

const page = (title, body) => `
<div class="showcase-frame">
  <div class="showcase-caption">
    <span class="showcase-caption-index">${String(SCREENS.findIndex((s) => s[0] === title) + 1).padStart(2, '0')}</span>
    <span class="showcase-caption-title">${title}</span>
  </div>
  <div class="app-shell showcase-shell">
    ${sidebar()}
    ${topbar(title)}
    <main class="content">${body}</main>
  </div>
</div>`;

const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Дизайн проекта — все экраны</title>
<style>
${css}

/* ── Обёртка витрины (не часть приложения) ── */
body { background: var(--sand); }
.showcase { max-width: 1280px; margin: 0 auto; padding: 40px 24px 80px; }
.showcase-head { margin-bottom: 34px; }
.showcase-head h1 { font-family: var(--font-serif); font-size: 2.4rem; margin: 6px 0 8px; }
.showcase-frame { margin-bottom: 46px; }
.showcase-caption { display: flex; align-items: baseline; gap: 12px; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.showcase-caption-index { font-family: var(--font-mono); font-size: 0.82rem; color: var(--terracotta-dark); font-weight: 600; }
.showcase-caption-title { font-family: var(--font-serif); font-size: 1.3rem; font-weight: 600; }
.showcase-shell {
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--sand);
  min-height: 520px;
}
.showcase-shell .sidebar { display: flex !important; }
.showcase-shell .topbar.show { display: flex !important; }
.showcase-shell .content { display: block !important; }

/* Навигация витрины */
.nav-item { display: flex; align-items: center; gap: 9px; padding: 7px 10px; font-size: 0.87rem;
  color: var(--charcoal-soft); text-decoration: none; border-radius: var(--radius-md); }
.nav-item.active { background: rgba(180, 85, 45, 0.10); color: var(--terracotta-dark); font-weight: 600; }
.brand { font-family: var(--font-serif); font-size: 1.15rem; font-weight: 600; padding: 0 10px 16px; }
.brand-dot { color: var(--terracotta); }
.avatar { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px;
  border-radius: var(--radius-pill); background: var(--terracotta); color: #fff; font-size: 0.72rem; font-weight: 600; }
.topbar-title { font-weight: 600; font-size: 0.95rem; }
.topbar-actions { display: flex; align-items: center; gap: 10px; }

/* Блоки, которых нет в app-CSS */
.stack { display: flex; flex-direction: column; gap: 12px; }
.form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; }
.form-grid label { display: flex; flex-direction: column; gap: 5px; font-size: 0.82rem; font-weight: 500; }
.section-card { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; }
.section-head { display: flex; align-items: center; gap: 8px; }
.section-head h3 { margin: 0; font-size: 1rem; }
.profile-page, .body-page, .elements-page, .plan-surface { display: flex; flex-direction: column; gap: 18px; max-width: var(--content-width); }
.btns { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.badges { display: flex; gap: 8px; flex-wrap: wrap; }
.badge { font-size: 0.74rem; font-weight: 500; padding: 2px 10px; border-radius: var(--radius-pill); border: 1px solid currentColor; }
.badge-veg { color: var(--olive); } .badge-warn { color: var(--terracotta-dark); } .badge-neutral { color: var(--charcoal-soft); }
.goal-cards { display: flex; gap: 10px; flex-wrap: wrap; }
.goal-card { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px;
  border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--paper); color: var(--charcoal); font-size: 0.88rem; }
.goal-card.active { border-color: var(--terracotta); color: var(--terracotta-dark); font-weight: 600; }

/* План питания */
.plan-metrics { background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius-md); padding: 16px; display: flex; gap: 34px; flex-wrap: wrap; }
.meal-cards { display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: var(--radius-md); overflow: hidden; background: var(--paper); }
.meal-row { display: flex; align-items: center; gap: 16px; padding: 13px 16px; border-bottom: 1px solid var(--line); }
.meal-row:last-child { border-bottom: none; }
.meal-row-slot { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--charcoal-soft); font-weight: 600; min-width: 76px; }
.meal-row-body { flex: 1; min-width: 0; }
.meal-row-name { font-size: 0.95rem; font-weight: 500; }
.meal-row-kcal { display: flex; align-items: baseline; gap: 4px; }
.meal-row-unit { font-size: 0.75rem; color: var(--charcoal-soft); }

/* Анализ тела */
.zones-list { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.zone-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 0.8rem; padding: 3px 10px;
  border: 1px solid var(--line); border-radius: var(--radius-pill); color: var(--charcoal-soft); }
.zone-chip-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--zone-normal); }
.showcase-silhouettes { display: flex; gap: 26px; flex-wrap: wrap; }
.showcase-silhouette { display: flex; flex-direction: column; align-items: center; gap: 7px; }
.silhouette-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.silhouette-current { display: inline-flex; align-items: center; gap: 7px; font-size: 0.9rem; }
</style>
</head>
<body>
<div class="showcase">
  <header class="showcase-head">
    <p class="eyebrow">T11 · Готовый дизайн</p>
    <h1>Все экраны проекта</h1>
    <p class="lead">
      Реальные стили приложения: тёплая палитра (терракота, олива, песок), IBM Plex Sans
      с полноценной кириллицей, границы вместо теней, радиусы 4px, без градиентов.
      Ниже — ключевые страницы и базовые элементы.
    </p>
  </header>
  ${SCREENS.map(([title, body]) => page(title, body)).join('')}
</div>
</body>
</html>`;

fs.writeFileSync(OUT, html, 'utf8');
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`  экранов: ${SCREENS.length}`);
console.log(`  шрифтов встроено: ${Object.keys(fontMap).length}`);
console.log(`  размер: ${kb} КБ`);
console.log(`  записано: ${OUT}`);
