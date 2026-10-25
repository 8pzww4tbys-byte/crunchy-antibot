# Безопасность и защита от DDoS

Коротко: **полноценная защита от DDoS не может жить только в JavaScript или в одном Node-процессе.** Объёмные атаки L3/L4 (гигабиты/миллионы пакетов) принимает сеть провайдера или CDN. В этом репозитории есть прикладной слой защиты и готовые конфиги, чтобы закрыть L7-абьюз, но production-схема обязательно включает CDN/WAF и прокси перед origin.

## Что уже есть в backend

Сервер `server/index.mjs` до маршрутизации запросов применяет:

| Механизм | По умолчанию | Переменная |
|---|---|---|
| Лимит статики на IP | 600 запросов / минуту | `RATE_LIMIT_STATIC` |
| Лимит API на IP | 90 запросов / минуту | `RATE_LIMIT_API` |
| Лимит register/login/admin/limit-request | 12 запросов / минуту | `RATE_LIMIT_AUTH` |
| Лимит поддержки | 6 запросов / минуту | `RATE_LIMIT_SUPPORT` |
| Бан IP за флуд | после 900 запросов, на 10 минут | `BAN_AFTER`, `BAN_MS` |
| Одновременных запросов на IP | 12 | `MAX_REQUESTS_PER_IP` |
| Одновременных запросов всего | 256, дальше 503 | `MAX_ACTIVE_REQUESTS` |
| TCP-соединений | 512 | `MAX_CONNECTIONS` |
| TCP-соединений на IP | 24 (только без `TRUST_PROXY`) | `MAX_CONNECTIONS_PER_IP` |
| Размер JSON-тела | 64 КБ | `MAX_BODY_BYTES` |
| Таймаут заголовков | 10 секунд | `HEADERS_TIMEOUT_MS` |
| Таймаут запроса | 20 секунд | `REQUEST_TIMEOUT_MS` |
| Keep-alive | 5 секунд | `KEEP_ALIVE_TIMEOUT_MS` |
| Заголовков в запросе | 80 | `MAX_HEADER_COUNT` |

Дополнительно:

- сканеры путей (`/.env`, `/.git`, `/wp-admin`, `/phpmyadmin`, `/cgi-bin`, `/vendor/` и т. п.) получают 404 и штрафные баллы; после нескольких попыток IP банится;
- запрещены методы кроме `GET`, `HEAD`, `POST`, `OPTIONS`; у API проверяется `Content-Type`;
- статика отдаётся только из разрешённого дерева, dot-файлы и `server/` недоступны;
- для HTML выставляются CSP, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`; за HTTPS — HSTS;
- статика кешируется, API — `no-store`;
- CORS разрешает только домены из `ALLOWED_ORIGINS` и включает credentials для cookie-сессии;
- при перегрузке сервер отдаёт 503/429 с `Retry-After`, а не падает;
- вход администратора дополнительно блокируется на 15 минут после 5 ошибок с одного IP;
- пароли хранятся как `scrypt`-хеши, сессия — подписанная HttpOnly-кука; `Secure` включается при HTTPS `PUBLIC_ORIGIN`;
- журнал пишет только метаданные: e-mail, тип события, IP, user-agent и короткое описание. Пароли и токены в лог не попадают.

Проверить состояние и счётчики можно на `GET /api/health`.

## Чего этот код не делает

- не останавливает L3/L4-флуд и amplification-атаки;
- не заменяет Cloudflare/AWS Shield/Qrator;
- не спасает от распределённого ботнета, который приходит с тысяч IP и умеет решать капчу;
- не хранит данные в БД: JSON-файл подходит для одного процесса и небольших объёмов. Для нескольких инстансов нужен Redis/PostgreSQL/SQLite с блокировками;
- клиентская капча не является криптографической проверкой: мотивированный бот может прочитать JS и обойти её. Токен `ca_...` в этой версии — демонстрационный. Для жёсткой защиты выдавайте задание и проверяйте ответ на сервере;
- регистрация не подтверждает e-mail. Для продакшена можно добавить верификацию и/или капчу на форму регистрации.

## Рекомендуемая production-схема

```text
Клиент
  │  TLS, HTTP/2/3
  ▼
Cloudflare (DNS proxied, WAF, Bot Fight, rate limiting, кеш, Under Attack Mode)
  │  Authenticated Origin Pulls / mTLS, firewall только для IP Cloudflare
  ▼
Nginx / Caddy (лимиты соединений и запросов, таймауты, body limit)
  │  127.0.0.1:8787
  ▼
crunchy antibot Node backend
  │
  └── постоянный диск / БД для пользователей, лицензий, usage и логов
```

### 1. Cloudflare

1. Добавьте домен, включите proxied-режим (оранжевая тучка), SSL/TLS — **Full (strict)**.
2. Включите WAF Managed Rules, Bot Fight Mode и при атаке — **Under Attack Mode**.
3. Создайте rate limiting rules (значения подберите под трафик):
   - `http.request.uri.path in {"/api/register" "/api/login" "/api/admin/login"} ` → 10 запросов/мин на IP, действие Block на 10 минут;
   - `http.request.uri.path starts_with "/api/"` → 60 запросов/мин на IP;
   - `http.request.uri.path starts_with "/assets/"` → 600 запросов/мин на IP;
   - `http.request.uri.path eq "/"` → Challenge при всплеске.
4. Cache Rules: кешировать `/assets/*`, **bypass** для `/api/*`, `/admin.html`, `/dashboard.html`.
5. Закройте origin: разрешите входящие только с [официальных IP Cloudflare](https://www.cloudflare.com/ips/), включите Authenticated Origin Pulls. Не публикуйте origin-IP.
6. Включите `TRUST_PROXY=1` в `.env` **только** если origin действительно стоит за доверенным прокси. Иначе клиент подделает `X-Forwarded-For`.

### 2. Nginx

Готовый пример: [`deploy/nginx.conf`](deploy/nginx.conf). Он добавляет `limit_req`/`limit_conn`, отдельные зоны для статики, API, auth и поддержки, таймауты, ограничение тела и проксирование на `127.0.0.1:8787`.

### 3. Node backend

Запускайте не от root, с `NODE_ENV=production`, постоянным диском и systemd/Docker restart policy. Для нескольких реплик вынесите `Store` в БД и добавьте общий rate limiter (Redis).

Минимальные права systemd:

```ini
User=crunchy
WorkingDirectory=/opt/crunchy-antibot
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/crunchy-antibot/server/data
```

## Секреты

- `SESSION_SECRET` — 48+ случайных байт base64url. Смена инвалидирует все сессии.
- `ADMIN_PASSWORD_HASH` — scrypt-хеш, не пароль. Генерируется через `server/auth.mjs`.
- `.env` — `chmod 600`, владелец процесса; не коммитить.
- `server/data/store.json` — содержит e-mail, хеши паролей и usage; `chmod 600`, бэкап, не публиковать.
- При утечке ключа лицензии выпустите новый аккаунт/ключ, заблокируйте старый в админ-панели и удалите данные из публичных мест.
- При утечке `SESSION_SECRET` замените его и перезапустите сервис; при утечке админ-пароля смените хеш.

`.env`, `server/data`, логи и `tmp/` уже в `.gitignore`.

## Ограничения текущей реализации

- Rate limit и блокировка админ-входа хранятся в памяти процесса: рестарт сбрасывает их, а несколько инстансов не разделяют счётчики.
- JSON store делает синхронную запись на каждый новый usage и каждое событие журнала; при высокой нагрузке это bottleneck. Для больших объёмов — БД.
- CORS — не замена авторизации. `/api/usage` принимает license key, потому что ключ живёт в браузере; жёсткая проверка защищаемого действия должна быть на вашем сервере.
- Регистрация ограничена по IP, но не подтверждает e-mail. Для продакшена добавьте верификацию, лимит аккаунтов на IP и капчу.
- Антибот-сигналы на демо (`navigator.webdriver` и т. п.) — эвристика, а не доказательство автоматизации.

## Что проверить перед запуском

- [ ] `TRUST_PROXY` соответствует реальной схеме (CDN/прокси → backend).
- [ ] `ALLOWED_ORIGINS` содержит только ваши домены.
- [ ] `PUBLIC_ORIGIN` — публичный HTTPS-origin.
- [ ] `SESSION_SECRET` и `ADMIN_PASSWORD_HASH` лежат только в `.env`/секретах хостинга.
- [ ] `ADMIN_PASSWORD_HASH` не равен дефолтному, если сайт публичный.
- [ ] Origin закрыт файрволом CDN.
- [ ] Настроены бэкапы `server/data/store.json`.
- [ ] Проверены лимиты Cloudflare/Nginx на тестовом трафике.
- [ ] Есть алерты на 5xx, 429 и рост `activeRequests`.
