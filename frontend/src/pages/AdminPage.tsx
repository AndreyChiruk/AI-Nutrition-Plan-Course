import { useEffect, useState } from 'react';
import { adminApi } from '../api/services';
import { BarChart3, Pencil, Plus, Salad, ShieldAlert, Trash2, Users2, UtensilsCrossed, Wallet, X, XCircle } from '../components/icons';
import { formatApiError } from '../api/errors';
import { DishThumb } from '../components/DishThumb';
import { CalorieValue, MacroRow } from '../components/MacroRow';

type AdminUserRow = {
  id: number;
  email: string;
  role: string;
  isBlocked: boolean;
  height?: number;
  weight?: number;
  gender?: string;
  birthDate?: string;
  goal?: string;
  targetWeight?: number;
  activityLevel?: string;
  lastActiveAt?: string;
};

type UsersListResponse = { count: number; rows: AdminUserRow[] };

/** Размеры страниц админки: сервер отдаёт данные порциями, а не целиком. */
const PENDING_PAGE_SIZE = 20;
const PRODUCTS_PAGE_SIZE = 50;

type PendingMealItem = {
  id?: string;
  foodName: string;
  calories: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  /** Обнаруженные аллергены — ключевые данные для решения модератора. */
  allergensFound?: string[];
  dietaryTags?: string[];
  ingredients?: Array<{ name: string; grams?: number }>;
};

type PendingMealRow = {
  id: string;
  photoUrl: string;
  confidence: number;
  status: string;
  adminNote?: string;
  items?: PendingMealItem[];
};

type BaseRec = {
  id: string;
  title: string;
  description: string;
  category: string;
  audience: string;
  createdAt?: string;
  updatedAt?: string;
};

type ProductRow = {
  id: string;
  name: string;
  /** Ссылка на фото блюда (TheMealDB) либо null. */
  imageUrl?: string | null;
  category: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  allergens: string[];
  ingredients?: Array<{ name?: string; grams?: number }>;
  ingredientsDetailed?: Array<{ name?: string; grams?: number }>;
};

const BASE_CATEGORIES = ['nutrition', 'activity', 'habits', 'sleep'] as const;

type BillingCostsState = {
  fetchedAt?: string;
  apiKeyConfigured?: boolean;
  costs7d?: {
    ok?: boolean;
    totalUsdApprox?: number;
    bucketCount?: number;
    message?: string;
  };
  /** Фактические расходы в OpenRouter: списания по ключу. */
  openRouter?: {
    totalUsageUsd: number;
    totalCreditsUsd: number | null;
    remainingUsd: number | null;
    keyLimitUsd: number | null;
    keyLimitRemainingUsd: number | null;
    keyLabel: string | null;
    error?: string;
  } | null;
};

function fmtUsd(n?: number) {
  if (n === undefined || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
}

function birthInputValue(iso?: string) {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

function renderProductIngredients(row: ProductRow): string {
  const detailed = Array.isArray(row.ingredientsDetailed) ? row.ingredientsDetailed : [];
  const base = Array.isArray(row.ingredients) ? row.ingredients : [];
  const src =
    detailed.length > 0
      ? detailed.map((x) => ({ name: String(x?.name ?? '').trim(), grams: Number(x?.grams) || 0 }))
      : base.map((x) => ({ name: String(x?.name ?? '').trim(), grams: Number(x?.grams) || 0 }));
  const cleaned = src.filter((x) => x.name.length > 0);
  if (!cleaned.length) return '—';
  return cleaned.map((x) => `${x.name}: ${Math.round(x.grams)} г`).join('; ');
}


function parseStringListField(raw: string): string[] {
  const t = raw.trim();
  if (!t) return [];
  if (t.startsWith('[')) {
    try {
      const j = JSON.parse(t) as unknown;
      return Array.isArray(j) ? j.map((x) => String(x).trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return t
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

type SimpleIng = { name: string; grams: number };


function parseIngredientsSimpleJson(raw: string): SimpleIng[] | null {
  const t = raw.trim();
  if (!t) return [];
  try {
    const j = JSON.parse(t) as unknown;
    if (!Array.isArray(j)) return null;
    const out: SimpleIng[] = [];
    for (const row of j) {
      if (!row || typeof row !== 'object') return null;
      const r = row as Record<string, unknown>;
      const name = String(r.name ?? '').trim();
      const grams = Number(r.grams ?? 0);
      if (!name) return null;
      out.push({ name, grams: Number.isFinite(grams) ? grams : 0 });
    }
    return out;
  } catch {
    return null;
  }
}

type DetailedIng = {
  id: string;
  name: string;
  amount: number;
  unit: string;
  grams: number;
  originalString?: string;
  ingredientId?: string;
};

function parseIngredientsDetailedJson(raw: string): DetailedIng[] | null {
  const t = raw.trim();
  if (!t) return [];
  try {
    const j = JSON.parse(t) as unknown;
    if (!Array.isArray(j)) return null;
    const out: DetailedIng[] = [];
    for (let i = 0; i < j.length; i += 1) {
      const row = j[i];
      if (!row || typeof row !== 'object') return null;
      const r = row as Record<string, unknown>;
      const name = String(r.name ?? '').trim();
      const amount = Number(r.amount ?? r.grams ?? 0);
      const unit = String(r.unit ?? 'г').trim() || 'г';
      const grams = Number(r.grams ?? amount ?? 0);
      if (!name) return null;
      const id =
        typeof r.id === 'string' && r.id.trim()
          ? r.id.trim()
          : typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `ing-${Date.now()}-${i}`;
      const item: DetailedIng = {
        id,
        name,
        amount: Number.isFinite(amount) ? amount : grams,
        unit,
        grams: Number.isFinite(grams) ? grams : amount,
      };
      if (typeof r.originalString === 'string' && r.originalString.trim()) {
        item.originalString = r.originalString.trim();
      }
      if (typeof r.ingredientId === 'string' && r.ingredientId.trim()) {
        item.ingredientId = r.ingredientId.trim();
      }
      out.push(item);
    }
    return out;
  } catch {
    return null;
  }
}

function createEmptyNewProduct() {
  return {
    name: '',
    category: 'lunch',
    calories: 0,
    protein: 0,
    fat: 0,
    carbs: 0,
    allergensText: '',
    dietaryTagsText: '',
    ingredientsJson: '',
    ingredientsDetailedJson: '',
    matchKeywordsText: '',
    imageUrl: '',
    description: '',
    servings: 1,
    cookingTimeMin: '',
    cuisine: '',
    mealTypesText: '',
    isFromApi: false,
    sourceUrl: '',
    sourceMealId: '',
  };
}

export const AdminPage = () => {
  const [section, setSection] = useState<'dashboard' | 'base' | 'products' | 'users' | 'moderation'>(
    'dashboard',
  );
  const [usersList, setUsersList] = useState<UsersListResponse | null>(null);
  const [pendingMeals, setPendingMeals] = useState<PendingMealRow[]>([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  /** Постраничная навигация по продуктам (раньше грузились все 2.8 МБ). */
  const [productsPage, setProductsPage] = useState(0);
  const [productsTotal, setProductsTotal] = useState(0);
  const [productSearch, setProductSearch] = useState('');

  /** Черновик правки распознавания (модерация). */
  const [correctDraft, setCorrectDraft] = useState<{
    mealId: string;
    adminNote: string;
    items: Array<{
      foodName: string;
      calories: number;
      protein: number;
      fat: number;
      carbs: number;
      allergensText: string;
    }>;
  } | null>(null);
  const [correctError, setCorrectError] = useState('');

  /** Ошибка последнего действия администратора (подтверждение, блокировка и т. п.). */
  const [adminActionError, setAdminActionError] = useState('');
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [billingCosts, setBillingCosts] = useState<BillingCostsState | null>(null);
  const [billingRefreshError, setBillingRefreshError] = useState('');
  const [billingLoading, setBillingLoading] = useState(false);
  const [baseRecommendations, setBaseRecommendations] = useState<BaseRec[]>([]);
  const [baseEditingId, setBaseEditingId] = useState<string | null>(null);
  const [baseDraft, setBaseDraft] = useState<Partial<BaseRec>>({});

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [aiLocalizeId, setAiLocalizeId] = useState('');
  const [catalogAiLocalizeOneMsg, setCatalogAiLocalizeOneMsg] = useState('');
  const [catalogAiLocalizeOneBusy, setCatalogAiLocalizeOneBusy] = useState(false);
  /* Переменная aiOnlyMissingDetailed удалена: она использовалась
     только в aiLocalizeCatalogAll, который убран вместе с кнопкой
     «AI: обработать весь каталог». */
  const [productEditingId, setProductEditingId] = useState<string | null>(null);
  const [productDraft, setProductDraft] = useState<Partial<ProductRow> & { allergensText?: string }>({});

  const [newEmail, setNewEmail] = useState('new.user@example.com');
  const [newPassword, setNewPassword] = useState('user123');
  const [newBaseTitle, setNewBaseTitle] = useState('Пейте воду регулярно');
  const [newBaseDescription, setNewBaseDescription] = useState(
    'Поддерживайте питьевой режим 30 мл воды на 1 кг массы тела.',
  );
  const [newBaseCategory, setNewBaseCategory] = useState<(typeof BASE_CATEGORIES)[number]>('nutrition');
  const [newBaseAudience, setNewBaseAudience] = useState('all');
  const [newProduct, setNewProduct] = useState(createEmptyNewProduct);
  const [addDishModalOpen, setAddDishModalOpen] = useState(false);
  const [userEditing, setUserEditing] = useState<AdminUserRow | null>(null);

  const refreshUsers = async () => {
    const usersData = (await adminApi.users()) as UsersListResponse;
    setUsersList(usersData);
  };

  const refreshPending = async () => {
    // Сервер отдаёт страницу: { rows, count }.
    const data = await adminApi.pendingMeals({ limit: PENDING_PAGE_SIZE });
    setPendingMeals(Array.isArray(data?.rows) ? (data.rows as PendingMealRow[]) : []);
    setPendingTotal(typeof data?.count === 'number' ? data.count : 0);
  };

  const refreshBase = async () => {
    const baseData = (await adminApi.getBaseRecommendations()) as BaseRec[];
    setBaseRecommendations(Array.isArray(baseData) ? baseData : []);
  };

  const refreshProducts = async () => {
    // Сервер отдаёт страницу: { rows, count }.
    const data = await adminApi.getProducts({
      limit: PRODUCTS_PAGE_SIZE,
      offset: productsPage * PRODUCTS_PAGE_SIZE,
      search: productSearch.trim() || undefined,
    });
    setProducts(Array.isArray(data?.rows) ? (data.rows as ProductRow[]) : []);
    setProductsTotal(typeof data?.count === 'number' ? data.count : 0);
  };

  // Перезагрузка страницы продуктов при смене номера страницы или поиска.
  useEffect(() => {
    void refreshProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productsPage, productSearch]);

  useEffect(() => {
    const load = async () => {
      const [usersData, pendingMealsData, statsData, baseData, productsData] = await Promise.all([
        adminApi.users(),
        adminApi.pendingMeals(),
        adminApi.overview(),
        adminApi.getBaseRecommendations(),
        adminApi.getProducts(),
      ]);
      setUsersList(usersData as UsersListResponse);

      // Очередь модерации и каталог сервер отдаёт страницами: { rows, count }.
      // Раньше здесь ожидался массив (`Array.isArray`), поэтому при первой
      // загрузке админки очередь ВСЕГДА выглядела пустой: распознавания
      // лежали в БД со статусом pending, но администратор их не видел,
      // пока не выполнял действие, вызывающее перезагрузку списка.
      const pending = pendingMealsData as { rows?: unknown[]; count?: number };
      setPendingMeals(Array.isArray(pending?.rows) ? (pending.rows as PendingMealRow[]) : []);
      setPendingTotal(typeof pending?.count === 'number' ? pending.count : 0);

      setStats(statsData as Record<string, unknown>);
      setBaseRecommendations(Array.isArray(baseData) ? (baseData as BaseRec[]) : []);

      const catalog = productsData as { rows?: unknown[]; count?: number };
      setProducts(Array.isArray(catalog?.rows) ? (catalog.rows as ProductRow[]) : []);
      setProductsTotal(typeof catalog?.count === 'number' ? catalog.count : 0);
      try {
        const billing = (await adminApi.openAiBilling()) as Record<string, unknown>;
        setBillingCosts({
          fetchedAt: billing.fetchedAt as string | undefined,
          apiKeyConfigured: billing.apiKeyConfigured as boolean | undefined,
          costs7d: billing.costs7d as BillingCostsState['costs7d'],
          openRouter: billing.openRouter as BillingCostsState['openRouter'],
        });
        setBillingRefreshError('');
      } catch {
        setBillingCosts(null);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    if (section !== 'products') {
      setAddDishModalOpen(false);
    }
  }, [section]);

  const refreshOpenAiBilling = async () => {
    setBillingLoading(true);
    try {
      const billing = (await adminApi.openAiBilling()) as Record<string, unknown>;
      setBillingCosts({
        fetchedAt: billing.fetchedAt as string | undefined,
        apiKeyConfigured: billing.apiKeyConfigured as boolean | undefined,
        costs7d: billing.costs7d as BillingCostsState['costs7d'],
        // Данные OpenRouter нужно перенести в состояние: без этой строки
        // панель всегда показывала старый блок «organization costs»,
        // хотя сервер уже отдавал фактические расходы.
        openRouter: billing.openRouter as BillingCostsState['openRouter'],
      });
      setBillingRefreshError('');
    } catch {
      setBillingRefreshError(
        'Не удалось обновить данные. Показаны значения последнего успешного обновления.',
      );
    } finally {
      setBillingLoading(false);
    }
  };

  const createUser = async () => {
    await adminApi.createUser({
      email: newEmail,
      password: newPassword,
      role: 'user',
      birthDate: '1997-07-07',
    });
    await refreshUsers();
  };

  const saveUserEdits = async () => {
    if (!userEditing) return;
    await adminApi.updateUser(userEditing.id, {
      email: userEditing.email,
      role: userEditing.role,
      height: userEditing.height,
      weight: userEditing.weight,
      gender: userEditing.gender,
      birthDate: userEditing.birthDate,
      goal: userEditing.goal,
      targetWeight: userEditing.targetWeight,
      activityLevel: userEditing.activityLevel,
    });
    setUserEditing(null);
    await refreshUsers();
  };

  const onDeleteUser = async (id: number) => {
    await runAdminAction(() => adminApi.deleteUser(id), 'удаление пользователя');
    if (userEditing?.id === id) setUserEditing(null);
    await refreshUsers();
  };

  const createBaseRecommendation = async () => {
    await adminApi.createBaseRecommendation({
      title: newBaseTitle,
      description: newBaseDescription,
      category: newBaseCategory,
      audience: newBaseAudience,
    });
    await refreshBase();
  };

  const startEditBase = (row: BaseRec) => {
    setBaseEditingId(row.id);
    setBaseDraft({ ...row });
  };

  const saveBase = async () => {
    if (!baseEditingId || !baseDraft.title || !baseDraft.description) return;
    await adminApi.updateBaseRecommendation(baseEditingId, {
      title: baseDraft.title,
      description: baseDraft.description,
      category: baseDraft.category,
      audience: baseDraft.audience,
    });
    setBaseEditingId(null);
    setBaseDraft({});
    await refreshBase();
  };

  const deleteBase = async (id: string) => {
    await adminApi.deleteBaseRecommendation(id);
    if (baseEditingId === id) {
      setBaseEditingId(null);
      setBaseDraft({});
    }
    await refreshBase();
  };

  const createProduct = async () => {
    const name = newProduct.name.trim();
    if (!name) {
      window.alert('Укажите название блюда.');
      return;
    }
    const ingredientsParsed = parseIngredientsSimpleJson(newProduct.ingredientsJson);
    if (ingredientsParsed === null) {
      window.alert('Поле «Состав (JSON)»: неверный формат. Ожидается массив объектов { name, grams }.');
      return;
    }
    const detailedParsed = parseIngredientsDetailedJson(newProduct.ingredientsDetailedJson);
    if (detailedParsed === null) {
      window.alert(
        'Поле «Детальный состав (JSON)»: неверный формат. Ожидается массив { name, amount, unit, grams }.',
      );
      return;
    }

    const allergens = newProduct.allergensText
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const dietaryTags = parseStringListField(newProduct.dietaryTagsText);
    const matchKeywords = parseStringListField(newProduct.matchKeywordsText);
    const mealTypes = parseStringListField(newProduct.mealTypesText);

    const cookingRaw = String(newProduct.cookingTimeMin).trim();
    const cookingNum = cookingRaw === '' ? null : Number(cookingRaw);

    const payload: Record<string, unknown> = {
      name,
      category: newProduct.category.trim() || 'other',
      calories: Number(newProduct.calories) || 0,
      protein: Number(newProduct.protein) || 0,
      fat: Number(newProduct.fat) || 0,
      carbs: Number(newProduct.carbs) || 0,
      allergens,
      dietaryTags,
      ingredients: ingredientsParsed,
      ingredientsDetailed: detailedParsed,
      matchKeywords,
      servings: Math.max(1, Math.floor(Number(newProduct.servings) || 1)),
      mealTypes,
      isFromApi: Boolean(newProduct.isFromApi),
    };

    if (cookingNum !== null && Number.isFinite(cookingNum) && cookingNum >= 0) {
      payload.cookingTimeMin = Math.round(cookingNum);
    }
    const img = newProduct.imageUrl.trim();
    if (img) payload.imageUrl = img;
    const desc = newProduct.description.trim();
    if (desc) payload.description = desc;
    const cui = newProduct.cuisine.trim();
    if (cui) payload.cuisine = cui;
    const su = newProduct.sourceUrl.trim();
    if (su) payload.sourceUrl = su;
    const sm = newProduct.sourceMealId.trim();
    if (sm) payload.sourceMealId = sm.slice(0, 40);

    try {
      await adminApi.createProduct(payload);
      await refreshProducts();
      setNewProduct(createEmptyNewProduct());
      setAddDishModalOpen(false);
    } catch {
      window.alert('Не удалось создать продукт: возможно, дубликат названия или ошибка сервера.');
    }
  };

  const startEditProduct = (row: ProductRow) => {
    setProductEditingId(row.id);
    setProductDraft({
      ...row,
      allergensText: (row.allergens ?? []).join(', '),
    });
  };

  const saveProduct = async () => {
    if (!productEditingId || !productDraft.name) return;
    const allergens = (productDraft.allergensText ?? '')
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    await adminApi.updateProduct(productEditingId, {
      name: productDraft.name,
      category: productDraft.category,
      calories: productDraft.calories,
      protein: productDraft.protein,
      fat: productDraft.fat,
      carbs: productDraft.carbs,
      allergens,
    });
    setProductEditingId(null);
    setProductDraft({});
    await refreshProducts();
  };

  const deleteProduct = async (id: string) => {
    await adminApi.deleteProduct(id);
    if (productEditingId === id) {
      setProductEditingId(null);
      setProductDraft({});
    }
    await refreshProducts();
  };

  /* Разовые служебные операции с каталогом удалены вместе с кнопками
     по просьбе: replaceCatalogFromTheMealDb (полная замена каталога
     из TheMealDB) и aiLocalizeCatalogAll (AI-прогон всего каталога).
     Они вызывались только со своих кнопок, поэтому после их скрытия
     остались бы мёртвым кодом. */

  const aiLocalizeProductById = async () => {
    const id = aiLocalizeId.trim();
    if (!id) {
      setCatalogAiLocalizeOneMsg('Укажите id блюда.');
      return;
    }
    setCatalogAiLocalizeOneBusy(true);
    setCatalogAiLocalizeOneMsg('AI обрабатывает выбранное блюдо…');
    try {
      const r = await adminApi.aiLocalizeProductById(id);
      setCatalogAiLocalizeOneMsg(
        r.updated
          ? `Блюдо ${r.id} обновлено (модель ${r.model}). Планы: дней ${r.mealPlanDaysUpdated}, ячеек ${r.mealPlanSnapshotCellsUpdated}.`
          : `Блюдо ${r.id} без обновления: ${r.error ?? 'нет данных от AI'}.`,
      );
      await refreshProducts();
    } catch {
      setCatalogAiLocalizeOneMsg('Ошибка обработки по id. Проверьте корректность id и OPENAI_API_KEY.');
    } finally {
      setCatalogAiLocalizeOneBusy(false);
    }
  };

  const onBlock = async (id: number) => {
    await runAdminAction(() => adminApi.blockUser(id), 'блокировка пользователя');
    await refreshUsers();
  };

  const onUnblock = async (id: number) => {
    await runAdminAction(() => adminApi.unblockUser(id), 'разблокировка пользователя');
    await refreshUsers();
  };

  /**
   * Обёртка для действий администратора.
   *
   * Раньше вызовы API не обрабатывали ошибки вовсе: неудачный запрос
   * приводил к необработанному отклонению промиса БЕЗ какого-либо сообщения
   * в интерфейсе — администратор не понимал, применилось действие или нет.
   */
  const runAdminAction = async (action: () => Promise<unknown>, label: string) => {
    try {
      setAdminActionError('');
      await action();
    } catch (err) {
      setAdminActionError(formatApiError(err, `Не удалось выполнить действие: ${label}.`));
    }
  };

  const onConfirmMeal = async (id: string) => {
    await runAdminAction(() => adminApi.confirmMeal(id), 'подтверждение распознавания');
    await refreshPending();
  };

  const onRejectMeal = async (id: string) => {
    await runAdminAction(() => adminApi.rejectMeal(id), 'отклонение распознавания');
    await refreshPending();
  };

  /**
   * Открывает форму правки распознавания.
   * Копируем позиции в локальное состояние — правки не влияют на список,
   * пока админ не сохранит их.
   */
  const onStartCorrectMeal = (meal: PendingMealRow) => {
    setCorrectDraft({
      mealId: meal.id,
      adminNote: '',
      items: (meal.items ?? []).map((it) => ({
        foodName: it.foodName,
        calories: Number(it.calories) || 0,
        protein: Number(it.protein) || 0,
        fat: Number(it.fat) || 0,
        carbs: Number(it.carbs) || 0,
        allergensText: (it.allergensFound ?? []).join(', '),
      })),
    });
    setCorrectError('');
  };

  /** Сохраняет правки: сервер заменяет список позиций целиком. */
  const onSaveCorrectMeal = async () => {
    if (!correctDraft) return;
    const items = correctDraft.items
      .filter((it) => String(it.foodName ?? '').trim())
      .map((it) => ({
        foodName: String(it.foodName).trim(),
        calories: Number(it.calories) || 0,
        protein: Number(it.protein) || 0,
        fat: Number(it.fat) || 0,
        carbs: Number(it.carbs) || 0,
        // Аллергены хранятся массивом; в форме — строка через запятую.
        allergensFound: String(it.allergensText ?? '')
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      }));

    if (items.length === 0) {
      setCorrectError('Нужна хотя бы одна позиция с названием.');
      return;
    }

    try {
      await adminApi.correctMeal(correctDraft.mealId, {
        items,
        adminNote: correctDraft.adminNote?.trim() || undefined,
      });
      setCorrectDraft(null);
      await refreshPending();
    } catch {
      setCorrectError('Не удалось сохранить правки. Проверьте значения и повторите.');
    }
  };

  return (
    <div className="profile-premium">
      {/* В админке блоки идут одной колонкой: таблицы и панели шире,
          в две колонки содержимое сжималось. */}
      <div className="profile-grid profile-grid--single">
        <aside className="left-col">
          <div className="card section-card stack">
            <button type="button" onClick={() => setSection('dashboard')}>
              <BarChart3 size={16} /> Дашборд
            </button>
            <button type="button" onClick={() => setSection('base')}>
              <ShieldAlert size={16} /> Базовые рекомендации
            </button>
            <button type="button" onClick={() => setSection('products')}>
              <Salad size={16} /> Управление продуктами
            </button>
            <button type="button" onClick={() => setSection('users')}>
              <Users2 size={16} /> Пользователи
            </button>
            <button type="button" onClick={() => setSection('moderation')}>
              <UtensilsCrossed size={16} /> Модерация еды
            </button>
          </div>
        </aside>

        <section className="right-col">
          {section === 'dashboard' ? (
            <div className="admin-openai-stack">
              <div className="grid admin-dashboard-grid">
                <div className="card">
                  <h3>Всего пользователей</h3>
                  <p className="big-stat">{String(stats?.totalUsers ?? 0)}</p>
                </div>
                <div className="card">
                  <h3>Активных сегодня</h3>
                  <p className="big-stat">
                    {String(
                      (stats?.activeUsersToday as number | undefined) ??
                        (stats?.latestStats as { activeUsers?: number } | undefined)?.activeUsers ??
                        0,
                    )}
                  </p>
                  <p className="muted small">Счёт по входу/обновлению сессии за календарный день (серверное время)</p>
                </div>
                <div className="card">
                  <h3>Продуктов в БД</h3>
                  <p className="big-stat">{String(stats?.totalProducts ?? 0)}</p>
                </div>
                <div className="card">
                  <h3>Базовых рекомендаций</h3>
                  <p className="big-stat">{String(stats?.totalBaseRecommendations ?? 0)}</p>
                </div>
              </div>

              <div className="card admin-openai-panel">
                <div className="admin-openai-head">
                  <h3>
                    <Wallet size={18} aria-hidden /> Расходы на AI
                  </h3>
                  <button type="button" className="btn-secondary" disabled={billingLoading} onClick={() => void refreshOpenAiBilling()}>
                    {billingLoading ? 'Обновление…' : 'Обновить'}
                  </button>
                </div>
                {!billingCosts ? (
                  <p className="muted small">Не удалось загрузить данные о расходах.</p>
                ) : (
                  <>
                    <p className="muted small admin-openai-updated">
                      Обновлено:{' '}
                      {billingCosts.fetchedAt
                        ? new Date(billingCosts.fetchedAt).toLocaleString('ru-RU')
                        : '—'}
                      .
                    </p>
                    {billingRefreshError ? (
                      <p className="error small admin-openai-alert" role="alert">
                        {billingRefreshError}
                      </p>
                    ) : null}

                    {billingCosts.openRouter ? (
                      billingCosts.openRouter.error ? (
                        <p className="error small admin-openai-alert" role="alert">
                          {billingCosts.openRouter.error}. Проверьте ключ и подключение к сети.
                        </p>
                      ) : (
                        <>
                          {/* Основной показатель: фактические списания OpenRouter. */}
                          <div className="admin-openai-grid">
                            <div className="admin-openai-item">
                              <div className="openai-label">Потрачено всего</div>
                              <p className="openai-value">
                                {fmtUsd(billingCosts.openRouter.totalUsageUsd)}
                              </p>
                              <p className="openai-hint">Списания по ключу OpenRouter</p>
                            </div>
                            <div className="admin-openai-item">
                              <div className="openai-label">Остаток средств</div>
                              <p className="openai-value">
                                {fmtUsd(
                                  billingCosts.openRouter.remainingUsd ??
                                    billingCosts.openRouter.keyLimitRemainingUsd ??
                                    undefined,
                                )}
                              </p>
                              <p className="openai-hint">
                                {billingCosts.openRouter.totalCreditsUsd != null
                                  ? `Пополнено ${fmtUsd(billingCosts.openRouter.totalCreditsUsd)}`
                                  : 'Пополнения не заданы'}
                              </p>
                            </div>
                            <div className="admin-openai-item">
                              <div className="openai-label">Лимит ключа</div>
                              <p className="openai-value">
                                {fmtUsd(billingCosts.openRouter.keyLimitUsd ?? undefined)}
                              </p>
                              <p className="openai-hint">
                                {billingCosts.openRouter.keyLabel
                                  ? `Ключ ${billingCosts.openRouter.keyLabel}`
                                  : 'Ключ без лимита'}
                              </p>
                            </div>
                          </div>
                          <p className="muted small" style={{ marginTop: 10 }}>
                            Подробная история операций —{' '}
                            <a
                              href="https://openrouter.ai/activity"
                              target="_blank"
                              rel="noreferrer"
                            >
                              openrouter.ai/activity
                            </a>
                            .
                          </p>
                        </>
                      )
                    ) : !billingCosts.apiKeyConfigured ? (
                      <p className="muted small">
                        Ключ AI не настроен. Расходы появятся после добавления
                        ключа в настройках сервера.
                      </p>
                    ) : (
                      <div className="admin-openai-grid admin-openai-grid-single">
                        <div className="admin-openai-item">
                          <div className="openai-label">Затраты ~7 дней (organization costs)</div>
                          <p className="openai-value">
                            {fmtUsd(billingCosts.costs7d?.totalUsdApprox)}
                          </p>
                          <p className="openai-hint">
                            {billingCosts.costs7d?.ok === false
                              ? billingCosts.costs7d?.message
                              : `Бакетов дней: ${billingCosts.costs7d?.bucketCount ?? '—'}`}
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ) : null}

          {section === 'base' ? (
            <div className="card admin-crud">
              <h2>Базовые рекомендации (CRUD)</h2>
              <p className="muted small">Поля id, createdAt, updatedAt задаются на сервере.</p>
              <div className="stack admin-form-block">
                <div className="stack-row wrap">
                  <input
                    aria-label="Заголовок рекомендации"
                    placeholder="Заголовок"
                    value={newBaseTitle}
                    onChange={(e) => setNewBaseTitle(e.target.value)}
                  />
                  <input
                    aria-label="Описание рекомендации"
                    placeholder="Описание"
                    value={newBaseDescription}
                    onChange={(e) => setNewBaseDescription(e.target.value)}
                  />
                  <select
                    aria-label="Категория"
                    value={newBaseCategory}
                    onChange={(e) => setNewBaseCategory(e.target.value as (typeof BASE_CATEGORIES)[number])}
                  >
                    {BASE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Аудитория"
                    placeholder="audience, напр. all"
                    value={newBaseAudience}
                    onChange={(e) => setNewBaseAudience(e.target.value)}
                  />
                  <button type="button" onClick={createBaseRecommendation}>
                    Добавить
                  </button>
                </div>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Заголовок</th>
                      <th>Категория</th>
                      <th>Аудитория</th>
                      <th>Обновлено</th>
                      <th style={{ width: 140 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {baseRecommendations.map((r) => (
                      <tr key={r.id}>
                        {baseEditingId === r.id ? (
                          <>
                            <td colSpan={3}>
                              <div className="admin-inline-fields">
                                <input
                                  value={baseDraft.title ?? ''}
                                  onChange={(e) => setBaseDraft((d) => ({ ...d, title: e.target.value }))}
                                />
                                <textarea
                                  rows={2}
                                  value={baseDraft.description ?? ''}
                                  onChange={(e) => setBaseDraft((d) => ({ ...d, description: e.target.value }))}
                                />
                                <div className="stack-row">
                                  <select
                                    value={(baseDraft.category as string) ?? 'nutrition'}
                                    onChange={(e) => setBaseDraft((d) => ({ ...d, category: e.target.value }))}
                                  >
                                    {BASE_CATEGORIES.map((c) => (
                                      <option key={c} value={c}>
                                        {c}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    placeholder="audience"
                                    value={baseDraft.audience ?? ''}
                                    onChange={(e) => setBaseDraft((d) => ({ ...d, audience: e.target.value }))}
                                  />
                                </div>
                              </div>
                            </td>
                            <td className="muted small">{r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '—'}</td>
                            <td className="table-actions">
                              <button type="button" className="btn-primary" onClick={saveBase}>
                                Сохранить
                              </button>
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => {
                                  setBaseEditingId(null);
                                  setBaseDraft({});
                                }}
                              >
                                <X size={16} />
                              </button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td>
                              <strong>{r.title}</strong>
                              <p className="muted small" style={{ margin: '0.25rem 0 0' }}>
                                {r.description}
                              </p>
                            </td>
                            <td>{r.category}</td>
                            <td>{r.audience}</td>
                            <td className="muted small">{r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '—'}</td>
                            <td className="table-actions">
                              <button type="button" className="btn-secondary" onClick={() => startEditBase(r)} title="Редактировать">
                                <Pencil size={16} /> Изменить
                              </button>
                              <button type="button" className="btn-danger" onClick={() => deleteBase(r.id)} title="Удалить">
                                <Trash2 size={16} /> Удалить
                              </button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {section === 'products' ? (
            <div className="card admin-crud">
              <h2>Продукты (CRUD)</h2>
              {/* Кнопки «Заменить каталог из TheMealDB» и «AI: обработать
                  весь каталог» убраны по просьбе: это разовые служебные
                  операции, в обычной работе админки они не нужны.
                  Вместе с кнопками удалены и сами обработчики
                  (replaceCatalogFromTheMealDb, aiLocalizeCatalogAll),
                  так как вызывались только отсюда — иначе остался бы
                  неиспользуемый код, на котором падает сборка
                  (noUnusedLocals в tsconfig). */}
              <div className="stack-row wrap" style={{ marginBottom: 12 }}>
                <input
                  aria-label="ID блюда для AI-обработки"
                  placeholder="ID блюда (UUID)"
                  value={aiLocalizeId}
                  onChange={(e) => setAiLocalizeId(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={catalogAiLocalizeOneBusy}
                  onClick={() => void aiLocalizeProductById()}
                >
                  AI: обработать блюдо по ID
                </button>
              </div>
              {catalogAiLocalizeOneMsg ? <p className="muted small">{catalogAiLocalizeOneMsg}</p> : null}
              <div className="stack-row wrap" style={{ marginBottom: 12 }}>
                <button type="button" className="btn-primary" onClick={() => setAddDishModalOpen(true)}>
                  <Plus size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  Добавить блюдо
                </button>
              </div>
              {/* Поиск и пагинация: каталог отдаётся страницами, а не целиком. */}
              <div className="pagination-bar">
                <input
                  type="search"
                  placeholder="Поиск по названию"
                  value={productSearch}
                  onChange={(e) => {
                    setProductSearch(e.target.value);
                    setProductsPage(0);
                  }}
                />
                <div className="pagination-controls">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={productsPage === 0}
                    onClick={() => setProductsPage((p) => Math.max(0, p - 1))}
                  >
                    Назад
                  </button>
                  <span className="muted small">
                    {productsTotal > 0
                      ? `${productsPage * PRODUCTS_PAGE_SIZE + 1}–${Math.min(
                          (productsPage + 1) * PRODUCTS_PAGE_SIZE,
                          productsTotal,
                        )} из ${productsTotal}`
                      : 'нет записей'}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={(productsPage + 1) * PRODUCTS_PAGE_SIZE >= productsTotal}
                    onClick={() => setProductsPage((p) => p + 1)}
                  >
                    Вперёд
                  </button>
                </div>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 64 }}>Фото</th>
                      <th>Название</th>
                      <th>Кат.</th>
                      <th>Ккал</th>
                      <th>Б/Ж/У</th>
                      <th>Ингредиенты (г)</th>
                      <th>Аллергены</th>
                      <th style={{ width: 120 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => (
                      <tr key={p.id}>
                        {productEditingId === p.id ? (
                          <>
                            <td colSpan={7}>
                              <div className="admin-inline-fields">
                                <input
                                  value={productDraft.name ?? ''}
                                  onChange={(e) => setProductDraft((d) => ({ ...d, name: e.target.value }))}
                                />
                                <div className="stack-row wrap">
                                  <input
                                    placeholder="category"
                                    value={productDraft.category ?? ''}
                                    onChange={(e) => setProductDraft((d) => ({ ...d, category: e.target.value }))}
                                  />
                                  <input
                                    type="number"
                                    value={productDraft.calories ?? 0}
                                    onChange={(e) => setProductDraft((d) => ({ ...d, calories: Number(e.target.value) }))}
                                  />
                                  <input
                                    type="number"
                                    step="0.1"
                                    value={productDraft.protein ?? 0}
                                    onChange={(e) => setProductDraft((d) => ({ ...d, protein: Number(e.target.value) }))}
                                  />
                                  <input
                                    type="number"
                                    step="0.1"
                                    value={productDraft.fat ?? 0}
                                    onChange={(e) => setProductDraft((d) => ({ ...d, fat: Number(e.target.value) }))}
                                  />
                                  <input
                                    type="number"
                                    step="0.1"
                                    value={productDraft.carbs ?? 0}
                                    onChange={(e) => setProductDraft((d) => ({ ...d, carbs: Number(e.target.value) }))}
                                  />
                                </div>
                                <input
                                  placeholder="аллергены"
                                  value={productDraft.allergensText ?? ''}
                                  onChange={(e) => setProductDraft((d) => ({ ...d, allergensText: e.target.value }))}
                                />
                              </div>
                            </td>
                            <td className="table-actions">
                              <button type="button" className="btn-primary" onClick={saveProduct}>
                                Сохранить
                              </button>
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => {
                                  setProductEditingId(null);
                                  setProductDraft({});
                                }}
                              >
                                <X size={16} />
                              </button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td>
                              <DishThumb imageUrl={p.imageUrl} name={p.name} size="sm" />
                            </td>
                            <td>
                              <strong>{p.name}</strong>
                            </td>
                            <td>{p.category}</td>
                            <td>
                              <CalorieValue calories={p.calories} />
                            </td>
                            <td>
                              <MacroRow protein={p.protein} fat={p.fat} carbs={p.carbs} />
                            </td>
                            <td className="muted small">{renderProductIngredients(p)}</td>
                            <td className="muted small">{(p.allergens ?? []).join(', ') || '—'}</td>
                            <td className="table-actions">
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => startEditProduct(p)}
                                title="Редактировать"
                              >
                                <Pencil size={16} /> Изменить
                              </button>
                              <button type="button" className="btn-danger" onClick={() => deleteProduct(p.id)} title="Удалить">
                                <Trash2 size={16} /> Удалить
                              </button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {addDishModalOpen ? (
                <div
                  className="modal-backdrop"
                  role="presentation"
                  onClick={() => setAddDishModalOpen(false)}
                >
                  <div
                    className="modal-window"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="admin-add-dish-title"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: 'min(720px, 94vw)',
                      maxHeight: 'min(90vh, 900px)',
                      overflowY: 'auto',
                    }}
                  >
                    <h4 id="admin-add-dish-title" style={{ marginTop: 0 }}>
                      Новое блюдо в каталог
                    </h4>
                    <p className="muted small" style={{ marginBottom: 12 }}>
                      Id и метки времени создаёт сервер. Списки тегов — через запятую или JSON-массив; состав — см.
                      подсказки в полях.
                    </p>
                    <div className="stack admin-form-block" style={{ gap: 12 }}>
                      <div className="stack-row wrap">
                        <input
                          placeholder="Название — уникально, как в каталоге (рус.)"
                          value={newProduct.name}
                          onChange={(e) => setNewProduct((p) => ({ ...p, name: e.target.value }))}
                          style={{ minWidth: 220 }}
                        />
                        <input
                          placeholder="Категория слота: breakfast | lunch | dinner | snack | other"
                          value={newProduct.category}
                          onChange={(e) => setNewProduct((p) => ({ ...p, category: e.target.value }))}
                          style={{ minWidth: 260 }}
                        />
                      </div>
                      <div className="stack-row wrap">
                        <input
                          type="number"
                          placeholder="Ккал на 1 порцию"
                          value={newProduct.calories}
                          onChange={(e) => setNewProduct((p) => ({ ...p, calories: Number(e.target.value) }))}
                        />
                        <input
                          type="number"
                          step="0.1"
                          placeholder="Белки, г"
                          value={newProduct.protein}
                          onChange={(e) => setNewProduct((p) => ({ ...p, protein: Number(e.target.value) }))}
                        />
                        <input
                          type="number"
                          step="0.1"
                          placeholder="Жиры, г"
                          value={newProduct.fat}
                          onChange={(e) => setNewProduct((p) => ({ ...p, fat: Number(e.target.value) }))}
                        />
                        <input
                          type="number"
                          step="0.1"
                          placeholder="Углеводы, г"
                          value={newProduct.carbs}
                          onChange={(e) => setNewProduct((p) => ({ ...p, carbs: Number(e.target.value) }))}
                        />
                      </div>
                      <div className="stack-row wrap">
                        <input
                          placeholder="Аллергены: через запятую (как в каталоге), напр. лактоза, глютен"
                          value={newProduct.allergensText}
                          onChange={(e) => setNewProduct((p) => ({ ...p, allergensText: e.target.value }))}
                          style={{ flex: 1, minWidth: 240 }}
                        />
                        <input
                          placeholder='Диетические теги (англ. ключи): vegetarian, lactose-free или ["vegetarian"]'
                          value={newProduct.dietaryTagsText}
                          onChange={(e) => setNewProduct((p) => ({ ...p, dietaryTagsText: e.target.value }))}
                          style={{ flex: 1, minWidth: 240 }}
                        />
                      </div>
                      <div className="stack-row wrap">
                        <input
                          placeholder="URL превью блюда (картинка)"
                          value={newProduct.imageUrl}
                          onChange={(e) => setNewProduct((p) => ({ ...p, imageUrl: e.target.value }))}
                          style={{ flex: 1, minWidth: 200 }}
                        />
                        <input
                          type="number"
                          min={1}
                          placeholder="Порций в рецепте (servings)"
                          value={newProduct.servings}
                          onChange={(e) => setNewProduct((p) => ({ ...p, servings: Number(e.target.value) }))}
                        />
                        <input
                          type="number"
                          min={0}
                          placeholder="Время готовки, мин (необязательно)"
                          value={newProduct.cookingTimeMin}
                          onChange={(e) => setNewProduct((p) => ({ ...p, cookingTimeMin: e.target.value }))}
                        />
                        <input
                          placeholder="Кухня / регион (необязательно)"
                          value={newProduct.cuisine}
                          onChange={(e) => setNewProduct((p) => ({ ...p, cuisine: e.target.value }))}
                        />
                      </div>
                      <textarea
                        placeholder="Описание блюда (необязательно)"
                        value={newProduct.description}
                        onChange={(e) => setNewProduct((p) => ({ ...p, description: e.target.value }))}
                        rows={2}
                        style={{ width: '100%' }}
                      />
                      <textarea
                        placeholder='Состав порции, JSON: [{"name":"Рис","grams":180},{"name":"Курица","grams":120}] — пусто = []'
                        value={newProduct.ingredientsJson}
                        onChange={(e) => setNewProduct((p) => ({ ...p, ingredientsJson: e.target.value }))}
                        rows={3}
                        style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }}
                      />
                      <textarea
                        placeholder='Детальный состав, JSON: [{"name":"Рис","amount":180,"unit":"г","grams":180}] — id можно не указывать'
                        value={newProduct.ingredientsDetailedJson}
                        onChange={(e) => setNewProduct((p) => ({ ...p, ingredientsDetailedJson: e.target.value }))}
                        rows={4}
                        style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }}
                      />
                      <div className="stack-row wrap">
                        <input
                          placeholder='Ключевые слова для матча с холодильником: рис, курин или ["рис","курица"]'
                          value={newProduct.matchKeywordsText}
                          onChange={(e) => setNewProduct((p) => ({ ...p, matchKeywordsText: e.target.value }))}
                          style={{ flex: 1, minWidth: 200 }}
                        />
                        <input
                          placeholder='Типы приёмов пищи: breakfast, lunch или ["breakfast","lunch"]'
                          value={newProduct.mealTypesText}
                          onChange={(e) => setNewProduct((p) => ({ ...p, mealTypesText: e.target.value }))}
                          style={{ flex: 1, minWidth: 200 }}
                        />
                      </div>
                      <div className="stack-row wrap">
                        <input
                          placeholder="Источник: URL рецепта (необязательно)"
                          value={newProduct.sourceUrl}
                          onChange={(e) => setNewProduct((p) => ({ ...p, sourceUrl: e.target.value }))}
                          style={{ flex: 1, minWidth: 200 }}
                        />
                        <input
                          placeholder="Внешний id блюда, напр. id TheMealDB (необязательно)"
                          value={newProduct.sourceMealId}
                          onChange={(e) => setNewProduct((p) => ({ ...p, sourceMealId: e.target.value }))}
                          style={{ minWidth: 200 }}
                        />
                        <label className="check-item">
                          <input
                            type="checkbox"
                            checked={newProduct.isFromApi}
                            onChange={(e) => setNewProduct((p) => ({ ...p, isFromApi: e.target.checked }))}
                          />
                          <span className="small">Загружено из внешнего API (isFromApi)</span>
                        </label>
                      </div>
                    </div>
                    <div className="chip-grid" style={{ marginTop: 16 }}>
                      <button type="button" className="btn-primary" onClick={() => void createProduct()}>
                        Сохранить блюдо
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => setAddDishModalOpen(false)}>
                        Отмена
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {section === 'users' ? (
            <div className="card admin-crud">
              <h2>Пользователи</h2>
              <p className="muted small">Пароль при создании задаётся один раз; смена пароля — только в профиле пользователя. Редактирование — email, роль, антропометрия, цель.</p>
              <div className="stack admin-form-block">
                <div className="stack-row wrap">
                  <input
                    aria-label="Email пользователя"
                    placeholder="Email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                  />
                  <input
                    aria-label="Пароль пользователя"
                    placeholder="Пароль (только при создании)"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={createUser}>
                    Добавить пользователя
                  </button>
                </div>
              </div>

              {userEditing ? (
                <div className="card nested-edit">
                  <h3>
                    Редактирование #{userEditing.id} — {userEditing.email}
                  </h3>
                  <div className="admin-user-grid">
                    <label>
                      Email
                      <input
                        value={userEditing.email}
                        onChange={(e) => setUserEditing((u) => (u ? { ...u, email: e.target.value } : u))}
                      />
                    </label>
                    <label>
                      Роль
                      <select
                        value={userEditing.role}
                        onChange={(e) => setUserEditing((u) => (u ? { ...u, role: e.target.value } : u))}
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                        <option value="guest">guest</option>
                      </select>
                    </label>
                    <label>
                      Рост (см)
                      <input
                        type="number"
                        value={userEditing.height ?? ''}
                        onChange={(e) =>
                          setUserEditing((u) => (u ? { ...u, height: e.target.value === '' ? undefined : Number(e.target.value) } : u))
                        }
                      />
                    </label>
                    <label>
                      Вес (кг)
                      <input
                        type="number"
                        value={userEditing.weight ?? ''}
                        onChange={(e) =>
                          setUserEditing((u) => (u ? { ...u, weight: e.target.value === '' ? undefined : Number(e.target.value) } : u))
                        }
                      />
                    </label>
                    <label>
                      Пол
                      <select
                        value={userEditing.gender ?? 'male'}
                        onChange={(e) => setUserEditing((u) => (u ? { ...u, gender: e.target.value } : u))}
                      >
                        <option value="male">male</option>
                        <option value="female">female</option>
                      </select>
                    </label>
                    <label>
                      Дата рождения
                      <input
                        type="date"
                        value={birthInputValue(userEditing.birthDate)}
                        onChange={(e) => setUserEditing((u) => (u ? { ...u, birthDate: e.target.value } : u))}
                      />
                    </label>
                    <label>
                      Цель
                      <select
                        value={userEditing.goal ?? 'maintain'}
                        onChange={(e) => setUserEditing((u) => (u ? { ...u, goal: e.target.value } : u))}
                      >
                        <option value="lose">lose</option>
                        <option value="maintain">maintain</option>
                        <option value="gain">gain</option>
                      </select>
                    </label>
                    <label>
                      Целевой вес
                      <input
                        type="number"
                        value={userEditing.targetWeight ?? ''}
                        onChange={(e) =>
                          setUserEditing((u) =>
                            u ? { ...u, targetWeight: e.target.value === '' ? undefined : Number(e.target.value) } : u,
                          )
                        }
                      />
                    </label>
                    <label>
                      Активность
                      <select
                        value={userEditing.activityLevel ?? 'moderate'}
                        onChange={(e) => setUserEditing((u) => (u ? { ...u, activityLevel: e.target.value } : u))}
                      >
                        <option value="sedentary">sedentary</option>
                        <option value="light">light</option>
                        <option value="moderate">moderate</option>
                        <option value="active">active</option>
                        <option value="very_active">very_active</option>
                      </select>
                    </label>
                  </div>
                  <div className="stack-row">
                    <button type="button" className="btn-primary" onClick={saveUserEdits}>
                      Сохранить
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => setUserEditing(null)}>
                      Отмена
                    </button>
                  </div>
                </div>
              ) : null}

              <p className="muted small">Всего: {usersList?.count ?? 0}</p>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Email</th>
                      <th>Роль</th>
                      <th>Статус</th>
                      <th>Активность</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(usersList?.rows ?? []).map((u) => (
                      <tr key={u.id}>
                        <td>{u.id}</td>
                        <td>{u.email}</td>
                        <td>{u.role}</td>
                        <td>{u.isBlocked ? 'Заблокирован' : 'Активен'}</td>
                        <td className="muted small">
                          {u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleString() : '—'}
                        </td>
                        <td className="table-actions">
                          <button type="button" className="btn-secondary" onClick={() => setUserEditing({ ...u })}>
                            <Pencil size={16} /> Изм.
                          </button>
                          <button type="button" className="btn-danger" onClick={() => onDeleteUser(u.id)}>
                            <Trash2 size={16} /> Удалить
                          </button>
                          {u.isBlocked ? (
                            <button type="button" className="btn-secondary" onClick={() => onUnblock(u.id)}>
                              Разблок.
                            </button>
                          ) : (
                            <button type="button" className="btn-danger" onClick={() => onBlock(u.id)}>
                              Блок
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {section === 'moderation' ? (
            <div className="card">
              <h2>Модерация сохранённых распознаваний</h2>
              {adminActionError ? (
                <p className="form-error" role="alert">
                  {adminActionError}
                </p>
              ) : null}
              <p className="muted small">
                Пользователь сначала смотрит КБЖУ и аллергены без записи в БД; кнопка «Сохранить» присылает сюда запись со
                статусом «pending». Подтвердите, если блюдо можно оставить в системе, или отклоните.
              </p>
              {correctDraft ? (
                <div className="correct-meal-form card stack">
                  <h3>Исправление распознавания</h3>
                  <p className="muted small">
                    Измените значения перед подтверждением. Аллергены перечисляйте через запятую — они влияют
                    на предупреждения пользователям с аллергией.
                  </p>
                  {correctDraft.items.map((it, idx) => (
                    <div key={idx} className="correct-meal-row">
                      <label>
                        Название
                        <input
                          type="text"
                          value={it.foodName}
                          onChange={(e) =>
                            setCorrectDraft((d) =>
                              d
                                ? {
                                    ...d,
                                    items: d.items.map((x, i) =>
                                      i === idx ? { ...x, foodName: e.target.value } : x,
                                    ),
                                  }
                                : d,
                            )
                          }
                        />
                      </label>
                      <label>
                        Ккал
                        <input
                          type="number"
                          value={it.calories}
                          onChange={(e) =>
                            setCorrectDraft((d) =>
                              d
                                ? {
                                    ...d,
                                    items: d.items.map((x, i) =>
                                      i === idx ? { ...x, calories: Number(e.target.value) } : x,
                                    ),
                                  }
                                : d,
                            )
                          }
                        />
                      </label>
                      <label>
                        Б
                        <input
                          type="number"
                          value={it.protein}
                          onChange={(e) =>
                            setCorrectDraft((d) =>
                              d
                                ? {
                                    ...d,
                                    items: d.items.map((x, i) =>
                                      i === idx ? { ...x, protein: Number(e.target.value) } : x,
                                    ),
                                  }
                                : d,
                            )
                          }
                        />
                      </label>
                      <label>
                        Ж
                        <input
                          type="number"
                          value={it.fat}
                          onChange={(e) =>
                            setCorrectDraft((d) =>
                              d
                                ? {
                                    ...d,
                                    items: d.items.map((x, i) =>
                                      i === idx ? { ...x, fat: Number(e.target.value) } : x,
                                    ),
                                  }
                                : d,
                            )
                          }
                        />
                      </label>
                      <label>
                        У
                        <input
                          type="number"
                          value={it.carbs}
                          onChange={(e) =>
                            setCorrectDraft((d) =>
                              d
                                ? {
                                    ...d,
                                    items: d.items.map((x, i) =>
                                      i === idx ? { ...x, carbs: Number(e.target.value) } : x,
                                    ),
                                  }
                                : d,
                            )
                          }
                        />
                      </label>
                      <label className="wide">
                        Аллергены (через запятую)
                        <input
                          type="text"
                          value={it.allergensText}
                          placeholder="например: рыба, глютен"
                          onChange={(e) =>
                            setCorrectDraft((d) =>
                              d
                                ? {
                                    ...d,
                                    items: d.items.map((x, i) =>
                                      i === idx ? { ...x, allergensText: e.target.value } : x,
                                    ),
                                  }
                                : d,
                            )
                          }
                        />
                      </label>
                    </div>
                  ))}
                  <label>
                    Замечание администратора
                    <textarea
                      value={correctDraft.adminNote}
                      onChange={(e) =>
                        setCorrectDraft((d) => (d ? { ...d, adminNote: e.target.value } : d))
                      }
                      rows={2}
                    />
                  </label>
                  {correctError ? <p className="form-error">{correctError}</p> : null}
                  <div className="moderation-actions">
                    <button type="button" className="btn-primary" onClick={onSaveCorrectMeal}>
                      Сохранить правки
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => setCorrectDraft(null)}>
                      <X size={16} /> Отмена
                    </button>
                  </div>
                </div>
              ) : null}
              {pendingTotal > PENDING_PAGE_SIZE ? (
                <p className="muted small">
                  Показано {pendingMeals.length} из {pendingTotal} записей.
                </p>
              ) : null}
              {pendingMeals.length === 0 ? (
                <p className="muted">Очередь пуста.</p>
              ) : (
                <div className="moderation-list">
                  {pendingMeals.map((meal) => (
                    <div key={meal.id} className="moderation-card">
                      <div className="moderation-card-preview">
                        {meal.photoUrl?.startsWith('data:') || meal.photoUrl?.startsWith('http') ? (
                          <img src={meal.photoUrl} alt="" className="meal-thumb" />
                        ) : (
                          <div className="meal-thumb-placeholder">Нет превью</div>
                        )}
                        <div>
                          <p>
                            <strong>ID:</strong> {meal.id.slice(0, 8)}…
                          </p>
                          <p className="muted small">
                            Уверенность: {(meal.confidence * 100).toFixed(0)}% · {meal.status}
                          </p>
                          <ul className="meal-items-preview">
                            {(meal.items ?? []).map((it, idx) => (
                              <li key={idx}>
                                <div>
                                  <strong>{it.foodName}</strong> — {it.calories} ккал
                                  {it.protein != null ? (
                                    <span className="muted small">
                                      {' '}
                                      <MacroRow
                                        protein={it.protein}
                                        fat={it.fat ?? 0}
                                        carbs={it.carbs ?? 0}
                                      />
                                    </span>
                                  ) : null}
                                </div>
                                {/* Аллергены — главное, что нужно модератору для решения. */}
                                {it.allergensFound?.length ? (
                                  <div className="allergen-chips">
                                    {it.allergensFound.map((a) => (
                                      <span key={a} className="allergen-chip">
                                        ⚠ {a}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="muted small">аллергены не обнаружены</div>
                                )}
                                {it.ingredients?.length ? (
                                  <div className="muted small">
                                    Состав: {it.ingredients.map((x) => x.name).join(', ')}
                                  </div>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                      <div className="moderation-actions">
                        <button type="button" className="btn-primary" onClick={() => onConfirmMeal(meal.id)}>
                          Подтвердить
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => onStartCorrectMeal(meal)}
                        >
                          <Pencil size={16} /> Исправить
                        </button>
                        <button type="button" className="btn-danger" onClick={() => onRejectMeal(meal.id)}>
                          <XCircle size={16} /> Отклонить
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
};
