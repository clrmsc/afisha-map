// Оркестратор сбора данных: спарсить листинг -> по каждой выставке добыть
// координаты площадки + фотогалерею (с кэшем) -> записать data/events.json.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scrapeAll,
  resolveEventDetails,
  geocodeNominatim,
  sleep,
} from './afisha.js';
import { REQUEST_DELAY_MS } from './config.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dir, '..', 'data');
export const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
// Кэш деталей по id выставки: { [id]: { coords, photos } }.
// Фото и координаты не меняются, поэтому известные выставки повторно не запрашиваем.
const DETAILS_FILE = path.join(DATA_DIR, 'details.json');

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function build({ log = console.log } = {}) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  log('Парсинг листинга выставок…');
  const events = await scrapeAll({ log });
  log(`Всего выставок: ${events.length}`);

  const details = loadJson(DETAILS_FILE, {});

  let fetched = 0;
  let cached = 0;
  let failed = 0;
  log('Собираю координаты и фото по каждой выставке…');
  for (const e of events) {
    if (details[e.id]) {
      cached++;
      continue;
    }
    await sleep(REQUEST_DELAY_MS);
    let d = { coords: null, photos: [] };
    try {
      d = await resolveEventDetails(e.url);
    } catch (err) {
      log(`  ! ${e.name}: ${err.message}`);
    }
    // Резервное геокодирование, если у afisha не оказалось координат.
    if (!d.coords && e.place?.address) {
      await sleep(1100); // вежливость к Nominatim (не чаще 1 req/s)
      try {
        d.coords = await geocodeNominatim(e.place.address);
      } catch { /* пропускаем */ }
    }
    details[e.id] = { coords: d.coords, photos: d.photos };
    if (d.coords) {
      fetched++;
      log(`  ✓ ${e.name} — фото: ${d.photos.length} [${d.coords.source}]`);
    } else {
      failed++;
      log(`  ✗ ${e.name} — координаты не найдены (фото: ${d.photos.length})`);
    }
  }
  fs.writeFileSync(DETAILS_FILE, JSON.stringify(details, null, 2));
  log(`Детали: получено ${fetched}, из кэша ${cached}, без координат ${failed}`);

  // Прикрепляем координаты и фото к событиям.
  let withCoords = 0;
  for (const e of events) {
    const d = details[e.id];
    if (d?.coords?.lat != null) {
      e.lat = d.coords.lat;
      e.lng = d.coords.lng;
      withCoords++;
    }
    e.photos = d?.photos || (e.image ? [e.image] : []);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    listPath: process.env.LIST_PATH || '/msk/schedule_exhibition/na-segodnya/',
    count: events.length,
    withCoords,
    events,
  };
  fs.writeFileSync(EVENTS_FILE, JSON.stringify(out));
  log(`Готово: ${EVENTS_FILE} (${events.length} событий, ${withCoords} на карте)`);
  return out;
}

// Запуск напрямую: node src/build.js
if (process.argv[1] && process.argv[1].endsWith('build.js')) {
  build().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
