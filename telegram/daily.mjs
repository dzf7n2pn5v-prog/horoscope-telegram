// Ежедневный гороскоп в Telegram.
//
// Режим 1 (персональный): если задан EMPLOYEES_JSON, для каждого человека
// делается картинка с солнечным знаком и гороскопом на сегодня, картинка уходит через sendPhoto.
//   EMPLOYEES_JSON='[{"name":"Имя Фамилия","date":"1990-05-17"}]'
// Режим 2 (общий): без EMPLOYEES_JSON отправляется текст по всем 12 асцендентам.
//
// Запуск:
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... node telegram/daily.mjs
// Проверка без отправки (картинки пишутся в telegram/out/):
//   node telegram/daily.mjs --dry-run

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { Resvg } from "@resvg/resvg-js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// astro.js и texts.js написаны как браузерные скрипты, подгружаем их в общий контекст
const context = vm.createContext({});
vm.runInContext(
  readFileSync(join(root, "astro.js"), "utf8") +
    "\n" +
    readFileSync(join(root, "texts.js"), "utf8") +
    "\n;this.SIGNS = SIGNS; this.dailyHoroscope = dailyHoroscope; this.sunSignIndex = sunSignIndex; this.dailyJoke = dailyJoke;",
  context,
);
const { SIGNS, dailyHoroscope, sunSignIndex, dailyJoke } = context;

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

// Экранирование для parse_mode=HTML (режим 2)
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Экранирование для SVG (режим 1)
const xml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Перенос текста по словам
function wrap(text, maxChars) {
  const lines = [];
  let cur = "";
  for (const word of String(text).split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = word;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Карточка 1080x1920 (9:16): имя, знак, гороскоп, шутка и совет
function cardSvg({ name, sign, dateLabel, h }) {
  const W = 1080;
  const H = 1920;
  let y = 1140;
  const block = (lines, cls, gap) =>
    lines
      .map((line) => {
        const el = `<text x="90" y="${y}" class="${cls}">${xml(line)}</text>`;
        y += gap;
        return el;
      })
      .join("\n  ");

  const general = block(wrap(h.general, 36).slice(0, 7), "body", 60);
  y += 50;
  const joke = block(wrap(h.joke, 36).slice(0, 4), "joke", 56);
  y += 60;
  const advice = block(wrap(h.advice, 36).slice(0, 3), "advice", 54);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff5e94"/>
      <stop offset="0.5" stop-color="#8a2be2"/>
      <stop offset="1" stop-color="#1e3a8a"/>
    </linearGradient>
  </defs>
  <style>
    text { font-family: "DejaVu Sans", "Liberation Sans", Arial, sans-serif; }
    .label { fill: #ffe066; font-size: 36px; letter-spacing: 4px; }
    .date { fill: #ffffff; font-size: 44px; }
    .name { fill: #ffffff; font-size: 84px; font-weight: 700; }
    .sign { fill: #ffe066; font-size: 66px; font-weight: 700; }
    .body { fill: #f4f0ff; font-size: 42px; }
    .joke { fill: #7df9ff; font-size: 40px; font-style: italic; }
    .advice { fill: #ffd166; font-size: 40px; }
  </style>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <text x="90" y="160" class="label">ГОРОСКОП НА СЕГОДНЯ</text>
  <text x="90" y="225" class="date">${xml(dateLabel)}</text>
  <text x="90" y="430" class="name">${xml(name)}</text>
  <circle cx="${W / 2}" cy="740" r="180" fill="none" stroke="#ffe066" stroke-opacity="0.9" stroke-width="8"/>
  <text x="${W / 2}" y="800" text-anchor="middle" font-size="220" fill="#ffe066">${sign.symbol}</text>
  <text x="${W / 2}" y="1010" text-anchor="middle" class="sign">${xml(sign.name)}</text>
  ${general}
  ${joke}
  ${advice}
</svg>`;
}

// SVG → PNG
function renderPng(svg) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1080 },
    font: { loadSystemFonts: true },
  });
  return resvg.render().asPng();
}

// Персональный режим: список людей из EMPLOYEES_JSON
// Убираем управляющие символы и служебные метки вставки терминала (ESC[200~ и ESC[201~)
function cleanName(name) {
  return String(name)
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\[20[01]~/g, "")
    .replace(/\]\d+;rgb:[0-9a-fA-F/]+/g, "")
    .replace(/\[\d+(;\d+)*R/g, "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
}

function loadEmployees() {
  const raw = process.env.EMPLOYEES_JSON;
  if (!raw) return null;
  const list = JSON.parse(raw).map((p) => ({ ...p, name: cleanName(p.name) }));
  for (const p of list) {
    if (!p.name || !/^\d{4}-\d{2}-\d{2}$/.test(p.date || "")) {
      throw new Error(`Некорректная запись в EMPLOYEES_JSON: ${JSON.stringify(p)}`);
    }
  }
  return list;
}

function buildPersonalCards(people, dateKey, label) {
  return people.map((p) => {
    const [, month, day] = p.date.split("-").map(Number);
    const sign = SIGNS[sunSignIndex(month, day)];
    // соль по имени: у каждого человека свой текст на день
    const h = {
      ...dailyHoroscope(sign.key, `${dateKey}|${p.name}`),
      joke: dailyJoke(sign.key, `${dateKey}|${p.name}`),
    };
    // на карточке только имя: "Фамилия Имя Отчество" -> "Имя"
    const firstName = p.name.split(/\s+/)[1] || p.name;
    const svg = cardSvg({ name: firstName, sign, dateLabel: label, h });
    return { name: p.name, sign, png: renderPng(svg) };
  });
}

async function sendPhoto(png, filename) {
  const form = new FormData();
  form.append("chat_id", CHAT_ID);
  form.append("photo", new Blob([png], { type: "image/png" }), filename);
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendPhoto`, {
    method: "POST",
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) {
    throw new Error(`Telegram ${res.status}: ${body.description || "unknown error"}`);
  }
  return body.result.message_id;
}

async function sendText(text) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
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

// Режим 2: текст по всем 12 асцендентам
function buildGeneralText(dateKey, label) {
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

async function main() {
  const now = new Date();
  const dateKey = moscowDateKey(now);
  const label = moscowDateLabel(now);
  const people = loadEmployees();

  if (people) {
    const cards = buildPersonalCards(people, dateKey, label);
    if (DRY_RUN) {
      const outDir = join(here, "out");
      mkdirSync(outDir, { recursive: true });
      for (const c of cards) {
        const file = join(outDir, `${c.name.replace(/[^\p{L}\p{N}]+/gu, "_")}.png`);
        writeFileSync(file, c.png);
        console.log(`${c.name}: ${c.sign.name} -> ${file}`);
      }
      return;
    }
    if (!TOKEN || !CHAT_ID) throw new Error("Задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID");
    for (const c of cards) {
      const id = await sendPhoto(c.png, `${c.name}.png`);
      console.log(`${new Date().toISOString()} отправлено ${c.name}, message_id=${id}`);
      await new Promise((r) => setTimeout(r, 1100));
    }
    return;
  }

  const text = buildGeneralText(dateKey, label);
  if (DRY_RUN) {
    console.log(text);
    console.log(`\n[dry-run] символов: ${text.length} (лимит Telegram 4096)`);
    return;
  }
  if (!TOKEN || !CHAT_ID) throw new Error("Задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID");
  if (text.length > 4096) throw new Error(`Сообщение длиннее 4096 символов: ${text.length}`);
  const id = await sendText(text);
  console.log(`${new Date().toISOString()} отправлено, message_id=${id}`);
}

main().catch((err) => {
  console.error(`${new Date().toISOString()} ошибка: ${err.message}`);
  process.exit(1);
});
