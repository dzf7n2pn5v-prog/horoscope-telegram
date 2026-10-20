// Ежедневная рассылка гороскопа по асцендентам в Telegram-группу.
//
// Запуск:
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... node telegram/daily.mjs
// Проверка без отправки:
//   node telegram/daily.mjs --dry-run
//
// Токен и chat id не хранятся в файле: их передаёт cron или вы в переменных окружения.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// Подгружаем astro.js и texts.js, которые написаны как браузерные скрипты
const context = vm.createContext({});
vm.runInContext(
  readFileSync(join(root, "astro.js"), "utf8") +
    "\n" +
    readFileSync(join(root, "texts.js"), "utf8") +
    "\n;this.SIGNS = SIGNS; this.dailyHoroscope = dailyHoroscope;",
  context,
);
const { SIGNS, dailyHoroscope } = context;

// Читаем telegram/.env (KEY=value), если он есть. Существующие переменные окружения важнее.
function loadEnvFile(path) {
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnvFile(join(here, ".env"));

const DRY_RUN = process.argv.includes("--dry-run");
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Дата по Москве, чтобы день менялся по московскому времени, а не по времени сервера
function moscowDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function moscowDateLabel(now = new Date()) {
  return now.toLocaleDateString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long",
    weekday: "long",
  });
}

// Экранирование для parse_mode=HTML
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function buildMessage(dateKey, label) {
  const blocks = SIGNS.map((sign) => {
    const h = dailyHoroscope(sign.key, dateKey);
    return (
      `${sign.symbol} <b>${esc(sign.name)}</b> асцендент\n` +
      `${esc(h.general)}\n` +
      `💬 ${esc(h.love)}\n` +
      `💼 ${esc(h.work)}\n` +
      `✨ ${esc(h.advice)}`
    );
  });
  return (
    `🌅 <b>Асцендент на ${esc(label)}</b>\n\n` +
    blocks.join("\n\n") +
    "\n\n<i>Развлекательный гороскоп</i>"
  );
}

async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    throw new Error(`Telegram ${res.status}: ${body.description || "unknown error"}`);
  }
  return body.result.message_id;
}

async function main() {
  const now = new Date();
  const text = buildMessage(moscowDateKey(now), moscowDateLabel(now));

  if (DRY_RUN) {
    console.log(text);
    console.log(`\n[dry-run] символов: ${text.length} (лимит Telegram 4096)`);
    return;
  }

  if (!TOKEN || !CHAT_ID) {
    throw new Error("Задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID");
  }
  if (text.length > 4096) {
    throw new Error(`Сообщение длиннее 4096 символов: ${text.length}`);
  }

  const id = await sendTelegram(text);
  console.log(`${new Date().toISOString()} отправлено, message_id=${id}`);
}

main().catch((err) => {
  console.error(`${new Date().toISOString()} ошибка: ${err.message}`);
  process.exit(1);
});
