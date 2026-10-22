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
    "\n" +
    readFileSync(join(root, "sky.js"), "utf8") +
    "\n;this.SIGNS = SIGNS; this.dailyHoroscope = dailyHoroscope; this.sunSignIndex = sunSignIndex; this.dailyJoke = dailyJoke; this.skyAt = skyAt; this.skyParts = skyParts; this.SITUATIONS = SITUATIONS; this.ADVICE_BLOCKS = ADVICE_BLOCKS; this.skyLine = skyLine; this.rotatedTexts = rotatedTexts; this.specialTexts = specialTexts;",
  context,
);
const { SIGNS, dailyHoroscope, sunSignIndex, skyAt, skyParts, skyLine, rotatedTexts, specialTexts } = context;

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

// Погода для фона: Open-Meteo, без ключа. Место по умолчанию — Москва, меняется через WEATHER_LAT/WEATHER_LON
const WEATHER_PLACE = {
  name: process.env.WEATHER_CITY || "Москва",
  lat: Number(process.env.WEATHER_LAT || 55.7558),
  lon: Number(process.env.WEATHER_LON || 37.6173),
};

async function fetchWeather() {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${WEATHER_PLACE.lat}` +
      `&longitude=${WEATHER_PLACE.lon}&current=weather_code,temperature_2m&timezone=Europe%2FMoscow`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = await res.json();
    return { code: j.current.weather_code, temp: Math.round(j.current.temperature_2m) };
  } catch {
    return null;
  }
}

// Код погоды WMO -> подпись и три цвета градиента фона
function weatherTheme(code) {
  if (code === 0) return { label: "ясно", palette: ["#ffb347", "#ff6f61", "#4facfe"] };
  if (code <= 3) return { label: "облачно", palette: ["#7f9cf5", "#5b6ee1", "#2c3e8f"] };
  if (code === 45 || code === 48) return { label: "туман", palette: ["#9aa5b1", "#5f6b7a", "#2f3a48"] };
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82))
    return { label: "дождь", palette: ["#3a7bd5", "#2c5364", "#0f2027"] };
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86))
    return { label: "снег", palette: ["#5d7fa3", "#3b5878", "#1d2f48"] };
  if (code >= 95) return { label: "гроза", palette: ["#6a3093", "#2b1055", "#0d0221"] };
  return { label: "переменная погода", palette: ["#8a2be2", "#ff5e94", "#1e3a8a"] };
}

// Детерминированный генератор: один и тот же день и человек дают одну картинку, разные дни — разные
function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Слои погоды поверх градиента: тучи, дождь, снег, туман, гроза, солнце
function skyLayers(code, rnd, W, H) {
  if (code === undefined) return "";
  const r = (a, b) => a + (b - a) * rnd();
  const clouds = (count, opMin, opMax, yMax) =>
    Array.from({ length: count }, () => {
      const cx = r(-100, W + 100);
      const cy = r(60, yMax);
      const rx = r(160, 340);
      const ry = r(60, 120);
      const op = r(opMin, opMax).toFixed(2);
      return `<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" fill="#ffffff" fill-opacity="${op}"/>`;
    }).join("");
  const rain = (n, color) =>
    Array.from({ length: n }, () => {
      const x = r(0, W);
      const y = r(0, H);
      const len = r(30, 70);
      return `<line x1="${x.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(x - len * 0.3).toFixed(0)}" y2="${(y + len).toFixed(0)}" stroke="${color}" stroke-width="3" stroke-opacity="${r(0.25, 0.55).toFixed(2)}" stroke-linecap="round"/>`;
    }).join("");
  const flakes = (n) =>
    Array.from({ length: n }, () => {
      const x = r(0, W);
      const y = r(0, H);
      return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r(3, 11).toFixed(1)}" fill="#ffffff" fill-opacity="${r(0.5, 0.95).toFixed(2)}"/>`;
    }).join("");
  const sunAt = () => {
    const cx = r(W * 0.55, W * 0.95);
    const cy = r(H * 0.15, H * 0.35);
    const rays = Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return `<line x1="${(cx + Math.cos(a) * 200).toFixed(0)}" y1="${(cy + Math.sin(a) * 200).toFixed(0)}" x2="${(cx + Math.cos(a) * 420).toFixed(0)}" y2="${(cy + Math.sin(a) * 420).toFixed(0)}" stroke="#fff3b0" stroke-width="6" stroke-opacity="0.35"/>`;
    }).join("");
    return `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="140" fill="#fff6c8" fill-opacity="0.85"/>
  <circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="260" fill="#fff6c8" fill-opacity="0.18"/>
  ${rays}`;
  };
  const lightning = () => {
    const x = r(W * 0.3, W * 0.8);
    const y = r(H * 0.2, H * 0.4);
    return `<polyline points="${x},${y} ${x - 40},${y + 120} ${x + 10},${y + 130} ${x - 30},${y + 260}" fill="none" stroke="#ffffff" stroke-width="8" stroke-opacity="0.9"/>`;
  };

  if (code === 0) return sunAt();
  if (code <= 3) return clouds(8, 0.15, 0.3, H * 0.45);
  if (code === 45 || code === 48)
    return Array.from({ length: 6 }, () => {
      const y = r(H * 0.2, H * 0.9);
      return `<rect x="0" y="${y.toFixed(0)}" width="${W}" height="${r(80, 200).toFixed(0)}" fill="#ffffff" fill-opacity="${r(0.08, 0.2).toFixed(2)}"/>`;
    }).join("");
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82))
    return `${clouds(12, 0.25, 0.45, H * 0.5)}${rain(160, "#bfe6ff")}`;
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86))
    return `${clouds(10, 0.35, 0.55, H * 0.45)}${flakes(120)}`;
  if (code >= 95) return `${clouds(12, 0.2, 0.35, H * 0.5)}${rain(200, "#cfe9ff")}${lightning()}`;
  return clouds(5, 0.1, 0.2, H * 0.5);
}

// Карточка 1920x1080 (16:9): слева имя и гороскоп, справа знак
function cardSvg({ name, sign, dateLabel, h, weather, seed }) {
  const W = 1920;
  const H = 1080;
  const weatherLine = `${WEATHER_PLACE.name} · ${weather.temp}°C · ${weather.label}`;
  // длинный гороскоп (больше 5 строк) — компактная раскладка, чтобы всё влезло в 1080 по высоте
  const generalLines = wrap(h.general, 48).slice(0, 7);
  const compact = generalLines.length > 5;
  let y = compact ? 475 : 500;
  const block = (lines, cls, gap) =>
    lines
      .map((line) => {
        const el = `<text x="120" y="${y}" class="${cls}">${xml(line)}</text>`;
        y += gap;
        return el;
      })
      .join("\n  ");

  const general = block(generalLines, "body", compact ? 50 : 58);
  y += compact ? 28 : 36;
  const joke = block(wrap(h.joke, 48).slice(0, 3), "joke", compact ? 50 : 54);
  y += compact ? 32 : 40;
  const advice = block(wrap(h.advice, 48).slice(0, 2), "advice", compact ? 48 : 52);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${weather.palette[0]}"/>
      <stop offset="0.5" stop-color="${weather.palette[1]}"/>
      <stop offset="1" stop-color="${weather.palette[2]}"/>
    </linearGradient>
  </defs>
  <style>
    text { font-family: "DejaVu Sans", "Liberation Sans", Arial, sans-serif; }
    .label { fill: #ffe066; font-size: 34px; letter-spacing: 4px; }
    .date { fill: #ffffff; font-size: 42px; }
    .name { fill: #ffffff; font-size: 96px; font-weight: 700; }
    .sign { fill: #ffe066; font-size: 60px; font-weight: 700; }
    .body { fill: #f4f0ff; font-size: 40px; }
    .joke { fill: #7df9ff; font-size: 38px; font-style: italic; }
    .advice { fill: #ffd166; font-size: 38px; }
    .sky { fill: #ffffff; font-size: 34px; opacity: 0.9; }
  </style>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${skyLayers(weather.code, mulberry32(hashSeed(seed)), W, H)}
  ${h.special ? `<rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="28" fill="none" stroke="#ffd66b" stroke-width="10"/>` : ""}
  <text x="120" y="120" class="label">${h.special ? "ОСОБЕННЫЙ ГОРОСКОП НА СЕГОДНЯ" : "ГОРОСКОП НА СЕГОДНЯ"}</text>
  <text x="120" y="176" class="date">${xml(dateLabel)}</text>
  <text x="120" y="226" class="date">${xml(weatherLine)}</text>
  <text x="120" y="282" class="sky">${xml(h.skyLine || "")}</text>
  <text x="120" y="400" class="name">${xml(name)}</text>
  ${general}
  ${joke}
  ${advice}
  <circle cx="1450" cy="500" r="220" fill="none" stroke="#ffe066" stroke-opacity="0.9" stroke-width="8"/>
  <text x="1450" y="585" text-anchor="middle" font-size="270" fill="#ffe066">${sign.symbol}</text>
  <text x="1450" y="820" text-anchor="middle" class="sign">${xml(sign.name)}</text>
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
  let list = JSON.parse(raw).map((p) => ({ ...p, name: cleanName(p.name) }));
  // ONLY_NAME: отправить только тех, в чьём имени есть эта строка (для точечной отправки)
  if (process.env.ONLY_NAME) list = list.filter((p) => p.name.includes(process.env.ONLY_NAME));
  for (const p of list) {
    if (!p.name || !/^\d{4}-\d{2}-\d{2}$/.test(p.date || "")) {
      throw new Error(`Некорректная запись в EMPLOYEES_JSON: ${JSON.stringify(p)}`);
    }
  }
  return list;
}

// slotStart: номер первого человека в общем порядке (сотрудники с 0, подписчики после них)
function buildPersonalCards(people, dateKey, label, weather, slotStart = 0) {
  // небо на текущий момент: одно на всех, меняется каждый день
  const sky = skyAt(Date.now());
  return people.map((p, i) => {
    const [, month, day] = p.date.split("-").map(Number);
    const sign = SIGNS[sunSignIndex(month, day)];
    // соль по имени: у каждого человека свой текст на день
    const parts = skyParts(sky, p.date);
    // особенный гороскоп: свои позитивные пулы, не пересекаются с общими
    const rt = p.special
      ? specialTexts(dateKey, sky.moonSign, parts.aspect)
      : { ...rotatedTexts(dateKey, slotStart + i), ...parts };
    const h = {
      ...dailyHoroscope(sign.key, `${dateKey}|${p.name}`),
      general: `${rt.moonText} ${rt.aspectText} ${rt.situation[0].toUpperCase()}${rt.situation.slice(1)}.`,
      special: Boolean(p.special),
      advice: rt.advice,
      skyLine: skyLine(sky),
      joke: rt.joke,
    };
    // на карточке только имя: "Фамилия Имя Отчество" -> "Имя"
    const firstName = p.name.split(/\s+/)[1] || p.name;
    const svg = cardSvg({ name: firstName, sign, dateLabel: label, h, weather, seed: `${dateKey}|${p.name}` });
    return { name: p.name, sign, png: renderPng(svg) };
  });
}

// Подписчики из Worker: нужны FEED_URL (адрес /list) и FEED_TOKEN (тот же EXPORT_TOKEN)
async function fetchSubscribers() {
  const url = process.env.FEED_URL;
  const token = process.env.FEED_TOKEN;
  if (!url || !token) return [];
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`подписчики: HTTP ${res.status}`);
  return res.json();
}

async function sendPhotoTo(chatId, png, filename) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
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
    // если погода недоступна, фон по умолчанию
    const current = await fetchWeather();
    const weather = current
      ? { ...current, ...weatherTheme(current.code) }
      : { temp: "–", label: "нет данных", palette: ["#8a2be2", "#ff5e94", "#1e3a8a"] };
    console.log(`погода: ${WEATHER_PLACE.name}, ${weather.temp}°C, ${weather.label}`);
    const cards = buildPersonalCards(people, dateKey, label, weather);
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

    // Подписчики из Worker получают свою карточку в личку
    let subs = await fetchSubscribers();
    console.log(`подписчиков из бота всего: ${subs.length}`);
    if (process.env.ONLY_NAME) subs = subs.filter((sub) => String(sub.name).includes(process.env.ONLY_NAME));
    for (const [j, sub] of subs.entries()) {
      const [subCard] = buildPersonalCards([{ name: sub.name, date: sub.date }], dateKey, label, weather, cards.length + j);
      try {
        const id = await sendPhotoTo(sub.chat_id, subCard.png, `${subCard.name}.png`);
        console.log(`${new Date().toISOString()} личка ${subCard.name}, message_id=${id}`);
      } catch (err) {
        // например, человек заблокировал бота: не останавливаем рассылку
        console.error(`${new Date().toISOString()} личка ${subCard.name}: ${err.message}`);
      }
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
