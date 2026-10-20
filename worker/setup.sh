#!/usr/bin/env bash
# Одноразовая настройка подписок. Запускать в терминале, где задан CLOUDFLARE_API_TOKEN:
#   bash worker/setup.sh
# Секреты генерируются здесь и не выводятся в терминал.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$HERE/../telegram/.env"
REPO="dzf7n2pn5v-prog/horoscope-telegram"
BOT_TOKEN="$(grep '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
cd "$HERE"

if grep -q 'REPLACE_WITH_KV_ID' wrangler.toml; then
  echo "Создаю KV-хранилище SUBS..."
  KV_OUT="$(npx wrangler kv namespace create SUBS)"
  KV_ID="$(echo "$KV_OUT" | grep -oE '[0-9a-f]{32}' | head -1)"
  sed -i '' "s/REPLACE_WITH_KV_ID/$KV_ID/" wrangler.toml
  echo "KV готово."
fi

WEBHOOK_SECRET="$(openssl rand -hex 24)"
EXPORT_TOKEN="$(openssl rand -hex 24)"

echo "Загружаю секреты в Cloudflare..."
printf '%s' "$BOT_TOKEN" | npx wrangler secret put BOT_TOKEN
printf '%s' "$WEBHOOK_SECRET" | npx wrangler secret put WEBHOOK_SECRET
printf '%s' "$EXPORT_TOKEN" | npx wrangler secret put EXPORT_TOKEN

echo "Публикую worker..."
URL="$(npx wrangler deploy | grep -oE 'https://[^ ]+\.workers\.dev' | head -1)"
echo "Адрес: $URL"

echo "Подключаю webhook к боту..."
curl -s "https://api.telegram.org/bot$BOT_TOKEN/setWebhook" \
  -d "url=$URL/webhook" -d "secret_token=$WEBHOOK_SECRET"
echo

echo "Передаю адрес и токен в GitHub Actions..."
printf '%s' "$URL/list" | gh secret set FEED_URL -R "$REPO"
printf '%s' "$EXPORT_TOKEN" | gh secret set FEED_TOKEN -R "$REPO"

echo "Готово. Напишите боту /start, чтобы проверить."
