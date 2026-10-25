#!/bin/zsh
# Внешний доступ к приложению через Cloudflare Tunnel.
#
#   ./tunnel.sh          → поднять туннель и показать ссылку
#   ./tunnel.sh stop     → остановить
#
# Зачем: чтобы дать человеку без технических знаний протестировать
# приложение по обычной ссылке https://…trycloudflare.com.
# Аккаунт Cloudflare не нужен, ссылка живёт, пока идёт тест.
#
# Почему не localtunnel: он часто недоступен и показывает страницу
# с требованием пароля. Cloudflare стабильнее и сразу даёт HTTPS.
#
# ВАЖНО про VPN: Cloudflare требует рабочего доступа к api.trycloudflare.com.
# Без VPN провайдер подменяет DNS и соединение сбрасывается — туннель
# не зарегистрируется. Запускайте при включённом VPN.
#
# Протокол http2 (TCP), а не quic (UDP): через VPN UDP теряется,
# и соединение периодически отваливается.

set -e
cd "$(dirname "$0")"

# Порт 8080 отдаёт приложение по HTTP без редиректа на HTTPS.
# Именно он нужен туннелю: снаружи TLS терминирует Cloudflare.
PORT=8080
CF="cloudflared"

if [ "$1" = "stop" ]; then
  pkill -f "cloudflared tunnel" 2>/dev/null && echo "Туннель остановлен" || echo "Туннель уже не запущен"
  exit 0
fi

if ! command -v "$CF" >/dev/null 2>&1; then
  if [ -x /tmp/cloudflared ]; then
    CF=/tmp/cloudflared
  else
    echo "cloudflared не найден. Установите: brew install cloudflared"
    echo "или скачайте: https://github.com/cloudflare/cloudflared/releases"
    exit 1
  fi
fi

# Проверяем, что приложение действительно отвечает на 8080.
if ! curl -sf -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/"; then
  echo "Приложение не отвечает на http://127.0.0.1:$PORT"
  echo "Сначала запустите:  ./rebuild.sh all"
  exit 1
fi

echo "==> Поднимаю туннель (http2). Ссылка появится ниже."
echo "==> Остановить: Ctrl+C  или  ./tunnel.sh stop"
echo

# Без --url-файла: cloudflared печатает адрес в stdout.
"$CF" tunnel --protocol http2 --url "http://127.0.0.1:$PORT" 2>&1 |
  while IFS= read -r line; do
    # Печатаем только строку со ссылкой, остальное скрываем, чтобы
    # человек сразу увидел адрес и не пугался технических логов.
    case "$line" in
      *trycloudflare.com*)
        url=$(echo "$line" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1)
        if [ -n "$url" ]; then
          echo ""
          echo "════════════════════════════════════════════════════"
          echo "  ССЫЛКА ДЛЯ ТЕСТИРОВАНИЯ:"
          echo "  $url"
          echo "════════════════════════════════════════════════════"
          echo ""
        fi
        ;;
      *ERR*|*error*)
        # Ошибки показываем — иначе непонятно, почему нет ссылки.
        echo "$line"
        ;;
    esac
  done
