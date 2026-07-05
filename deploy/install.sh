#!/usr/bin/env bash
# Установщик afisha-map для Raspberry Pi / Debian (systemd).
# Сам определяет путь к проекту, пользователя и npm, ставит два сервиса
# (веб-сервер + ежедневный парсинг) и запускает первый сбор данных.
#
# Запуск:  cd afisha-map && bash deploy/install.sh
set -euo pipefail

# --- параметры (можно переопределить через env) ---
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="${SUDO_USER:-$(whoami)}"
PORT="${PORT:-4444}"
SCRAPE_TIME="${SCRAPE_TIME:-06:30}"   # время ежедневного парсинга
NPM_BIN="$(command -v npm || true)"

echo "==> Проект:       $APP_DIR"
echo "==> Пользователь: $RUN_USER"
echo "==> Порт:         $PORT"
echo "==> Парсинг в:    $SCRAPE_TIME ежедневно"

if [ -z "$NPM_BIN" ]; then
  echo "!! npm не найден. Установите Node.js:"
  echo "   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 1
fi
echo "==> npm:          $NPM_BIN ($($NPM_BIN -v))"

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

echo "==> Устанавливаю systemd-юниты в /etc/systemd/system/ …"

$SUDO tee /etc/systemd/system/afisha-map.service >/dev/null <<UNIT
[Unit]
Description=afisha-map — веб-сервер карты выставок
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$NPM_BIN start
Environment=PORT=$PORT
Restart=always
RestartSec=5
User=$RUN_USER

[Install]
WantedBy=multi-user.target
UNIT

$SUDO tee /etc/systemd/system/afisha-scrape.service >/dev/null <<UNIT
[Unit]
Description=afisha-map — обновление данных (парсинг afisha.ru)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$APP_DIR
ExecStart=$NPM_BIN run scrape
User=$RUN_USER
UNIT

$SUDO tee /etc/systemd/system/afisha-scrape.timer >/dev/null <<UNIT
[Unit]
Description=afisha-map — ежедневный парсинг выставок

[Timer]
OnCalendar=*-*-* $SCRAPE_TIME:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT

echo "==> Первый сбор данных (может занять ~2 минуты)…"
( cd "$APP_DIR" && "$NPM_BIN" run scrape )

echo "==> Включаю сервисы…"
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now afisha-map.service
$SUDO systemctl enable --now afisha-scrape.timer

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "Готово! Карта доступна:"
echo "   http://${IP:-<ip-вашего-Pi>}:$PORT"
echo
echo "Полезное:"
echo "   systemctl status afisha-map            # статус сервера"
echo "   systemctl list-timers afisha-scrape.timer   # когда следующий парсинг"
echo "   sudo systemctl start afisha-scrape.service  # запустить парсинг сейчас"
echo "   journalctl -u afisha-scrape.service -n 50   # лог парсинга"
