// Обработчик Telegram webhook: подписка сотрудников на персональный гороскоп.
// Команды: /start — начать, /stop — отписаться.
// Данные хранятся в KV (привязка SUBS): ключ sub:<chat_id> — подписчик, state:<chat_id> — шаг анкеты.

const tg = (env, method, body) =>
  fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const say = (env, chat_id, text) => tg(env, "sendMessage", { chat_id, text });

// ДД.ММ.ГГГГ -> ГГГГ-ММ-ДД, либо null, если дата некорректна или в будущем
function parseDate(s) {
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCDate() !== d || dt.getUTCMonth() !== mo - 1) return null;
  if (y < 1900 || dt > new Date()) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

async function handle(env, msg) {
  const id = msg.chat.id;
  const text = msg.text.trim();
  const subKey = `sub:${id}`;
  const stateKey = `state:${id}`;

  if (text === "/stop") {
    await env.SUBS.delete(subKey);
    await env.SUBS.delete(stateKey);
    return say(env, id, "Вы отписаны. Чтобы снова подписаться, напишите /start.");
  }

  if (text === "/start") {
    await env.SUBS.put(stateKey, JSON.stringify({ step: "name" }));
    return say(
      env,
      id,
      "Привет! Я присылаю персональный гороскоп на день.\nНапишите фамилию и имя, например: Иванов Иван.",
    );
  }

  const state = await env.SUBS.get(stateKey, "json");
  if (!state) return say(env, id, "Чтобы подписаться, напишите /start.");

  if (state.step === "name") {
    if (text.split(/\s+/).length < 2) {
      return say(env, id, "Напишите фамилию и имя через пробел, например: Иванов Иван.");
    }
    await env.SUBS.put(stateKey, JSON.stringify({ step: "date", name: text }));
    return say(env, id, "Спасибо! Теперь дата рождения в формате ДД.ММ.ГГГГ, например 17.05.1990.");
  }

  if (state.step === "date") {
    const iso = parseDate(text);
    if (!iso) return say(env, id, "Не понял дату. Формат: ДД.ММ.ГГГГ, например 17.05.1990.");
    await env.SUBS.put(stateKey, JSON.stringify({ step: "city", name: state.name, date: iso }));
    return say(env, id, "Из какого вы города? Например: Москва, Киев, Краматорск.");
  }

  if (state.step === "city") {
    const city = text.replace(/\s+/g, " ");
    if (city.length < 2) return say(env, id, "Напишите город, например: Москва.");
    await env.SUBS.put(
      subKey,
      JSON.stringify({ chat_id: id, name: state.name, date: state.date, city }),
    );
    await env.SUBS.delete(stateKey);
    return say(
      env,
      id,
      "Готово! Каждое утро в 09:00 буду присылать ваш гороскоп. Отписаться можно командой /stop.",
    );
  }
}

// Cron-триггер Cloudflare (06:00 UTC = 09:00 по Москве): запускает рассылку через GitHub Actions
async function dispatchDaily(env) {
  const res = await fetch(
    "https://api.github.com/repos/dzf7n2pn5v-prog/horoscope-telegram/actions/workflows/daily.yml/dispatches",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "horoscope-subs",
      },
      body: JSON.stringify({ ref: "main" }),
    },
  );
  if (!res.ok) throw new Error(`GitHub dispatch ${res.status}`);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatchDaily(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    // Telegram присылает обновления сюда; секрет проверяет подлинность запроса
    if (request.method === "POST" && url.pathname === "/webhook") {
      if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      const update = await request.json();
      const msg = update.message;
      if (msg && msg.text && msg.chat.type === "private") await handle(env, msg);
      return new Response("ok");
    }

    // Список подписчиков для ежедневной рассылки (защищён токеном)
    if (request.method === "GET" && url.pathname === "/list") {
      if (request.headers.get("Authorization") !== `Bearer ${env.EXPORT_TOKEN}`) {
        return new Response("forbidden", { status: 403 });
      }
      const keys = await env.SUBS.list({ prefix: "sub:" });
      const out = [];
      for (const k of keys.keys) {
        const v = await env.SUBS.get(k.name, "json");
        if (v) out.push(v);
      }
      return Response.json(out);
    }

    return new Response("not found", { status: 404 });
  },
};
