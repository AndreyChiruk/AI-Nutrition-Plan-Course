#!/bin/zsh
# Переключение оформления: обычное (для защиты) ↔ аккуратное (прежнее).
#
#   ./toggle-design.sh off   — вернуть аккуратный вид
#   ./toggle-design.sh on    — включить «обычный» вид (текущий)
#
# Переключает ДВА независимых слоя:
#   1. оформление  — frontend/src/styles/plain-theme.css
#   2. иконки      — флаг PLAIN_ICONS в frontend/src/components/icons.tsx
#
# После переключения нужно пересобрать фронтенд: ./rebuild.sh web

FILE="frontend/src/main.tsx"
ICONS="frontend/src/components/icons.tsx"

if [ ! -f "$FILE" ]; then
  echo "Не найден $FILE — запустите скрипт из корня проекта."
  exit 1
fi

case "$1" in
  off)
    sed -i '' "s|^import './styles/plain-theme';|// import './styles/plain-theme';|" "$FILE"
    sed -i '' 's/^const PLAIN_ICONS = true;/const PLAIN_ICONS = false;/' "$ICONS"
    echo "Вид: АККУРАТНЫЙ (прежний) — SVG-иконки, шрифт IBM Plex, скругления 4px."
    ;;
  on)
    sed -i '' "s|^// import './styles/plain-theme';|import './styles/plain-theme';|" "$FILE"
    sed -i '' 's/^const PLAIN_ICONS = false;/const PLAIN_ICONS = true;/' "$ICONS"
    echo "Вид: ОБЫЧНЫЙ — текстовые символы вместо иконок, Arial, прямые углы."
    ;;
  *)
    echo "Использование: ./toggle-design.sh on|off"
    echo
    th=$(grep -c "^import './styles/plain-theme';" "$FILE")
    ic=$(grep -c "^const PLAIN_ICONS = true;" "$ICONS")
    if [ "$th" -gt 0 ] && [ "$ic" -gt 0 ]; then
      echo "Текущее состояние: ОБЫЧНОЕ (оформление + символы)"
    elif [ "$th" -eq 0 ] && [ "$ic" -eq 0 ]; then
      echo "Текущее состояние: АККУРАТНОЕ (прежнее)"
    else
      echo "ВНИМАНИЕ: слои рассинхронизированы — запустите 'on' или 'off'"
    fi
    exit 0
    ;;
esac

echo "Теперь пересоберите фронтенд:  ./rebuild.sh web"
