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
  Данные читаются из `data/events.json` при каждом запросе, поэтому после парсинга
  сервер отдаёт свежие данные **без перезапуска**.

### Как работает парсер (по шагам)

1. **Листинг.** `scrapeAll()` качает первую страницу раздела (`LIST_PATH`), из встроенного
   JSON достаёт `ScheduleWidget.Pager.PagesCount` (сколько всего страниц) и `Items`
   (выставки). Затем в цикле обходит остальные страницы (`.../page2/`, `page3/`, …)
   с паузой `REQUEST_DELAY_MS` между запросами. Из каждой карточки берёт название,
   площадку с адресом, даты, жанры, картинку, ссылку. Дубли схлопываются по `id`.
2. **Детали по каждой выставке.** Для каждой выставки `resolveEventDetails()` заходит
   на её страницу и одним запросом достаёт сразу и **координаты площадки**
   (`AddressGeoPoint`), и **фотогалерею** (`Media.Gallery.Photos`, до 20 фото).
3. **Кэш.** Результат по каждой выставке кладётся в `data/details.json` по её `id`.
   Фото и координаты не меняются, поэтому при следующем запуске известные выставки
   **не перезапрашиваются** — качаются только новые. Первый прогон ~2 мин, последующие быстрее.
4. **Геокодинг-фолбэк.** Если у выставки не нашлось координат — адрес геокодируется
   через OpenStreetMap Nominatim (можно отключить `USE_NOMINATIM=0`).
5. **Запись.** Всё собирается в `data/events.json` (со штампом времени `generatedAt`),
   который читает и сервер, и карта.

Ключевой трюк: данные встроены в HTML как `window.__nrp['root'] = {...}`. Парсер находит
этот объект и вычитывает сбалансированный JSON (учёт кавычек/скобок) — см. `extractNrp()`
в [`src/afisha.js`](src/afisha.js). Никакого headless-браузера, всё на голом Node.

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

Готовые unit-файлы лежат в папке [`deploy/`](deploy). В них поправьте путь
(`/home/pi/afisha-map`) и пользователя (`pi`) под свою систему.

**1. Node.js** (если ещё нет):
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

**2. Веб-сервер как сервис (автозапуск после включения Pi):**
```bash
sudo cp deploy/afisha-map.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now afisha-map      # поднимется сам и после перезагрузки
```

**3. Ежедневный парсинг (systemd-таймер):**
```bash
sudo cp deploy/afisha-scrape.service deploy/afisha-scrape.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now afisha-scrape.timer   # запускает парсинг каждый день в 06:30

# полезные команды:
systemctl list-timers afisha-scrape.timer    # когда следующий запуск
sudo systemctl start afisha-scrape.service    # запустить парсинг прямо сейчас
journalctl -u afisha-scrape.service -n 50     # посмотреть лог парсинга
```
`Persistent=true` в таймере: если Pi был выключен в 06:30 — парсинг догонится после включения.
Сервер перезапускать не нужно — он подхватывает свежий `data/events.json` автоматически.

> Альтернатива без таймера: запустить сервер с `REFRESH_MIN=1440` — тогда он сам
> парсит раз в сутки в своём процессе (в `deploy/afisha-map.service` добавьте
> строку `Environment=REFRESH_MIN=1440`).
>
> Или через cron (`crontab -e`):
> ```cron
> 30 6 * * * cd /home/pi/afisha-map && /usr/bin/npm run scrape >> scrape.log 2>&1
> ```

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
│   └── index.html   # карта (Leaflet) + фотогалерея + лайтбокс
├── deploy/          # systemd unit-файлы для Raspberry Pi
│   ├── afisha-map.service
│   ├── afisha-scrape.service
│   └── afisha-scrape.timer
└── data/            # генерируется: events.json + details.json (кэш координат и фото)
```
