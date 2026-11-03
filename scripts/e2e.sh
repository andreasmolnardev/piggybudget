#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TMP=$(mktemp -d)
SERVER_PID=
WEB_PID=
cleanup() {
  [ -z "$WEB_PID" ] || kill -- -"$WEB_PID" 2>/dev/null || true
  [ -z "$SERVER_PID" ] || kill -- -"$SERVER_PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

cd "$ROOT"
setsid env PIGGYBUDGET_DEVELOPMENT=true PIGGYBUDGET_HTTP_ADDRESS=127.0.0.1:18190 PIGGYBUDGET_STORAGE_PATH="$TMP/pb_data" go run ./apps/server >"$TMP/server.log" 2>&1 &
SERVER_PID=$!
setsid env VITE_API_URL=http://127.0.0.1:18190 "$ROOT/apps/web/node_modules/.bin/vite" --host 127.0.0.1 --port 15174 >"$TMP/web.log" 2>&1 &
WEB_PID=$!

ready() {
  url=$1
  tries=0
  until curl -fsS "$url" >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -ge 90 ]; then cat "$TMP/server.log" "$TMP/web.log"; return 1; fi
    sleep 1
  done
}
ready http://127.0.0.1:18190/api/health
ready http://127.0.0.1:15174/auth/login
pnpm --filter @piggybudget/web exec playwright test
