#!/bin/zsh
# Переключение оформления: обычное (для защиты) ↔ аккуратное (прежнее).
#
#   ./toggle-design.sh off   — включить «обычный» вид (текущий)
#   ./toggle-design.sh on    — вернуть аккуратный вид
#
# После переключения нужно пересобрать фронтенд: ./rebuild.sh web

FILE="frontend/src/main.tsx"
MARK="plain-theme"

if [ ! -f "$FILE" ]; then
  echo "Не найден $FILE — запустите скрипт из корня проекта."
  exit 1
fi

case "$1" in
  off)
    # Закомментировать импорт — вернуть прежний вид
    sed -i '' "s|^import './styles/plain-theme';|// import './styles/plain-theme';|" "$FILE"
    echo "Оформление: АККУРАТНОЕ (прежнее)."
    ;;
  on)
    # Раскомментировать импорт — включить обычный вид
    sed -i '' "s|^// import './styles/plain-theme';|import './styles/plain-theme';|" "$FILE"
    echo "Оформление: ОБЫЧНОЕ."
    ;;
  *)
    echo "Использование: ./toggle-design.sh on|off"
    echo
    if grep -q "^import './styles/plain-theme';" "$FILE"; then
      echo "Текущее состояние: ОБЫЧНОЕ"
    else
      echo "Текущее состояние: АККУРАТНОЕ"
    fi
    exit 0
    ;;
esac

echo "Теперь пересоберите фронтенд:  ./rebuild.sh web"
