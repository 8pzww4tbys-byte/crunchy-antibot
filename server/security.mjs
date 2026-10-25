import path from 'node:path';
import fs from 'node:fs';

export class HttpError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = options.code || 'http_error';
    this.headers = options.headers || {};
  }
}

export function json(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  const length = Buffer.byteLength(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Length', length);
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  if (res.req && res.req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
}

export function normalizeIp(value) {
  if (!value) return '';
  let ip = String(value).trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') ip = '127.0.0.1';
  return /^[0-9a-fA-F:.]{2,64}$/.test(ip) ? ip : '';
}

export function clientIp(req, trustProxy = false) {
  if (trustProxy) {
    const cf = req.headers['cf-connecting-ip'];
    if (cf) {
      const ip = normalizeIp(Array.isArray(cf) ? cf[0] : cf);
      if (ip) return ip;
    }
    const real = req.headers['x-real-ip'];
    if (real) {
      const ip = normalizeIp(Array.isArray(real) ? real[0] : real);
      if (ip) return ip;
    }
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const first = String(Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0];
      const ip = normalizeIp(first);
      if (ip) return ip;
    }
  }
  return normalizeIp(req.socket?.remoteAddress) || 'unknown';
}

export function setCors(req, res, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const allowed = allowedOrigins.includes(origin) || allowedOrigins.includes('*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Crunchy-License');
  res.setHeader('Access-Control-Max-Age', '600');
  if (!allowed) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  return true;
}

export function setRateHeaders(res, limit, remaining, retryAfter) {
  res.setHeader('RateLimit-Limit', String(limit));
  res.setHeader('RateLimit-Remaining', String(Math.max(0, remaining)));
  res.setHeader('RateLimit-Policy', String(limit));
  if (retryAfter) res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfter))));
}

export class RateLimiter {
  constructor({ windowMs, banAfter, banMs, cleanupMs = 300000 }) {
    this.windowMs = windowMs;
    this.banAfter = banAfter;
    this.banMs = banMs;
    this.buckets = new Map();
    this.bans = new Map();
    this.strikes = new Map();
    this._timer = setInterval(() => this.cleanup(), cleanupMs);
    this._timer.unref?.();
  }

  isBanned(ip) {
    const until = this.bans.get(ip);
    if (!until) return 0;
    if (until <= Date.now()) {
      this.bans.delete(ip);
      return 0;
    }
    return until;
  }

  hit(ip, category, limit, windowMs = this.windowMs) {
    const bannedUntil = this.isBanned(ip);
    if (bannedUntil) {
      return {
        allowed: false,
        banned: true,
        remaining: 0,
        retryAfter: Math.ceil((bannedUntil - Date.now()) / 1000),
        limit,
      };
    }

    const key = category + '|' + ip;
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.start >= windowMs) {
      bucket = { start: now, count: 0 };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count >= this.banAfter) {
      this.ban(ip);
    }

    const retryAfter = Math.ceil((bucket.start + windowMs - now) / 1000);
    return {
      allowed: bucket.count <= limit && !this.isBanned(ip),
      banned: Boolean(this.isBanned(ip)),
      remaining: Math.max(0, limit - bucket.count),
      retryAfter,
      limit,
    };
  }

  penalize(ip, points = 25, threshold = 100) {
    const now = Date.now();
    const current = this.strikes.get(ip);
    const score = (current && now - current.at < this.windowMs * 10 ? current.score : 0) + points;
    this.strikes.set(ip, { score, at: now });
    if (score >= threshold) {
      this.ban(ip);
      return true;
    }
    return false;
  }

  ban(ip) {
    this.bans.set(ip, Date.now() + this.banMs);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.start > this.windowMs * 5) this.buckets.delete(key);
    }
    for (const [ip, until] of this.bans) {
      if (until <= now) this.bans.delete(ip);
    }
    for (const [ip, strike] of this.strikes) {
      if (now - strike.at > this.windowMs * 10) this.strikes.delete(ip);
    }
  }
}

export class ConcurrencyGuard {
  constructor(maxGlobal, maxPerIp) {
    this.maxGlobal = maxGlobal;
    this.maxPerIp = maxPerIp;
    this.global = 0;
    this.byIp = new Map();
  }

  enter(ip) {
    if (this.global >= this.maxGlobal) {
      return { allowed: false, reason: 'global', active: this.global };
    }
    const current = this.byIp.get(ip) || 0;
    if (this.maxPerIp > 0 && current >= this.maxPerIp) {
      return { allowed: false, reason: 'ip', active: current };
    }
    this.global += 1;
    this.byIp.set(ip, current + 1);
    return { allowed: true, reason: null, active: this.global };
  }

  leave(ip) {
    this.global = Math.max(0, this.global - 1);
    const current = this.byIp.get(ip) || 0;
    if (current <= 1) this.byIp.delete(ip);
    else this.byIp.set(ip, current - 1);
  }
}

export function readJson(req, maxBytes, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '').toLowerCase();
    if (!type.startsWith('application/json')) {
      reject(new HttpError(415, 'Ожидается application/json', { code: 'unsupported_media_type' }));
      return;
    }

    const declared = Number(req.headers['content-length'] || 0);
    if (declared > maxBytes) {
      reject(new HttpError(413, 'Слишком большое тело запроса', { code: 'body_too_large' }));
      return;
    }

    let size = 0;
    let done = false;
    const chunks = [];
    const timer = setTimeout(() => finish(new HttpError(408, 'Тело запроса слишком долго не приходит', { code: 'request_timeout' })), timeoutMs);
    timer.unref?.();

    function finish(error, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      if (error) {
        req.resume();
        reject(error);
      } else {
        resolve(value);
      }
    }

    function onData(chunk) {
      size += chunk.length;
      if (size > maxBytes) {
        finish(new HttpError(413, 'Слишком большое тело запроса', { code: 'body_too_large' }));
        return;
      }
      chunks.push(chunk);
    }

    function onEnd() {
      if (!size) {
        finish(null, {});
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (_) {
        finish(new HttpError(400, 'Некорректный JSON', { code: 'invalid_json' }));
        return;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        finish(new HttpError(400, 'JSON должен быть объектом', { code: 'invalid_json' }));
        return;
      }
      finish(null, parsed);
    }

    function onError() {
      finish(new HttpError(400, 'Не удалось прочитать запрос', { code: 'request_read_error' }));
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

export function securityHeaders(res, { html = false, publicOrigin = '' } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (/^https:\/\//i.test(publicOrigin)) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  if (html) {
    const extra = publicOrigin ? ' ' + publicOrigin : '';
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; " +
        "img-src 'self' data: blob:; " +
        "style-src 'self' 'unsafe-inline'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "connect-src 'self'" + extra + ' http://127.0.0.1:8787 http://localhost:8787 https:; ' +
        "font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"
    );
  }
}

const BLOCKED_SEGMENTS = new Set([
  '.git',
  '.env',
  '.env.local',
  'node_modules',
  'server',
  'bin',
  'vendor',
  'cgi-bin',
]);

const SUSPICIOUS_PATHS = [
  /\/\.env/i,
  /\/\.git/i,
  /\/wp-(admin|login|content|includes)/i,
  /\/phpmyadmin/i,
  /\/cgi-bin/i,
  /\/actuator/i,
  /\/server-status/i,
  /\/xmlrpc\.php/i,
  /\/vendor\//i,
  /\/\.well-known\/security\.txt/i,
];

export function isSuspiciousPath(pathname) {
  return SUSPICIOUS_PATHS.some((pattern) => pattern.test(pathname));
}

export function safeStaticPath(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (_) {
    return null;
  }
  if (!decoded || decoded.length > 1024 || decoded.includes('\0') || decoded.includes('\\')) return null;
  if (decoded === '/') decoded = '/index.html';

  const segments = decoded.split('/').filter(Boolean);
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || segment.startsWith('.')) return null;
    if (BLOCKED_SEGMENTS.has(segment)) return null;
  }

  const relative = segments.join(path.sep);
  const full = path.resolve(root, relative);
  const rootResolved = path.resolve(root);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) return null;

  try {
    const real = fs.realpathSync(full);
    const realRoot = fs.realpathSync(rootResolved);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
    return real;
  } catch (_) {
    return full;
  }
}

export function logLine(parts) {
  console.log(
    new Date().toISOString() + ' ' + parts.map((part) => String(part)).join(' ')
  );
}
