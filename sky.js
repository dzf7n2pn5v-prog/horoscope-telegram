// Положение Солнца, Луны и планет на момент времени (упрощённые элементы Шлайтера, точность около 1°).
// Используется для гороскопа «по текущему небу»: знак Луны, фаза, ретроградность Меркурия, аспект к солнечному знаку.

const SKY_DEG = Math.PI / 180;
const skyNorm = (x) => ((x % 360) + 360) % 360;

// Орбитальные элементы: d — дни с 2000-01-00 UT
const ELEMENTS = {
  sun: (d) => ({ w: 282.9404 + 4.70935e-5 * d, a: 1, e: 0.016709 - 1.151e-9 * d, M: 356.047 + 0.9856002585 * d }),
  moon: (d) => ({ N: 125.1228 - 0.0529538083 * d, i: 5.1454, w: 318.0634 + 0.1643573223 * d, a: 60.2666, e: 0.0549, M: 115.3654 + 13.0649929509 * d }),
  mercury: (d) => ({ N: 48.3313 + 3.24587e-5 * d, i: 7.0047 + 5e-8 * d, w: 29.1241 + 1.01444e-5 * d, a: 0.387098, e: 0.205635 + 5.59e-10 * d, M: 168.6562 + 4.0923344368 * d }),
  venus: (d) => ({ N: 76.6799 + 2.4659e-5 * d, i: 3.3946 + 2.75e-8 * d, w: 54.891 + 1.38374e-5 * d, a: 0.72333, e: 0.006773 - 1.302e-9 * d, M: 48.0052 + 1.6021302244 * d }),
  mars: (d) => ({ N: 49.5574 + 2.11081e-5 * d, i: 1.8497 - 1.78e-8 * d, w: 286.5016 + 2.92961e-5 * d, a: 1.523688, e: 0.093405 + 2.516e-9 * d, M: 18.6021 + 0.5240207766 * d }),
};

// Гелиоцентрические/геоцентрические координаты эклиптической долготы
function eccentricPosition(el) {
  const M = skyNorm(el.M) * SKY_DEG;
  let E = M;
  for (let k = 0; k < 6; k++) E = E - (E - el.e * Math.sin(E) - M) / (1 - el.e * Math.cos(E));
  const xv = el.a * (Math.cos(E) - el.e);
  const yv = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  return { v: Math.atan2(yv, xv) / SKY_DEG, r: Math.hypot(xv, yv) };
}

// Долгота Солнца (геоцентрическая) и вектор Земля—Солнце
function sunVector(d) {
  const el = ELEMENTS.sun(d);
  const { v, r } = eccentricPosition(el);
  const lon = skyNorm(v + el.w);
  return { lon, x: r * Math.cos(lon * SKY_DEG), y: r * Math.sin(lon * SKY_DEG) };
}

// Геоцентрическая эклиптическая долгота планеты или Луны
function bodyLongitude(name, d, sun) {
  const el = ELEMENTS[name](d);
  const { v, r } = eccentricPosition(el);
  const u = (v + el.w) * SKY_DEG;
  const N = el.N * SKY_DEG;
  const i = el.i * SKY_DEG;
  const xh = r * (Math.cos(N) * Math.cos(u) - Math.sin(N) * Math.sin(u) * Math.cos(i));
  const yh = r * (Math.sin(N) * Math.cos(u) + Math.cos(N) * Math.sin(u) * Math.cos(i));
  if (name === "moon") return skyNorm(Math.atan2(yh, xh) / SKY_DEG);
  // планеты: гелиоцентрическая позиция плюс вектор Солнца (вычитаем положение Земли)
  return skyNorm(Math.atan2(yh + sun.y, xh + sun.x) / SKY_DEG);
}

// Все нужные величины на момент utcMs
function skyAt(utcMs) {
  const d = utcMs / 86400000 + 2440587.5 - 2451543.5;
  const sun = sunVector(d);
  const moon = bodyLongitude("moon", d, sun);
  const mercury = bodyLongitude("mercury", d, sun);
  const mercuryNext = bodyLongitude("mercury", d + 1, sunVector(d + 1));
  const retrograde = skyNorm(mercuryNext - mercury + 180) - 180 < 0;
  return {
    sunLon: sun.lon,
    moonLon: moon,
    moonSign: Math.floor(moon / 30),
    mercurySign: Math.floor(mercury / 30),
    venusSign: Math.floor(bodyLongitude("venus", d, sun) / 30),
    marsSign: Math.floor(bodyLongitude("mars", d, sun) / 30),
    mercuryRetrograde: retrograde,
    phaseAngle: skyNorm(moon - sun.lon),
  };
}

// Долгота Солнца в момент рождения (по дате, полдень UTC)
function natalSunLongitude(dateStr) {
  const [y, m, day] = dateStr.split("-").map(Number);
  const d = Date.UTC(y, m - 1, day, 12) / 86400000 + 2440587.5 - 2451543.5;
  return sunVector(d).lon;
}

// Фаза Луны по углу Луна—Солнце
function moonPhaseLabel(angle) {
  if (angle < 22.5 || angle >= 337.5) return "новолуние";
  if (angle < 67.5) return "растущий серп";
  if (angle < 112.5) return "первая четверть";
  if (angle < 157.5) return "растущая Луна";
  if (angle < 202.5) return "полнолуние";
  if (angle < 247.5) return "убывающая Луна";
  if (angle < 292.5) return "последняя четверть";
  return "убывающий серп";
}

// Аспект Луны сегодня к солнечной долготе человека (орбис 8°)
function aspectToNatalSun(moonLon, natalSunLon) {
  const diff = skyNorm(moonLon - natalSunLon);
  const near = (target) => Math.abs(((diff - target + 540) % 360) - 180) <= 8;
  if (near(0)) return "conjunction";
  if (near(60)) return "sextile";
  if (near(90)) return "square";
  if (near(120)) return "trine";
  if (near(180)) return "opposition";
  return null;
}

// Тексты по небу. Знак Луны меняется примерно каждые два с половиной дня, фаза — раз в 29.5 дней.
const MOON_IN_SIGN = [
  "Луна в Овне: пора действовать, а не ждать, пока кто-то другой начнёт первым.",
  "Луна в Тельце: сегодня главное удовольствие от вкусного и уютного, никакой спешки.",
  "Луна в Близнецах: язык работает быстрее мозга, так что говорите, но с улыбкой.",
  "Луна в Раке: тянет домой, к пледу и близким, и это абсолютно законно.",
  "Луна во Льве: день для блеска, тёплых слов и смелых причёсок.",
  "Луна в Деве: вы замечаете всё, даже пыль на экране, и это ваша суперсила сегодня.",
  "Луна в Весах: дипломатия на подъёме, сегодня вы мастер компромисса.",
  "Луна в Скорпионе: интуиция кричит громче кофе, слушайте её, но не читайте чужие письма.",
  "Луна в Стрельце: тянет в путешествие, хотя бы до ближайшего парка.",
  "Луна в Козероге: дела идут по плану, и вы выглядите серьёзнее, чем обычно.",
  "Луна в Водолее: идеи нестандартные, как и вы, так что не прячьте их.",
  "Луна в Рыбах: мечтательность на максимуме, но не забудьте вернуться к обеду.",
];

const PHASE_TEXT = {
  "новолуние": "Новолуние: самое время записать мечту на бумажку и не потерять.",
  "растущий серп": "Растущий серп: силы прибывают, начинайте с малого.",
  "первая четверть": "Первая четверть: время решений и маленьких рывков.",
  "растущая Луна": "Растущая Луна: удачный день для планов, знакомств и новых рецептов.",
  "полнолуние": "Полнолуние: эмоции кипят, так что резкие решения лучше отложить до утра.",
  "убывающая Луна": "Убывающая Луна: самое время отпускать лишнее, включая старые носки.",
  "последняя четверть": "Последняя четверть: пора подвести итоги и похвалить себя.",
  "убывающий серп": "Убывающий серп: день для отдыха и тишины, можно даже без сериалов.",
};

// Аспект Луны сегодня к солнечному знаку человека
const ASPECT_TEXT = {
  conjunction: "Луна сегодня обнимает ваше Солнце: вы в центре внимания, и это вам идёт.",
  sextile: "Луна сегодня в секстиле к вашему Солнцу: дружеская поддержка и хорошее настроение.",
  square: "Луна сегодня в квадрате к вашему Солнцу: мелкие перепалки возможны, не спорьте с чайником.",
  trine: "Луна сегодня в тригоне к вашему Солнцу: всё катится легко, как по маслу.",
  opposition: "Луна сегодня смотрит на ваше Солнце в упор: баланс работы и отдыха станет темой дня.",
  none: "Сегодня спокойный фон: двигайтесь в своём ритме и не спешите.",
};

// Одна строка с описанием неба для карточки
function skyLine(sky) {
  const phase = moonPhaseLabel(sky.phaseAngle);
  return `Луна в ${["Овне", "Тельце", "Близнецах", "Раке", "Льве", "Деве", "Весах", "Скорпионе", "Стрельце", "Козероге", "Водолее", "Рыбах"][sky.moonSign]} · ${phase} · Меркурий ${sky.mercuryRetrograde ? "ретроградный" : "прямой"}`;
}

// Гороскоп на день для человека: текст из неба и его солнечного знака
function skyHoroscope(sky, birthDate) {
  const aspect = aspectToNatalSun(sky.moonLon, natalSunLongitude(birthDate)) || "none";
  const phase = moonPhaseLabel(sky.phaseAngle);
  const retro = sky.mercuryRetrograde ? " Меркурий ретроградный: перепроверяйте письма и договорённости." : "";
  return {
    general: `${MOON_IN_SIGN[sky.moonSign]} ${PHASE_TEXT[phase]} ${ASPECT_TEXT[aspect]}${retro}`,
    skyLine: skyLine(sky),
  };
}


// Части гороскопа для одного человека: знак Луны и аспект к его Солнцу
function skyParts(sky, birthDate) {
  const aspect = aspectToNatalSun(sky.moonLon, natalSunLongitude(birthDate)) || "none";
  return { moonText: MOON_IN_SIGN[sky.moonSign], aspectText: ASPECT_TEXT[aspect], aspect };
}
