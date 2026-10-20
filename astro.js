// Расчёт асцендента и солнечного знака.
// Асцендент: восточная точка эклиптики на момент рождения для места рождения
// (формула из Meeus, "Astronomical Algorithms", ch. 14 и 26).

const SIGNS = [
  { key: "aries", name: "Овен", symbol: "♈", element: "Огонь", ruler: "Марс" },
  { key: "taurus", name: "Телец", symbol: "♉", element: "Земля", ruler: "Венера" },
  { key: "gemini", name: "Близнецы", symbol: "♊", element: "Воздух", ruler: "Меркурий" },
  { key: "cancer", name: "Рак", symbol: "♋", element: "Вода", ruler: "Луна" },
  { key: "leo", name: "Лев", symbol: "♌", element: "Огонь", ruler: "Солнце" },
  { key: "virgo", name: "Дева", symbol: "♍", element: "Земля", ruler: "Меркурий" },
  { key: "libra", name: "Весы", symbol: "♎", element: "Воздух", ruler: "Венера" },
  { key: "scorpio", name: "Скорпион", symbol: "♏", element: "Вода", ruler: "Плутон" },
  { key: "sagittarius", name: "Стрелец", symbol: "♐", element: "Огонь", ruler: "Юпитер" },
  { key: "capricorn", name: "Козерог", symbol: "♑", element: "Земля", ruler: "Сатурн" },
  { key: "aquarius", name: "Водолей", symbol: "♒", element: "Воздух", ruler: "Уран" },
  { key: "pisces", name: "Рыбы", symbol: "♓", element: "Вода", ruler: "Нептун" },
];

const DEG = Math.PI / 180;
const norm360 = (x) => ((x % 360) + 360) % 360;

// Юлианская дата для момента в UTC
function julianDay(utcMs) {
  return utcMs / 86400000 + 2440587.5;
}

// Гринвичское звёздное время, градусы
function greenwichSiderealDeg(jd) {
  const T = (jd - 2451545.0) / 36525;
  const g =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * T * T -
    (T * T * T) / 38710000;
  return norm360(g);
}

// Эклиптическая долгота восходящего знака (асцендента), градусы 0..360
function ascendantDeg(utcMs, latDeg, lonDeg) {
  const jd = julianDay(utcMs);
  const T = (jd - 2451545.0) / 36525;
  const eps = (23.4392911 - 0.0130042 * T) * DEG; // наклон эклиптики
  const ramc = norm360(greenwichSiderealDeg(jd) + lonDeg) * DEG; // местное звёздное время
  const phi = latDeg * DEG;

  const y = Math.cos(ramc);
  const x = -(Math.sin(ramc) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps));
  return norm360(Math.atan2(y, x) / DEG);
}

// Перевод местного времени города (его смещение от UTC в часах) в UTC-миллисекунды
function localToUtcMs(dateStr, timeStr, utcOffsetHours) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - utcOffsetHours * 3600000;
}

// Знак и градус внутри знака
function describeLongitude(lon) {
  const idx = Math.floor(lon / 30);
  const degree = Math.floor(lon % 30);
  const minute = Math.floor((lon % 1) * 60);
  return { sign: SIGNS[idx], index: idx, degree, minute };
}

// Солнечный знак по дате (упрощённо, по датам входа Солнца в знак)
function sunSignIndex(month, day) {
  // [месяц, день начала знака, индекс знака в SIGNS], по порядку года
  const starts = [
    [1, 20, 10], [2, 19, 11], [3, 21, 0], [4, 20, 1], [5, 21, 2], [6, 21, 3],
    [7, 23, 4], [8, 23, 5], [9, 23, 6], [10, 23, 7], [11, 22, 8], [12, 22, 9],
  ];
  const key = month * 100 + day;
  let result = 9; // до 20 января — Козерог
  for (const [sm, sd, index] of starts) {
    if (sm * 100 + sd <= key) result = index;
  }
  return result;
}

// Главная функция: принимает строки формы и объект города
function computeChart({ date, time, city }) {
  const utcMs = localToUtcMs(date, time, city.utcOffset);
  const asc = ascendantDeg(utcMs, city.lat, city.lon);
  const ascInfo = describeLongitude(asc);

  const [, month, day] = date.split("-").map(Number);
  const sunIndex = sunSignIndex(month, day);

  return {
    ascendant: { ...ascInfo, longitude: asc },
    sun: SIGNS[sunIndex],
    sunIndex,
  };
}
