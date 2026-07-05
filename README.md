# afisha-map

Парсит выставки Москвы с [afisha.ru](https://www.afisha.ru/msk/schedule_exhibition/na-segodnya/)
и показывает их на карте Москвы. Рассчитан на Raspberry Pi: **ноль npm-зависимостей**,
только встроенный Node.js. Карта — Leaflet + OpenStreetMap (грузится в браузере с CDN).

## Как это устроено

- Данные страниц afisha встроены в HTML как JSON (`window.__nrp['root']`), поэтому
  headless-браузер не нужен — парсим JSON напрямую. Быстро и легко для Pi.
- `src/build.js` обходит все страницы листинга, собирает выставки, затем по каждой
  выставке заходит на её страницу и достаёт **координаты площадки** (`AddressGeoPoint`)
  и **фотогалерею** (`Media.Gallery.Photos`). Всё кэшируется по id выставки в
  `data/details.json` — при повторных запусках известные выставки не перезапрашиваются.
  Если у площадки нет координат — резервное геокодирование через OpenStreetMap Nominatim.
- Результат пишется в `data/events.json`.
- На карте: маркер на площадку, в попапе — список выставок с фотогалереей
  (стрелки, счётчик, свайп на тач-экранах) и ссылками на билеты.
- `src/server.js` — лёгкий HTTP-сервер без зависимостей: отдаёт карту и `/api/events`.

## Быстрый старт

```bash
cd afisha-map
npm run scrape     # собрать данные -> data/events.json (1–2 мин)
npm start          # сервер на http://localhost:4444
```

Открыть в браузере `http://<ip-raspberry-pi>:4444`.

## Настройки (переменные окружения)

| Переменная         | По умолчанию                              | Описание |
|--------------------|-------------------------------------------|----------|
| `LIST_PATH`        | `/msk/schedule_exhibition/na-segodnya/`   | Раздел афиши (город/тип/дата) |
| `PORT`             | `4444`                                    | Порт сервера |
| `REQUEST_DELAY_MS` | `700`                                     | Пауза между запросами к afisha |
| `MAX_PAGES`        | `0` (все)                                 | Ограничить число страниц листинга |
| `USE_NOMINATIM`    | `1`                                       | `0` — отключить резервное геокодирование |
| `REFRESH_MIN`      | `0` (выкл)                                | Автообновление данных из сервера, минуты |

Примеры:
```bash
LIST_PATH=/spb/schedule_exhibition/na-segodnya/ npm run scrape   # выставки Питера
REFRESH_MIN=360 npm start                                        # сервер + автообновление раз в 6 ч
```

## Развёртывание на Raspberry Pi

**1. Node.js** (если ещё нет):
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**2. Сервис (автозапуск)** — `/etc/systemd/system/afisha-map.service`:
```ini
[Unit]
Description=afisha-map
After=network-online.target

[Service]
WorkingDirectory=/home/pi/afisha-map
ExecStart=/usr/bin/npm start
Environment=PORT=4444
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl enable --now afisha-map
```

**3. Ежедневное обновление данных** через cron (`crontab -e`):
```cron
30 6 * * * cd /home/pi/afisha-map && /usr/bin/npm run scrape >> /home/pi/afisha-map/scrape.log 2>&1
```
(Либо не трогать cron, а запустить сервер с `REFRESH_MIN=360` — тогда он сам обновляет.)

## Замечания

- **Антибот afisha:** «полный» браузерный заголовок `Accept: …,*/*;q=0.8` возвращает
  заглушку ~3.7 КБ. Используется упрощённый `Accept: text/html` — он проходит.
  (см. комментарий в `src/afisha.js`).
- **Интернет для карты:** Leaflet и тайлы OSM грузятся с CDN. Pi всё равно нужен
  интернет для парсинга; при желании библиотеку и тайлы можно положить локально.
- Будьте вежливы к afisha и OSM Nominatim: не уменьшайте паузы без нужды.

## Структура

```
afisha-map/
├── src/
│   ├── config.js    # настройки/env
│   ├── afisha.js    # парсинг afisha + геокодинг
│   ├── build.js     # сбор данных -> data/events.json
│   └── server.js    # HTTP-сервер
├── public/
│   └── index.html   # карта (Leaflet)
└── data/            # генерируется: events.json, venues.json (кэш координат)
```
