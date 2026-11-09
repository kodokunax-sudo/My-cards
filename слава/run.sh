#!/usr/bin/env bash
# Локальный запуск фонтана «Титан»
cd "$(dirname "$0")" || exit 1
PORT="${1:-8000}"
echo "Фонтан «Титан»: http://localhost:$PORT"
if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$PORT"
elif command -v npx >/dev/null 2>&1; then
  npx --yes serve -l "$PORT" .
else
  echo "Нужен python3 или npx" >&2
  exit 1
fi
