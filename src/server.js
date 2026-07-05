// Лёгкий HTTP-сервер без зависимостей: раздаёт карту (public/) и API.
//   GET /              -> карта
//   GET /api/events    -> data/events.json
//   GET /api/health    -> статус
// Автообновление данных: env REFRESH_MIN=60 (минуты). 0 = выключено.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PORT } from './config.js';
import { build, EVENTS_FILE } from './build.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dir, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/api/events') {
    fs.readFile(EVENTS_FILE, (err, buf) => {
      if (err) {
        res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Данных пока нет. Запустите: npm run scrape' }));
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-cache',
      });
      res.end(buf);
    });
    return;
  }

  if (pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, hasData: fs.existsSync(EVENTS_FILE) }));
    return;
  }

  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log(`afisha-map: http://localhost:${PORT}`);
  if (!fs.existsSync(EVENTS_FILE)) {
    console.log('Данных ещё нет — выполните `npm run scrape` (или задайте REFRESH_MIN).');
  }
});

// Периодическое обновление данных прямо из сервера (опционально).
const REFRESH_MIN = Number(process.env.REFRESH_MIN || 0);
if (REFRESH_MIN > 0) {
  const run = () =>
    build({ log: (...a) => console.log('[scrape]', ...a) }).catch((e) =>
      console.error('[scrape]', e.message),
    );
  if (!fs.existsSync(EVENTS_FILE)) run();
  setInterval(run, REFRESH_MIN * 60 * 1000);
  console.log(`Автообновление каждые ${REFRESH_MIN} мин.`);
}
