import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { config, PLANS, PLAN_LIST } from './config.mjs';
import { Store, validEmail } from './store.mjs';
import {
  hashPassword,
  readCookie,
  safeEqual,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  signSession,
  verifyPassword,
  verifySession,
} from './auth.mjs';
import {
  ConcurrencyGuard,
  HttpError,
  RateLimiter,
  clientIp,
  isSuspiciousPath,
  json,
  logLine,
  normalizeIp,
  readJson,
  safeStaticPath,
  securityHeaders,
  setCors,
  setRateHeaders,
} from './security.mjs';

const store = new Store(config.dataDir);
const limiter = new RateLimiter({
  windowMs: config.security.rateWindowMs,
  banAfter: config.security.banAfter,
  banMs: config.security.banMs,
});
const concurrency = new ConcurrencyGuard(
  config.security.maxActiveRequests,
  config.security.maxRequestsPerIp
);

const authReady = Boolean(config.auth.sessionSecret);
const adminReady = Boolean(config.auth.adminPasswordHash);
const cookieSecure = /^https:\/\//i.test(config.publicOrigin);
const adminFailures = new Map();

const metrics = {
  startedAt: new Date().toISOString(),
  requests: 0,
  apiRequests: 0,
  staticRequests: 0,
  blocked: 0,
  rateLimited: 0,
  banned: 0,
};

if (!authReady) {
  console.warn('[auth] SESSION_SECRET is empty; login/registration are disabled until it is set');
}
if (!adminReady) {
  console.warn('[auth] ADMIN_PASSWORD_HASH is empty; /admin.html cannot log in until it is set');
}

function text(value, max = 120) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function publicPlan(plan) {
  return {
    id: plan.id,
    name: plan.name,
    price: plan.price,
    limit: plan.limit,
    days: plan.days,
    paid: plan.paid,
    description: plan.description,
  };
}

function licenseResponse(license, extra = {}) {
  return {
    ok: true,
    licenseKey: license.key,
    ...store.usageView(license),
    ...extra,
  };
}

function requestPath(req) {
  return new URL(req.url || '/', config.publicOrigin);
}

function logPath(req) {
  const raw = String(req.url || '');
  const query = raw.indexOf('?');
  return query === -1 ? raw : raw.slice(0, query);
}

function userAgent(req) {
  return text(req.headers['user-agent'] || '', 220);
}

function sessionFor(req) {
  if (!authReady) return null;
  const token = readCookie(req, config.auth.cookieName);
  const data = verifySession(token, config.auth.sessionSecret);
  if (!data) return null;
  if (data.role === 'admin') return { role: 'admin', admin: true };
  if (data.role !== 'user' || !data.userId) return null;
  const user = store.getUserById(data.userId);
  if (!user || user.blocked) return null;
  return { role: 'user', user };
}

function requireSession(req, role = '') {
  const session = sessionFor(req);
  if (!session || (role && session.role !== role)) {
    throw new HttpError(401, 'Нужно войти в аккаунт', { code: 'unauthorized' });
  }
  return session;
}

function setSession(req, res, payload) {
  if (!authReady) {
    throw new HttpError(503, 'Вход временно недоступен: не настроен SESSION_SECRET', {
      code: 'auth_not_configured',
    });
  }
  const ttl = config.auth.sessionDays * 24 * 60 * 60 * 1000;
  const token = signSession(payload, config.auth.sessionSecret, ttl);
  if (!token) {
    throw new HttpError(503, 'Не удалось создать сессию', { code: 'session_error' });
  }
  res.setHeader(
    'Set-Cookie',
    serializeSessionCookie(config.auth.cookieName, token, {
      secure: cookieSecure,
      maxAgeSeconds: Math.floor(ttl / 1000),
    })
  );
}

function clearSession(res) {
  res.setHeader(
    'Set-Cookie',
    serializeClearedSessionCookie(config.auth.cookieName, { secure: cookieSecure })
  );
}

function logUserEvent(type, req, user = null, meta = null, dedupeKey = '') {
  return store.log(
    type,
    {
      userId: user?.id || null,
      email: user?.email || '',
      ip: clientIp(req, config.trustProxy),
      userAgent: userAgent(req),
      meta,
    },
    dedupeKey
  );
}

function adminLockRemaining(ip) {
  const item = adminFailures.get(ip);
  if (!item) return 0;
  if (item.lockedUntil > Date.now()) return Math.ceil((item.lockedUntil - Date.now()) / 1000);
  if (item.lockedUntil && item.lockedUntil <= Date.now()) adminFailures.delete(ip);
  return 0;
}

function noteAdminFailure(ip) {
  const now = Date.now();
  const item = adminFailures.get(ip) || {
    count: 0,
    firstAt: now,
    lockedUntil: 0,
  };
  if (now - item.firstAt > config.auth.adminLockMs) {
    item.count = 0;
    item.firstAt = now;
  }
  item.count += 1;
  if (item.count >= config.auth.adminFailures) {
    item.lockedUntil = now + config.auth.adminLockMs;
  }
  adminFailures.set(ip, item);
  return adminLockRemaining(ip);
}

async function registerUser(req, res) {
  const body = await readJson(req, config.security.maxBodyBytes);
  const siteName = text(body.siteName, 120);
  const email = validEmail(body.email);
  const password = String(body.password || '');

  if (siteName.length < 2) {
    throw new HttpError(400, 'Укажите название сайта (минимум 2 символа)', {
      code: 'site_required',
    });
  }
  if (!email) {
    throw new HttpError(400, 'Проверьте e-mail', { code: 'invalid_email' });
  }
  if (password.length < 8 || password.length > 128) {
    throw new HttpError(400, 'Пароль должен быть от 8 до 128 символов', {
      code: 'invalid_password',
    });
  }
  if (store.getUserByEmail(email)) {
    throw new HttpError(409, 'Аккаунт с таким e-mail уже существует', {
      code: 'email_taken',
    });
  }

  const passwordHash = await hashPassword(password);
  const created = store.createUser({ email, passwordHash, siteName });
  if (!created) {
    throw new HttpError(409, 'Аккаунт с таким e-mail уже существует', {
      code: 'email_taken',
    });
  }

  logUserEvent('register', req, created.user, { siteName });
  setSession(req, res, { role: 'user', userId: created.user.id });
  json(res, 201, {
    ok: true,
    user: store.userView(created.user),
    licenseKey: created.license.key,
  });
}

async function loginUser(req, res) {
  const body = await readJson(req, config.security.maxBodyBytes);
  const email = validEmail(body.email);
  const password = String(body.password || '');
  if (!email || !password) {
    throw new HttpError(400, 'Введите e-mail и пароль', { code: 'credentials_required' });
  }

  const user = store.getUserByEmail(email);
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!ok) {
    store.log('login_failed', {
      email,
      ip: clientIp(req, config.trustProxy),
      userAgent: userAgent(req),
      meta: null,
    });
    throw new HttpError(401, 'Неверный e-mail или пароль', { code: 'invalid_credentials' });
  }
  if (user.blocked) {
    logUserEvent('login_blocked', req, user);
    throw new HttpError(403, 'Аккаунт заблокирован администратором', { code: 'user_blocked' });
  }

  user.lastLoginAt = new Date().toISOString();
  store.save();
  logUserEvent('login', req, user);
  setSession(req, res, { role: 'user', userId: user.id });
  json(res, 200, { ok: true, user: store.userView(user) });
}

async function me(req, res) {
  const session = requireSession(req, 'user');
  json(res, 200, {
    ok: true,
    user: store.userView(session.user),
    requests: store.listLimitRequests({ userId: session.user.id, limit: 10 }),
    freeLimit: config.freeLimit,
    supportEmail: config.supportEmail,
  });
}

async function createLimitRequest(req, res) {
  const session = requireSession(req, 'user');
  if (store.pendingLimitRequest(session.user.id)) {
    throw new HttpError(409, 'Запрос уже отправлен и ожидает ответа администратора', {
      code: 'request_pending',
    });
  }
  const body = await readJson(req, config.security.maxBodyBytes);
  const requestedLimit = Math.floor(Number(body.requestedLimit));
  if (!Number.isFinite(requestedLimit) || requestedLimit <= session.user.limit) {
    throw new HttpError(400, 'Укажите лимит больше текущего', {
      code: 'invalid_requested_limit',
    });
  }
  if (requestedLimit > 10000000) {
    throw new HttpError(400, 'Максимальный лимит — 10 000 000 юзеров в месяц', {
      code: 'invalid_requested_limit',
    });
  }

  const request = store.createLimitRequest(
    session.user,
    requestedLimit,
    text(body.message, 500)
  );
  logUserEvent('limit_request', req, session.user, {
    requestedLimit,
    currentLimit: request.currentLimit,
  });
  json(res, 201, { ok: true, request });
}

async function submitSupport(req, res) {
  const body = await readJson(req, config.security.maxBodyBytes);
  const message = text(body.message, 2000);
  const name = text(body.name, 80);
  const emailValue = body.email ? validEmail(body.email) : '';
  const session = sessionFor(req);

  if (body.email && !emailValue) {
    throw new HttpError(400, 'Проверьте e-mail', { code: 'invalid_email' });
  }
  if (message.length < 10) {
    throw new HttpError(400, 'Опишите проблему подробнее (минимум 10 символов)', {
      code: 'message_required',
    });
  }

  store.log('support_request', {
    userId: session?.role === 'user' ? session.user.id : null,
    email: emailValue || (session?.role === 'user' ? session.user.email : ''),
    ip: clientIp(req, config.trustProxy),
    userAgent: userAgent(req),
    meta: {
      name,
      message,
      site: text(body.site, 160),
    },
  });
  json(res, 201, {
    ok: true,
    message: 'Сообщение отправлено. Администратор увидит его в панели.',
  });
}

async function recordUsage(req, res) {
  const body = await readJson(req, config.security.maxBodyBytes);
  const key = text(body.licenseKey, 128);
  const visitorId = text(body.visitorId, 160);
  if (!key) throw new HttpError(400, 'Нужен licenseKey', { code: 'license_required' });
  if (visitorId.length < 8 || visitorId.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(visitorId)) {
    throw new HttpError(400, 'Некорректный visitorId', { code: 'invalid_visitor' });
  }

  const result = store.recordUsage(key, visitorId);
  if (!result) throw new HttpError(404, 'Ключ не найден', { code: 'license_not_found' });

  if (!result.allowed) {
    const license = store.getLicense(key);
    const user = license?.userId ? store.getUserById(license.userId) : null;
    store.log(
      'quota_exceeded',
      {
        userId: user?.id || null,
        email: user?.email || '',
        ip: clientIp(req, config.trustProxy),
        userAgent: userAgent(req),
        meta: { used: result.used, limit: result.limit },
      },
      `quota:${key}:${result.month}`
    );
    json(res, 402, { ok: false, error: 'quota_exceeded', ...result });
    return;
  }
  json(res, 200, { ok: true, ...result });
}

async function licenseInfo(req, res) {
  const body = await readJson(req, config.security.maxBodyBytes);
  const key = text(body.licenseKey, 128);
  const license = store.getLicense(key);
  if (!license) throw new HttpError(404, 'Ключ не найден', { code: 'license_not_found' });
  json(res, 200, licenseResponse(license));
}

async function adminLogin(req, res, ip) {
  const locked = adminLockRemaining(ip);
  if (locked) {
    throw new HttpError(429, 'Слишком много попыток. Попробуйте позже.', {
      code: 'admin_locked',
      headers: { 'Retry-After': String(locked) },
    });
  }
  if (!adminReady) {
    throw new HttpError(503, 'Вход администратора не настроен (ADMIN_PASSWORD_HASH)', {
      code: 'admin_not_configured',
    });
  }

  const body = await readJson(req, config.security.maxBodyBytes);
  const login = text(body.username || body.login, 80);
  const password = String(body.password || '');
  const ok = safeEqual(login, config.auth.adminLogin) &&
    (await verifyPassword(password, config.auth.adminPasswordHash));

  if (!ok) {
    const wait = noteAdminFailure(ip);
    store.log('admin_login_failed', {
      ip,
      userAgent: userAgent(req),
      meta: { login: login.slice(0, 80), wait },
    });
    throw new HttpError(401, 'Неверный логин или пароль', { code: 'invalid_admin_credentials' });
  }

  adminFailures.delete(ip);
  store.log('admin_login', {
    ip,
    userAgent: userAgent(req),
    meta: { login: config.auth.adminLogin },
  });
  setSession(req, res, { role: 'admin' });
  json(res, 200, { ok: true, admin: true });
}

function adminOverview(req, res) {
  requireSession(req, 'admin');
  json(res, 200, {
    ok: true,
    stats: store.stats(),
    users: store.listUsers(500),
    requests: store.listLimitRequests({ limit: 200 }),
    logs: store.listLogs(250),
    freeLimit: config.freeLimit,
    now: new Date().toISOString(),
  });
}

async function adminSetLimit(req, res, userId) {
  requireSession(req, 'admin');
  const body = await readJson(req, config.security.maxBodyBytes);
  const limit = Math.floor(Number(body.limit));
  if (!Number.isFinite(limit) || limit < 1 || limit > 10000000) {
    throw new HttpError(400, 'Лимит должен быть от 1 до 10 000 000', {
      code: 'invalid_limit',
    });
  }
  const user = store.getUserById(userId);
  if (!user) throw new HttpError(404, 'Пользователь не найден', { code: 'user_not_found' });
  const view = store.setUserLimit(userId, limit);
  store.log('admin_limit_changed', {
    ip: clientIp(req, config.trustProxy),
    userAgent: userAgent(req),
    meta: { userId, email: user.email, limit },
  });
  json(res, 200, { ok: true, user: view });
}

async function adminSetBlocked(req, res, userId) {
  requireSession(req, 'admin');
  const body = await readJson(req, config.security.maxBodyBytes);
  const blocked = Boolean(body.blocked);
  const user = store.getUserById(userId);
  if (!user) throw new HttpError(404, 'Пользователь не найден', { code: 'user_not_found' });
  const view = store.setUserBlocked(userId, blocked);
  store.log(blocked ? 'admin_user_blocked' : 'admin_user_unblocked', {
    ip: clientIp(req, config.trustProxy),
    userAgent: userAgent(req),
    meta: { userId, email: user.email },
  });
  json(res, 200, { ok: true, user: view });
}

async function adminResolveRequest(req, res, requestId) {
  requireSession(req, 'admin');
  const request = store.getLimitRequest(requestId);
  if (!request) throw new HttpError(404, 'Запрос не найден', { code: 'request_not_found' });
  const body = await readJson(req, config.security.maxBodyBytes);
  const status = body.status === 'approved' ? 'approved' : body.status === 'rejected' ? 'rejected' : '';
  if (!status) throw new HttpError(400, 'Статус: approved или rejected', { code: 'invalid_status' });
  const limit = status === 'approved' ? Math.floor(Number(body.limit) || request.requestedLimit) : null;
  const updated = store.resolveLimitRequest(requestId, status, limit);
  store.log('admin_limit_request_resolved', {
    ip: clientIp(req, config.trustProxy),
    userAgent: userAgent(req),
    meta: {
      requestId,
      email: request.email,
      status,
      limit: updated?.requestedLimit || null,
    },
  });
  json(res, 200, { ok: true, request: updated });
}

async function handleApi(req, res, url, ip) {
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'GET' && pathname === '/api/health') {
    json(res, 200, {
      ok: true,
      service: 'crunchy-antibot',
      version: config.appVersion,
      free: true,
      freeLimit: config.freeLimit,
      authConfigured: authReady,
      adminConfigured: adminReady,
      plans: PLAN_LIST.map(publicPlan),
      users: store.stats().users,
      metrics: { ...metrics, activeRequests: concurrency.global },
      security: {
        rateLimits: {
          static: config.security.staticLimit,
          api: config.security.apiLimit,
          auth: config.security.authLimit,
          support: config.security.supportLimit,
        },
        maxBodyBytes: config.security.maxBodyBytes,
        banAfter: config.security.banAfter,
      },
      now: new Date().toISOString(),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/plans') {
    json(res, 200, {
      ok: true,
      free: true,
      limit: config.freeLimit,
      plans: PLAN_LIST.map(publicPlan),
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/register') {
    await registerUser(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/login') {
    await loginUser(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/logout') {
    const session = sessionFor(req);
    if (session?.role === 'user') logUserEvent('logout', req, session.user);
    clearSession(res);
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/me') {
    await me(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/limit-request') {
    await createLimitRequest(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/support') {
    await submitSupport(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/usage') {
    await recordUsage(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/license/info') {
    await licenseInfo(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/login') {
    await adminLogin(req, res, ip);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/logout') {
    requireSession(req, 'admin');
    store.log('admin_logout', {
      ip: clientIp(req, config.trustProxy),
      userAgent: userAgent(req),
    });
    clearSession(res);
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/overview') {
    adminOverview(req, res);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/logs') {
    requireSession(req, 'admin');
    const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 250));
    json(res, 200, { ok: true, logs: store.listLogs(limit) });
    return;
  }

  const userLimitMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/limit$/);
  if (req.method === 'POST' && userLimitMatch) {
    await adminSetLimit(req, res, decodeURIComponent(userLimitMatch[1]));
    return;
  }

  const userBlockMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/block$/);
  if (req.method === 'POST' && userBlockMatch) {
    await adminSetBlocked(req, res, decodeURIComponent(userBlockMatch[1]));
    return;
  }

  const requestMatch = pathname.match(/^\/api\/admin\/requests\/([^/]+)$/);
  if (req.method === 'POST' && requestMatch) {
    await adminResolveRequest(req, res, decodeURIComponent(requestMatch[1]));
    return;
  }

  throw new HttpError(404, 'API-метод не найден', { code: 'not_found' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function cacheControlFor(file) {
  const normalized = file.replace(/\\/g, '/');
  if (normalized.includes('/assets/photos/')) return 'public, max-age=2592000, immutable';
  if (/\.html?$/i.test(normalized)) return 'no-cache';
  if (/\.(css|js|mjs|png|jpe?g|webp|svg|woff2?)$/i.test(normalized)) {
    return 'public, max-age=3600';
  }
  return 'public, max-age=3600';
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    throw new HttpError(405, 'Метод не разрешён', { code: 'method_not_allowed' });
  }

  let file = safeStaticPath(config.staticRoot, pathname);
  if (!file) throw new HttpError(404, 'Страница не найдена', { code: 'not_found' });

  let stat;
  try {
    stat = await fsp.stat(file);
    if (stat.isDirectory()) {
      file = path.join(file, 'index.html');
      stat = await fsp.stat(file);
    }
  } catch (_) {
    throw new HttpError(404, 'Страница не найдена', { code: 'not_found' });
  }
  if (!stat.isFile()) throw new HttpError(404, 'Страница не найдена', { code: 'not_found' });

  const ext = path.extname(file).toLowerCase();
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', cacheControlFor(file));
    res.end();
    return;
  }

  const html = ext === '.html';
  securityHeaders(res, { html, publicOrigin: config.publicOrigin });
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', stat.mtime.toUTCString());
  res.setHeader('Cache-Control', cacheControlFor(file));
  res.setHeader('X-Robots-Tag', 'index, follow');

  if (req.method === 'HEAD') {
    res.statusCode = 200;
    res.end();
    return;
  }

  res.statusCode = 200;
  await new Promise((resolve, reject) => {
    pipeline(fs.createReadStream(file), res, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function errorResponse(res, req, error, ip) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : 'internal_error';
  const message =
    status >= 500 ? 'Внутренняя ошибка сервера' : error.message || 'Ошибка запроса';

  if (status === 429) {
    metrics.rateLimited += 1;
    if (limiter.isBanned(ip)) metrics.banned += 1;
  } else if (status === 403 || status === 404) {
    metrics.blocked += 1;
  }

  if (status >= 500) {
    logLine(['ERROR', req.method, logPath(req), status, code, error.message]);
  }

  if (res.headersSent) {
    res.destroy();
    return;
  }

  const isApi = String(req.url || '').startsWith('/api/');
  const headers = { ...(error.headers || {}) };
  if (status === 413 || status === 408) headers.Connection = 'close';

  if (isApi) {
    json(res, status, { ok: false, error: code, message }, headers);
  } else {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
    res.end(message);
  }

  if (headers.Connection === 'close') {
    req.socket?.end();
  }
}

const AUTH_PATHS = new Set([
  '/api/register',
  '/api/login',
  '/api/logout',
  '/api/limit-request',
  '/api/admin/login',
  '/api/admin/logout',
]);

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let ip = 'unknown';
  let counted = false;

  try {
    const url = requestPath(req);
    const pathname = url.pathname;
    const isApi = pathname.startsWith('/api/');
    ip = clientIp(req, config.trustProxy);

    metrics.requests += 1;
    if (isApi) metrics.apiRequests += 1;
    else metrics.staticRequests += 1;

    const slot = concurrency.enter(ip);
    if (!slot.allowed) {
      const status = slot.reason === 'global' ? 503 : 429;
      setRateHeaders(res, config.security.maxRequestsPerIp, 0, 1);
      throw new HttpError(status, 'Сервер перегружен, попробуйте через секунду', {
        code: slot.reason === 'global' ? 'server_busy' : 'too_many_concurrent',
        headers: { 'Retry-After': '1' },
      });
    }
    counted = true;
    res.on('close', () => {
      if (counted) {
        concurrency.leave(ip);
        counted = false;
      }
    });

    securityHeaders(res, { html: false, publicOrigin: config.publicOrigin });

    if (isApi) {
      const corsOk = setCors(req, res, config.allowedOrigins);
      if (!corsOk) {
        throw new HttpError(403, 'Origin не разрешён', { code: 'origin_not_allowed' });
      }
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.setHeader('Content-Length', '0');
        res.end();
        return;
      }
    }

    if (!['GET', 'HEAD', 'POST', 'OPTIONS'].includes(req.method)) {
      throw new HttpError(405, 'Метод не разрешён', {
        code: 'method_not_allowed',
        headers: { Allow: 'GET, HEAD, POST, OPTIONS' },
      });
    }

    if (pathname.length > 1024) {
      limiter.penalize(ip, 50);
      throw new HttpError(414, 'Слишком длинный URL', { code: 'uri_too_long' });
    }

    const bannedUntil = limiter.isBanned(ip);
    if (bannedUntil) {
      throw new HttpError(429, 'IP временно заблокирован', {
        code: 'ip_banned',
        headers: { 'Retry-After': String(Math.ceil((bannedUntil - Date.now()) / 1000)) },
      });
    }

    if (isSuspiciousPath(pathname)) {
      limiter.penalize(ip, 50);
      throw new HttpError(404, 'Страница не найдена', { code: 'not_found' });
    }

    const isAuth = isApi && AUTH_PATHS.has(pathname);
    const isSupport = isApi && pathname === '/api/support';
    const category = isApi ? (isAuth ? 'auth' : isSupport ? 'support' : 'api') : 'static';
    const limit = isApi
      ? isAuth
        ? config.security.authLimit
        : isSupport
          ? config.security.supportLimit
          : config.security.apiLimit
      : config.security.staticLimit;
    const rate = limiter.hit(ip, category, limit);
    setRateHeaders(res, limit, rate.remaining, rate.allowed ? 0 : rate.retryAfter);
    if (!rate.allowed) {
      throw new HttpError(429, 'Слишком много запросов. Попробуйте позже.', {
        code: rate.banned ? 'ip_banned' : 'rate_limited',
        headers: { 'Retry-After': String(Math.max(1, rate.retryAfter)) },
      });
    }

    if (isApi) {
      await handleApi(req, res, url, ip);
    } else {
      await serveStatic(req, res, pathname);
    }
  } catch (error) {
    errorResponse(res, req, error, ip);
  } finally {
    if (counted) {
      concurrency.leave(ip);
      counted = false;
    }
    if (String(req.url || '').startsWith('/api/') || res.statusCode >= 400) {
      logLine([
        req.method,
        logPath(req),
        res.statusCode,
        ip,
        (Date.now() - started) + 'ms',
      ]);
    }
  }
});

server.maxConnections = config.security.maxConnections;
server.requestTimeout = config.security.requestTimeoutMs;
server.headersTimeout = config.security.headersTimeoutMs;
server.keepAliveTimeout = config.security.keepAliveTimeoutMs;
server.maxHeadersCount = config.security.maxHeaderCount;
server.maxRequestsPerSocket = 100;

const socketsByIp = new Map();
server.on('connection', (socket) => {
  const ip = normalizeIp(socket.remoteAddress) || 'unknown';
  if (!config.trustProxy && config.security.maxConnectionsPerIp > 0) {
    const count = socketsByIp.get(ip) || 0;
    if (count >= config.security.maxConnectionsPerIp) {
      socket.destroy();
      return;
    }
    socketsByIp.set(ip, count + 1);
    socket.once('close', () => {
      const next = (socketsByIp.get(ip) || 1) - 1;
      if (next <= 0) socketsByIp.delete(ip);
      else socketsByIp.set(ip, next);
    });
  }
  socket.setNoDelay(true);
});

server.on('clientError', (error, socket) => {
  const status = error.code === 'HPE_HEADER_OVERFLOW' ? 431 : 400;
  const body = status === 431 ? 'Request Header Fields Too Large' : 'Bad Request';
  if (socket.writable) {
    socket.end(
      `HTTP/1.1 ${status} ${body}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
    );
  } else {
    socket.destroy();
  }
});

server.listen(config.port, config.host, () => {
  console.log('');
  console.log('  crunchy antibot server ' + config.appVersion);
  console.log('  http://' + config.host + ':' + config.port);
  console.log('  free plan: ' + PLANS.free.limit + ' unique visitors / month');
  console.log('  auth: ' + (authReady ? 'ready' : 'NOT configured (set SESSION_SECRET)'));
  console.log('  admin: ' + (adminReady ? 'ready' : 'NOT configured (set ADMIN_PASSWORD_HASH)'));
  console.log(
    '  limits: ' +
      config.security.staticLimit +
      ' static/min, ' +
      config.security.apiLimit +
      ' api/min, ' +
      config.security.authLimit +
      ' auth/min, max ' +
      config.security.maxConnections +
      ' connections'
  );
  console.log('');
});

function shutdown(signal) {
  console.log('\n' + signal + ': shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
