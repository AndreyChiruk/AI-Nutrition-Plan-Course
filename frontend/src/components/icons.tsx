/**
 * Обёртка над иконками.
 *
 * Зачем: в студенческой версии оформления иконки не нужны, но они
 * используются в 18 файлах (~108 мест). Править каждый файл — риск
 * сломать разметку и потерять прежний вид.
 *
 * Решение: все страницы импортируют иконки ОТСЮДА, а не напрямую из
 * `lucide-react`. Тогда достаточно переключить одну константу ниже —
 * и весь проект переходит на текстовые символы вместо SVG.
 *
 * Символы подобраны так, чтобы сохранить смысл элемента (плюс, крестик,
 * предупреждение). Там, где замены нет, выводится пустой фрагмент —
 * место занимает сам текст подписи.
 */
import type { ComponentType, SVGProps } from 'react';
import * as Lucide from 'lucide-react';

/**
 * Тип иконки для описания навигации и списков.
 * Совпадает с LucideIcon, но допускает и текстовую замену.
 */
export type LucideIcon = ComponentType<IconProps>;

/**
 * `true` — иконки заменяются текстовыми символами (слабое оформление).
 * `false` — используются обычные SVG из `lucide-react`.
 *
 * Чтобы вернуть прежний вид — поставьте `false` и пересоберите web.
 */
const PLAIN_ICONS = true;

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  strokeWidth?: number | string;
};

/**
 * Текстовые замены для часто используемых иконок.
 * Ключ — имя иконки в Lucide, значение — символ.
 */
const TEXT_GLYPHS: Record<string, string> = {
  // Действия
  Plus: '+',
  X: '×',
  Check: '✓',
  Minus: '−',
  Trash2: '×',
  Pencil: '✎',
  Save: '✓',
  Copy: '⎘',
  Download: '↓',
  Upload: '↑',
  UploadCloud: '↑',
  Search: '⟳',
  RefreshCw: '⟳',
  Settings: '⚙',
  LogOut: '→',
  Eye: '○',
  EyeOff: '●',
  Lock: '×',

  // Навигация
  Menu: '≡',
  ChevronDown: '▾',
  ChevronUp: '▴',
  ChevronLeft: '‹',
  ChevronRight: '›',
  ArrowRight: '→',
  ArrowLeft: '←',

  // Состояния
  AlertTriangle: '!',
  AlertCircle: '!',
  CheckCircle2: '✓',
  Info: 'i',
  Loader2: '',

  // Тема
  Sun: '○',
  Moon: '●',
  XCircle: '×',
  Users2: '○○',
  KeyRound: '⚿',
  Droplet: '◦',
  Utensils: '≡',
};

/**
 * Возвращает компонент иконки.
 *
 * В обычном режиме — текстовый символ (`<span>`), иначе — SVG Lucide.
 * Сигнатура совпадает с Lucide, поэтому вызовы менять не нужно.
 */
function icon(name: string): ComponentType<IconProps> {
  const Original = (Lucide as unknown as Record<string, ComponentType<IconProps>>)[name];

  if (!PLAIN_ICONS) {
    return Original ?? (() => null);
  }

  const Plain = ({ size = 16, className = '', ...rest }: IconProps) => {
    const glyph = TEXT_GLYPHS[name];
    // Для иконок без замены ничего не рисуем: подпись рядом уже
    // объясняет назначение элемента.
    if (!glyph) return null;

    const px = typeof size === 'number' ? size : Number(size) || 16;
    return (
      <span
        className={`icon-glyph ${className}`.trim()}
        style={{ fontSize: Math.max(11, Math.round(px * 0.85)), lineHeight: 1 }}
        aria-hidden
        {...(rest as Record<string, unknown>)}
      >
        {glyph}
      </span>
    );
  };

  Plain.displayName = `Plain${name}`;
  return Plain;
}

// ─── Экспорт иконок, используемых в проекте ──────────────────────────────

export const Activity = icon('Activity');
export const AlertCircle = icon('AlertCircle');
export const AlertTriangle = icon('AlertTriangle');
export const Apple = icon('Apple');
export const ArrowLeft = icon('ArrowLeft');
export const ArrowRight = icon('ArrowRight');
export const BarChart3 = icon('BarChart3');
export const Brain = icon('Brain');
export const CalendarClock = icon('CalendarClock');
export const Camera = icon('Camera');
export const Check = icon('Check');
export const CheckCircle2 = icon('CheckCircle2');
export const ChefHat = icon('ChefHat');
export const ChevronDown = icon('ChevronDown');
export const ChevronRight = icon('ChevronRight');
export const ChevronUp = icon('ChevronUp');
export const CircleUserRound = icon('CircleUserRound');
export const ClipboardList = icon('ClipboardList');
export const Coffee = icon('Coffee');
export const Copy = icon('Copy');
export const CookingPot = icon('CookingPot');
export const CreditCard = icon('CreditCard');
export const Download = icon('Download');
export const Dumbbell = icon('Dumbbell');
export const Eye = icon('Eye');
export const EyeOff = icon('EyeOff');
export const FolderOpen = icon('FolderOpen');
export const Home = icon('Home');
export const ImageOff = icon('ImageOff');
export const ImagePlus = icon('ImagePlus');
export const Info = icon('Info');
export const LayoutList = icon('LayoutList');
export const Leaf = icon('Leaf');
export const LineChart = icon('LineChart');
export const ListChecks = icon('ListChecks');
export const Loader2 = icon('Loader2');
export const Lock = icon('Lock');
export const LogOut = icon('LogOut');
export const Mail = icon('Mail');
export const Menu = icon('Menu');
export const MessageCircle = icon('MessageCircle');
export const MessageSquare = icon('MessageSquare');
export const Moon = icon('Moon');
export const Package = icon('Package');
export const Pencil = icon('Pencil');
export const Plus = icon('Plus');
export const Refrigerator = icon('Refrigerator');
export const Salad = icon('Salad');
export const Save = icon('Save');
export const Scale = icon('Scale');
export const Search = icon('Search');
export const Settings = icon('Settings');
export const Shield = icon('Shield');
export const ShieldAlert = icon('ShieldAlert');
export const ShoppingBasket = icon('ShoppingBasket');
export const Soup = icon('Soup');
export const Sparkles = icon('Sparkles');
export const Sun = icon('Sun');
export const Target = icon('Target');
export const Trash2 = icon('Trash2');
export const TrendingDown = icon('TrendingDown');
export const Upload = icon('Upload');
export const UploadCloud = icon('UploadCloud');
export const User = icon('User');
export const UserPen = icon('UserPen');
export const UtensilsCrossed = icon('UtensilsCrossed');
export const Wallet = icon('Wallet');
export const Wheat = icon('Wheat');
export const X = icon('X');
export const XCircle = icon('XCircle');
export const Users2 = icon('Users2');
export const KeyRound = icon('KeyRound');
export const Droplet = icon('Droplet');
export const Utensils = icon('Utensils');
