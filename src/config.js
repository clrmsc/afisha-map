// Настройки парсера и сервера. Все параметры можно переопределить через env.

export const BASE = 'https://www.afisha.ru';

// Раздел афиши, который парсим. Можно поменять на другой город/фильтр:
//   /msk/schedule_exhibition/na-segodnya/      — выставки в Москве на сегодня
//   /spb/schedule_exhibition/na-segodnya/      — Питер
//   /msk/schedule_concert/na-segodnya/         — концерты и т.д.
export const LIST_PATH = process.env.LIST_PATH || '/msk/schedule_exhibition/na-segodnya/';

// Пауза между запросами, чтобы не долбить сайт (мс). На Pi можно оставить как есть.
export const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 700);

// Ограничение числа страниц листинга (0 = без ограничения, парсим все).
export const MAX_PAGES = Number(process.env.MAX_PAGES || 0);

// Разрешить геокодирование через OpenStreetMap Nominatim,
// если у площадки на afisha не оказалось координат.
export const USE_NOMINATIM = process.env.USE_NOMINATIM !== '0';

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const PORT = Number(process.env.PORT || 3000);
