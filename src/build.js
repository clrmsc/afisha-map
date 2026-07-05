// Оркестратор сбора данных: спарсить листинг -> добыть координаты площадок
// (с кэшем) -> записать data/events.json для карты.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scrapeAll,
  resolveVenueCoords,
  geocodeNominatim,
  sleep,
} from './afisha.js';
import { REQUEST_DELAY_MS } from './config.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dir, '..', 'data');
export const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const VENUES_FILE = path.join(DATA_DIR, 'venues.json');

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

  // Кэш координат площадок между запусками — чтобы не дёргать одни и те же.
  const venues = loadJson(VENUES_FILE, {});

  const uniquePlaces = new Map();
  for (const e of events) {
    if (e.place?.url && !uniquePlaces.has(e.place.url)) {
      uniquePlaces.set(e.place.url, e.place);
    }
  }
  log(`Уникальных площадок: ${uniquePlaces.size}`);

  let resolved = 0;
  let cached = 0;
  let failed = 0;
  for (const [url, place] of uniquePlaces) {
    if (venues[url]?.lat != null) {
      cached++;
      continue;
    }
    await sleep(REQUEST_DELAY_MS);
    let coords = null;
    try {
      coords = await resolveVenueCoords(url);
    } catch (e) {
      log(`  ! ${url}: ${e.message}`);
    }
    if (!coords) {
      await sleep(1100); // вежливость к Nominatim (не чаще 1 req/s)
      try {
        coords = await geocodeNominatim(place.address);
      } catch { /* пропускаем */ }
    }
    venues[url] = { name: place.name, address: place.address, ...(coords || {}) };
    if (coords) {
      resolved++;
      log(`  ✓ ${place.name} [${coords.source}]`);
    } else {
      failed++;
      log(`  ✗ ${place.name} — координаты не найдены`);
    }
  }
  fs.writeFileSync(VENUES_FILE, JSON.stringify(venues, null, 2));
  log(`Площадки: получено ${resolved}, из кэша ${cached}, без координат ${failed}`);

  // Прикрепляем координаты к событиям.
  let withCoords = 0;
  for (const e of events) {
    const v = e.place?.url ? venues[e.place.url] : null;
    if (v?.lat != null) {
      e.lat = v.lat;
      e.lng = v.lng;
      withCoords++;
    }
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
