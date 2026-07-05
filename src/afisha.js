// Модуль парсинга afisha.ru.
// Данные страниц afisha встроены в HTML как JSON: window.__nrp['root'] = {...}.
// Поэтому headless-браузер не нужен — достаём и разбираем JSON напрямую.

import { BASE, LIST_PATH, REQUEST_DELAY_MS, MAX_PAGES, USE_NOMINATIM, UA } from './config.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Загрузить HTML страницы с ретраями. Абсолютный или относительный URL. */
export async function fetchHtml(url, { retries = 3 } = {}) {
  const full = url.startsWith('http') ? url : BASE + url;
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(full, {
        // ВНИМАНИЕ: полный «браузерный» Accept (…,*/*;q=0.8) триггерит антибот
        // afisha и возвращает заглушку ~3.7 КБ. Простой Accept проходит.
        headers: {
          'User-Agent': UA,
          Accept: 'text/html',
          'Accept-Language': 'ru-RU',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} для ${full}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await sleep(1000 * (i + 1));
    }
  }
  throw lastErr;
}

/**
 * Извлечь JSON-состояние страницы: window.__nrp['root'] = { ... };
 * Ищем начало объекта и балансируем фигурные скобки с учётом строк/экранирования.
 */
export function extractNrp(html) {
  const key = "['root'] = ";
  const i = html.indexOf(key);
  if (i < 0) return null;
  const start = html.indexOf('{', i);
  if (start < 0) return null;

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = start; k < html.length; k++) {
    const c = html[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, k + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Разобрать одну страницу листинга -> { events, pagesCount }. */
export function parseListPage(html) {
  const root = extractNrp(html);
  const widget = root?.model?.ScheduleWidget;
  if (!widget) return { events: [], pagesCount: 1 };
  const pagesCount = widget.Pager?.PagesCount || 1;
  const events = (widget.Items || [])
    .filter((it) => it.Type === 'Exhibition')
    .map(mapItem)
    .filter(Boolean);
  return { events, pagesCount };
}

function cleanUrl(u) {
  return u ? u.split('#')[0] : u;
}

function mapItem(it) {
  const si = it.ScheduleInfo || {};
  const place = it.Notice?.Place || null;
  return {
    id: it.ID,
    name: it.Name,
    url: si.Url || cleanUrl(it.Url),
    description: it.Description || '',
    displayType: it.DisplayType || 'выставка',
    rating: it.Rating ?? null,
    dates: it.Notice?.Dates || '',
    dateStart: si.MinScheduleDate || null,
    dateEnd: si.MaxScheduleDate || null,
    minPrice: si.MinPrice ?? null,
    hasTickets: !!si.HasTickets,
    image: it.Image1x1?.Url || it.Image16x9?.Url || null,
    genres: (it.Genres?.Links || []).map((g) => g.Name),
    place: place
      ? { name: place.Name, url: place.Url, address: place.Address || '' }
      : null,
  };
}

/** Пройти все страницы листинга и собрать события (с дедупом по id). */
export async function scrapeAll({ delayMs = REQUEST_DELAY_MS, log = () => {} } = {}) {
  const first = await fetchHtml(LIST_PATH);
  const { events, pagesCount } = parseListPage(first);
  const limit = MAX_PAGES > 0 ? Math.min(pagesCount, MAX_PAGES) : pagesCount;
  const all = [...events];
  log(`страница 1/${limit}: +${events.length}`);

  for (let p = 2; p <= limit; p++) {
    await sleep(delayMs);
    try {
      const html = await fetchHtml(`${LIST_PATH}page${p}/`);
      const r = parseListPage(html);
      all.push(...r.events);
      log(`страница ${p}/${limit}: +${r.events.length}`);
    } catch (e) {
      log(`страница ${p}/${limit}: ошибка — ${e.message}`);
    }
  }

  const byId = new Map();
  for (const e of all) byId.set(e.id, e);
  return [...byId.values()];
}

/** Достать координаты площадки со страницы площадки afisha (AddressGeoPoint). */
export async function resolveVenueCoords(placeUrl) {
  const html = await fetchHtml(placeUrl);
  const m = html.match(
    /"AddressGeoPoint":\{"Latitude":(-?\d+\.?\d*),"Longitude":(-?\d+\.?\d*)\}/,
  );
  if (m) return { lat: Number(m[1]), lng: Number(m[2]), source: 'afisha' };
  return null;
}

/**
 * Достать со страницы выставки сразу и координаты площадки (AddressGeoPoint),
 * и фотогалерею (model.Media.Gallery.Photos). Один запрос — оба результата.
 * @returns {{ coords: {lat,lng,source}|null, photos: string[] }}
 */
export async function resolveEventDetails(eventUrl, { maxPhotos = 20 } = {}) {
  const html = await fetchHtml(eventUrl);

  let coords = null;
  const m = html.match(
    /"AddressGeoPoint":\{"Latitude":(-?\d+\.?\d*),"Longitude":(-?\d+\.?\d*)\}/,
  );
  if (m) coords = { lat: Number(m[1]), lng: Number(m[2]), source: 'afisha' };

  const media = extractNrp(html)?.model?.Media || {};
  const photos = [];
  const push = (u) => {
    if (u && !photos.includes(u)) photos.push(u);
  };
  // Главное фото — первым, затем вся галерея.
  push(media.Photo16x9?.Url || media.Photo1x1?.Url);
  for (const p of media.Gallery?.Photos || []) push(p?.Image?.Url);

  return { coords, photos: photos.slice(0, maxPhotos) };
}

/** Резервное геокодирование по адресу через OpenStreetMap Nominatim. */
export async function geocodeNominatim(address) {
  if (!USE_NOMINATIM || !address) return null;
  const q = encodeURIComponent(`${address}, Москва, Россия`);
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`,
    { headers: { 'User-Agent': `afisha-map/1.0 (${UA})` } },
  );
  if (!res.ok) return null;
  const arr = await res.json();
  if (arr[0]) return { lat: Number(arr[0].lat), lng: Number(arr[0].lon), source: 'nominatim' };
  return null;
}
