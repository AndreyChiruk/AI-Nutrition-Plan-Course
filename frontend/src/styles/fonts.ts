/**
 * Локальное подключение шрифтов IBM Plex.
 *
 * Раньше шрифт Inter подключался через `fonts.googleapis.com` в `index.html`.
 * Это давало три проблемы:
 *   1. внешний запрос при каждой загрузке — приложение не работало
 *      в офлайне и зависело от доступности Google;
 *   2. утечка: запрос уходил на сторонний домен до авторизации;
 *   3. Inter — типовой выбор сгенерированных интерфейсов.
 *
 * Теперь файлы шрифтов лежат в сборке (`@fontsource`), а подключаются
 * только нужные начертания и только с кириллицей + латиницей.
 *
 * IBM Plex выбран потому, что у него полноценная кириллица: буквы
 * спроектированы, а не «дорисованы» к латинскому набору.
 */

// Интерфейс
import '@fontsource/ibm-plex-sans/cyrillic-400.css';
import '@fontsource/ibm-plex-sans/cyrillic-500.css';
import '@fontsource/ibm-plex-sans/cyrillic-600.css';
import '@fontsource/ibm-plex-sans/cyrillic-700.css';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';

// Заголовки
import '@fontsource/ibm-plex-serif/cyrillic-500.css';
import '@fontsource/ibm-plex-serif/cyrillic-600.css';
import '@fontsource/ibm-plex-serif/latin-500.css';
import '@fontsource/ibm-plex-serif/latin-600.css';

// Цифры: метрики, таблицы, калории
import '@fontsource/ibm-plex-mono/cyrillic-400.css';
import '@fontsource/ibm-plex-mono/cyrillic-500.css';
import '@fontsource/ibm-plex-mono/cyrillic-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
