# 🍪 crunchy antibot

Лёгкая капча для сайта без зависимостей и сборки. Три проверки, реальные фотографии, русский/английский интерфейс, показ по подозрительной активности, бесплатный лимит **10 000 уникальных юзеров в месяц**, регистрация, личный кабинет и админ-панель с журналом.

**Основной сайт и личный кабинет:** [2-26-84-26.sslip.io](https://2-26-84-26.sslip.io/)
**Статическое демо:** [8pzww4tbys-byte.github.io/crunchy-antibot](https://8pzww4tbys-byte.github.io/crunchy-antibot/)

```text
0.x  crunchy v0.2   пазл из фото: вставьте фрагмент в вырез
1.x  crunchy v1.0   сетка 3×3: выберите все фото с печеньем
2.x  crunchy v2.0   код с картинки: 4–7 символов, без учёта регистра
```

Пакет/виджет: **0.6.0**. Типов ровно три — `slider`, `grid`, `text`; поворота (`rotate`) больше нет.

- 0 зависимостей, vanilla JS.
- Реальные фото и логотип подхватываются по URL скрипта.
- RU/EN, клавиатура, мобильные жесты, callbacks.
- Готовый конфигуратор сигналов: всплеск активности, автоматизация, повторные ошибки.
- **Бесплатно**: 10 000 юзеров/мес на аккаунт. Других тарифов и оплаты нет.
- Регистрация, вход, ключ, статистика и запрос на увеличение лимита.
- Админ-панель: пользователи, лимиты, блокировки, запросы и журнал действий.
- Кнопка **«Не работает капча?»** в виджете ведёт на страницу поддержки.
- Прикладная защита от L7-абьюза: rate limit, баны, лимиты соединений, таймауты, загрузка, блокировка сканеров. Подробности: [SECURITY.md](SECURITY.md).

> ⚠️ Капча — это клиентская эвристика, а не криптографическая защита. Мотивированный бот может прочитать JS. Для продакшена проверяйте защищаемое действие на своём сервере. Защита от объёмного DDoS — это CDN/WAF (Cloudflare, AWS Shield, Qrator), а не этот виджет.

---

## Быстрый старт

Одна команда копирует JS, CSS, логотип и фотографии в папку проекта:

```bash
npx github:8pzww4tbys-byte/crunchy-antibot add public/crunchy
```

Затем на странице:

```html
<link rel="stylesheet" href="/crunchy/crunchy-antibot.css">
<script src="/crunchy/crunchy-antibot.js"></script>

<div id="captcha"></div>
<script>
  const captcha = new CrunchyAntibot({
    el: '#captcha',
    type: 'text', // slider | grid | text
    locale: 'ru',
    licenseKey: 'cr_...',
    apiBase: 'https://2-26-84-26.sslip.io'
  });
</script>
```

Можно скачать архив/клонировать репозиторий и подключить файлы из `assets/`. Минимальный пример с формой: [`examples/basic.html`](examples/basic.html).

Без установки:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/8pzww4tbys-byte/crunchy-antibot@main/assets/crunchy-antibot.css">
<script src="https://cdn.jsdelivr.net/gh/8pzww4tbys-byte/crunchy-antibot@main/assets/crunchy-antibot.js"></script>
```

Фото и логотип будут загружаться с того же CDN, потому что путь считается от `src` скрипта.

### Ключ

1. Откройте [регистрацию](https://2-26-84-26.sslip.io/register.html).
2. Укажите название сайта, e-mail и пароль.
3. Скопируйте ключ из личного кабинета и передайте его в `licenseKey`.

Один аккаунт выдаёт один ключ. Ключ бессрочный; лимит — 10 000 уникальных посетителей на календарный месяц.

---

## Три типа

### v0.2 — `slider`

Фотография с «вырезом»; фрагмент нужно перетащить в вырез. Работает мышью, пальцем и стрелками клавиатуры. При промахе виджет показывает новую попытку.

### v1.0 — `grid`

Сетка 3×3 с реальными фото. Нужно выбрать все клетки с печеньем; цель показана миниатюрой. Проверка — точное совпадение выбранного набора.

### v2.0 — `text`

Код из 4–7 символов на canvas. Ввод без учёта регистра, `Enter` проверяет. Код не хранится в DOM в открытом виде.

---

## API виджета

```js
const captcha = new CrunchyAntibot({
  el: '#captcha',
  type: 'grid',
  locale: 'ru',
  licenseKey: 'cr_...',              // ключ из личного кабинета
  apiBase: 'https://2-26-84-26.sslip.io',
  enforceQuota: true,                 // блокировать виджет при 402
  supportUrl: 'https://2-26-84-26.sslip.io/support.html',
  onReady(info) {},
  onFail(info) {},
  onSuccess(token, info) {},
  onRefresh(info) {},
  onQuota(data) {},
  onQuotaError(error) {}
});
```

| Опция | Тип | Описание |
|---|---|---|
| `el` | `string \| Element` | Контейнер. Обязательно. |
| `type` | `'slider' \| 'grid' \| 'text'` | Тип задания, по умолчанию `slider`. |
| `locale` | `'ru' \| 'en'` | Язык интерфейса. |
| `assetsPath` | `string` | База для `photos/` и логотипа. По умолчанию — папка скрипта. |
| `licenseKey` | `string` | Ключ бесплатного аккаунта. Если задан вместе с `apiBase`, виджет отправляет usage. |
| `apiBase` | `string` | Например, `https://2-26-84-26.sslip.io`. |
| `enforceQuota` | `boolean` | `true` по умолчанию: при исчерпанном лимите виджет блокируется. |
| `supportUrl` | `string` | Куда ведёт «Не работает капча?». По умолчанию — страница поддержки проекта. |
| `visitorId` | `string` | Свой анонимный ID. По умолчанию UUID в `localStorage`. |
| `onReady` | `function` | Новое задание построено. |
| `onFail` | `function` | Провал; `info.reason`: `offset`, `selection`, `text`. |
| `onSuccess` | `function` | Успех; `token` вида `ca_...`, `info`: `{ type, attempts }`. |
| `onRefresh` | `function` | Пользователь запросил новое задание. |
| `onQuota` | `function` | Ответ `/api/usage`: `{ allowed, used, limit, remaining, month, resetAt, ... }`. |
| `onQuotaError` | `function` | Backend не ответил. По умолчанию виджет не блокируется (fail-open). |

Методы и свойства:

```js
captcha.reset();              // новое задание
captcha.setType('text');      // сменить тип
captcha.checkQuota();         // повторить проверку лимита
captcha.destroy();            // удалить виджет
captcha.quota;                // последний ответ usage
CrunchyAntibot.version;       // 0.6.0
CrunchyAntibot.versions;      // { slider: 'v0.2', grid: 'v1.0', text: 'v2.0' }
```

### Кнопка поддержки

В нижней части виджета есть ссылка **«Не работает капча?»** (в английской локали — `Captcha not working?`). Она открывается в новой вкладке и ведёт на страницу поддержки. Адрес можно переопределить через `supportUrl`; по умолчанию используется страница проекта.

### Токен

`onSuccess` получает клиентский токен `ca_...`. Это **не** готовая серверная сессия: для реальной защиты отправьте токен на свой backend и проверьте его вместе с бизнес-действием. Виджет не хранит секрет и не умеет выдавать серверные права.

---

## Сигналы подозрительной активности

Виджет не показывается на каждый запрос. Демо и конфигуратор используют три сигнала:

1. **Всплеск активности** — N событий за окно времени.
2. **Признаки автоматизации** — отсутствие движения/фокуса, неестественные интервалы, `webdriver`, подозрительные свойства браузера.
3. **Повторные неудачные действия** — N ошибок защищаемого действия подряд.

Логика находится в `assets/demo.js` (конфигуратор) и может быть перенесена в ваш код. Порог и окно настраиваются. Капча показывается только после сигнала; таймеров и ручных кнопок «показать» в продакшене нет.

---

## Аккаунты и лимит

### Регистрация и вход

- `/register.html` — название сайта, e-mail, пароль (от 8 символов).
- `/login.html` — вход по e-mail и паролю.
- `/dashboard.html` — ключ, расход лимита, история запросов, выход.
- `/support.html` — форма поддержки и FAQ.
- `/admin.html` — админ-панель.

Пароли хранятся как `scrypt`-хеши с солью. Сессия — подписанная HttpOnly-кука `SameSite=Lax`; в HTTPS добавляется `Secure`. Секрет сессии и хеш пароля администратора задаются только в `.env` на сервере.

### Лимит

- **10 000** уникальных юзеров на аккаунт в календарный месяц (UTC).
- Юзер — анонимный `visitorId`; сервер хранит только SHA-256-хеш от `licenseKey:visitorId`.
- Повторный визит того же `visitorId` не увеличивает счётчик.
- 1-го числа месяца счётчик начинается заново.
- Если нужно больше, отправьте запрос в кабинете. Администратор увидит его в панели, изменит лимит вручную и обработает запрос. Доплат нет.

Клиентская блокировка (`enforceQuota`) удобна для UX, но не является биллингом: её можно обойти. Жёсткая проверка должна быть на вашем сервере перед защищаемым действием.

### Админ-панель

`/admin.html` после входа показывает:

- число пользователей, расход за месяц, ожидающие запросы и блокировки;
- список пользователей: e-mail, сайт, ключ, лимит, расход, дата регистрации, статус;
- изменение лимита и блокировку/разблокировку;
- запросы на увеличение лимита с одобрением/отклонением;
- журнал: регистрации, входы, ошибки входа, запросы лимита, поддержка, исчерпание квоты и действия администратора.

Логин администратора и хеш пароля задаются в `.env`:

```bash
ADMIN_LOGIN=admin
ADMIN_PASSWORD_HASH=scrypt$...
```

Сгенерировать хеш:

```bash
node -e "import('./server/auth.mjs').then(async a=>console.log(await a.hashPassword('новый-пароль')))"
```

После смены `.env` перезапустите сервис. Не коммитьте `.env` и не храните пароль в клиентском JS.

---

## Backend

```bash
npm run server
```

Сервер по умолчанию слушает `127.0.0.1:8787`, отдаёт статические страницы и API. Данные лежат в `server/data/store.json` (создаётся автоматически, gitignored).

### API

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/api/health` | Статус, версия, лимит, счётчики, готовность auth/admin. |
| `GET` | `/api/plans` | Единственный бесплатный план и лимит. |
| `POST` | `/api/register` | `{siteName,email,password}` → аккаунт, ключ, сессия. |
| `POST` | `/api/login` | `{email,password}` → сессия. |
| `POST` | `/api/logout` | Завершить сессию. |
| `GET` | `/api/me` | Текущий пользователь, ключ, usage, история запросов. |
| `POST` | `/api/limit-request` | `{requestedLimit,message?}` → запрос админу. |
| `POST` | `/api/support` | `{name?,email?,site?,message}` → запись в журнал поддержки. |
| `POST` | `/api/usage` | `{licenseKey,visitorId}` → `{allowed,used,limit,remaining}`; `403 license_blocked` для заблокированного ключа. |
| `POST` | `/api/license/info` | Информация по ключу. |
| `POST` | `/api/admin/login` | `{username,password}` → админ-сессия. |
| `POST` | `/api/admin/logout` | Выход администратора. |
| `GET` | `/api/admin/overview` | Пользователи, запросы, журнал, статистика. |
| `GET` | `/api/admin/logs?limit=250` | Журнал. |
| `POST` | `/api/admin/users/:id/limit` | `{limit}`. |
| `POST` | `/api/admin/users/:id/block` | `{blocked}`. |
| `POST` | `/api/admin/requests/:id` | `{status:'approved'\|'rejected'}`. |

### Переменные `.env`

Скопируйте `.env.example` в `.env` и заполните:

```bash
PUBLIC_ORIGIN=https://2-26-84-26.sslip.io
ALLOWED_ORIGINS=https://2-26-84-26.sslip.io,https://8pzww4tbys-byte.github.io
TRUST_PROXY=1
FREE_LIMIT=10000
SESSION_SECRET=<48+ случайных байт base64url>
ADMIN_LOGIN=admin
ADMIN_PASSWORD_HASH=scrypt$...
DATA_DIR=server/data
```

`TRUST_PROXY=1` ставьте только за доверенным Nginx/Cloudflare, иначе клиентский IP можно подделать заголовком. `.env` не попадает в git.

### Проверка

```bash
npm run check
```

Проверяет синтаксис виджета, демо, аккаунтов, CLI и backend-модулей.

---

## Деплой

### Вариант 1: VPS + systemd + Nginx (используется на основном сайте)

1. Скопируйте проект в `/opt/crunchy-antibot` (без `.git`, `server/data`, `.env`).
2. Создайте системного пользователя `crunchy`, каталог `server/data` с правами на запись.
3. Положите production `.env` в `/opt/crunchy-antibot/.env`, владелец `root:crunchy`, права `chmod 640`.
4. Установите systemd-юнит из [`deploy/crunchy-antibot.service`](deploy/crunchy-antibot.service).
5. Для первого выпуска TLS поставьте [`deploy/nginx-http-bootstrap.conf`](deploy/nginx-http-bootstrap.conf) и выполните `certbot certonly --webroot -w /var/www/certbot -d 2-26-84-26.sslip.io`.
6. Замените конфиг на [`deploy/nginx.conf`](deploy/nginx.conf) с готовым сертификатом, выполните `nginx -t` и `systemctl reload nginx`.
7. Откройте только 80/443; Node держите на `127.0.0.1:8787`.

`deploy/nginx.conf` содержит отдельные rate-limit-зоны для статики, API, auth и поддержки. Он не заменяет Cloudflare, но снимает часть L7-нагрузки до Node.

### Вариант 2: Docker

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

Проксируйте `127.0.0.1:8787` через Nginx/Caddy. Для сохранности данных подключите volume `server/data`.

### Вариант 3: Render

В репозитории есть `render.yaml` с постоянным диском. Заполните `PUBLIC_ORIGIN`, `ALLOWED_ORIGINS`, `SESSION_SECRET`, `ADMIN_PASSWORD_HASH` в панели Render. GitHub Pages не запускает Node и не хранит секреты, поэтому аккаунты и API должны жить на отдельном backend-домене.

### Домен

Основной адрес `2-26-84-26.sslip.io` — технический домен 3-го уровня на wildcard DNS `sslip.io`, привязанный к IP `2.26.84.26`. Это не покупка у регистратора, а стабильный DNS-хост без аккаунта и оплаты; при смене IP адрес нужно заменить. TLS выпущен Let's Encrypt для этого хоста. Если нужен брендовый домен, его регистрируют отдельно и направляют A-записью на тот же IP.

---

## DDoS: что реально сделано

В Node реализованы:

- лимиты запросов на IP по категориям (статика/API/auth/поддержка);
- баны после серии нарушений, ограничение одновременных соединений;
- ограничение активных запросов и соединений на IP;
- таймауты заголовков/тела, лимит размера тела, лимит заголовков;
- блокировка типовых сканерских путей (`.env`, `.git`, `wp-admin`, `phpmyadmin` и т.п.);
- security headers, HSTS за HTTPS, CSP для HTML;
- Nginx-конфиг с `limit_req`/`limit_conn` и отдельными зонами.

Это **прикладная** защита. Объёмные L3/L4-атаки и распределённый L7-флуд нужно закрывать CDN/WAF (Cloudflare, Qrator, AWS Shield) и/или защитой провайдера. Подробный чек-лист — в [SECURITY.md](SECURITY.md).

---

## Структура

```text
index.html                    лендинг, демо, конфигуратор, бесплатный лимит
register.html                 регистрация
login.html                    вход
dashboard.html                ключ, usage, запрос лимита
support.html                  поддержка и FAQ
admin.html                    админ-панель
assets/
  crunchy-antibot.js          виджет 0.6.0
  crunchy-antibot.css         стили виджета
  demo.js / demo.css          лендинг и конфигуратор
  account.js / account.css    аккаунты, кабинет, админка, поддержка
  photos/                     реальные фото
server/
  index.mjs                   HTTP, auth, API, статика
  auth.mjs                    scrypt, сессии, cookies
  store.mjs                   пользователи, лицензии, usage, логи
  security.mjs                rate limit, CORS, лимиты, headers
  config.mjs                  env, бесплатный план
deploy/
  nginx.conf                  reverse proxy + rate limiting
  docker-compose.yml          Docker
bin/crunchy-antibot.js        one-command installer
examples/basic.html           пример формы
SECURITY.md                   безопасность и DDoS
```

---

## Лицензия

MIT. См. [LICENSE](LICENSE).
