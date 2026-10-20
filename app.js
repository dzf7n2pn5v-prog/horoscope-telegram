// Логика интерфейса: форма, расчёт, вывод гороскопа.

const STORAGE_KEY = "ascendant-birth-data";

const els = {
  form: document.getElementById("birth-form"),
  date: document.getElementById("birth-date"),
  time: document.getElementById("birth-time"),
  city: document.getElementById("birth-city"),
  error: document.getElementById("form-error"),
  formCard: document.getElementById("form-card"),
  result: document.getElementById("result"),
  ascSymbol: document.getElementById("asc-symbol"),
  ascName: document.getElementById("asc-name"),
  ascMeta: document.getElementById("asc-meta"),
  sunLine: document.getElementById("sun-line"),
  todayDate: document.getElementById("today-date"),
  todaySections: document.getElementById("today-sections"),
  todayAdvice: document.getElementById("today-advice"),
  changeBtn: document.getElementById("change-btn"),
};

// Заполнить список городов
CITIES.forEach((city, i) => {
  const opt = document.createElement("option");
  opt.value = String(i);
  opt.textContent = city.name;
  els.city.appendChild(opt);
});

// Локальное сохранение данных, чтобы не вводить их каждый раз (только на этом устройстве)
function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // приватный режим или заблокированное хранилище: просто не сохраняем
  }
}

// Ключ дня по местной дате устройства, например "2026-10-20"
function todayKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function formatToday() {
  return new Date().toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "long",
  });
}

function renderResult(input) {
  const city = CITIES[Number(input.cityIndex)];
  const chart = computeChart({ date: input.date, time: input.time, city });
  const asc = chart.ascendant;
  const ascSign = asc.sign;

  els.ascSymbol.textContent = ascSign.symbol;
  els.ascName.textContent = ascSign.name;
  els.ascMeta.textContent =
    `${asc.degree}°${String(asc.minute).padStart(2, "0")}′ · ${ascSign.element} · управитель: ${ascSign.ruler}`;

  els.sunLine.textContent = `${chart.sun.symbol} ${chart.sun.name} · ${chart.sun.element}`;

  const h = dailyHoroscope(ascSign.key, todayKey());
  els.todayDate.textContent = formatToday();
  els.todaySections.innerHTML = "";
  [
    ["Характер", h.trait],
    ["Общее", h.general],
    ["Любовь", h.love],
    ["Работа и дела", h.work],
  ].forEach(([title, text]) => {
    const dt = document.createElement("dt");
    dt.textContent = title;
    const dd = document.createElement("dd");
    dd.textContent = text;
    els.todaySections.append(dt, dd);
  });
  els.todayAdvice.textContent = h.advice;

  els.formCard.hidden = true;
  els.result.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showForm(prefill) {
  if (prefill) {
    els.date.value = prefill.date;
    els.time.value = prefill.time;
    els.city.value = prefill.cityIndex;
  }
  els.result.hidden = true;
  els.formCard.hidden = false;
}

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  els.error.hidden = true;

  const date = els.date.value;
  const time = els.time.value;
  if (!date || !time) {
    els.error.textContent = "Укажите дату и время рождения.";
    els.error.hidden = false;
    return;
  }

  const input = { date, time, cityIndex: els.city.value };
  saveData(input);
  renderResult(input);
});

els.changeBtn.addEventListener("click", () => showForm(loadSaved()));

// Старт: если данные уже сохранены, сразу показываем результат
const saved = loadSaved();
if (saved && saved.date && saved.time && saved.cityIndex !== undefined) {
  showForm(saved);
  renderResult(saved);
} else {
  els.date.value = "1990-01-01";
  els.time.value = "12:00";
}
