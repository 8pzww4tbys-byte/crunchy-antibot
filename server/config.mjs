import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, '.env'));

function email(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
}

function emails(value) {
  return Array.from(
    new Set(
      String(value || '')
        .split(',')
        .map((item) => email(item))
        .filter(Boolean)
    )
  );
}

function num(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function bool(name, fallback = false) {
  const value = String(process.env[name] || '').toLowerCase();
  if (!value) return fallback;
  return value === '1' || value === 'true' || value === 'yes';
}

function list(name, fallback = []) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

const publicOrigin = (process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:8787').replace(/\/$/, '');
const defaultOrigins = [
  'http://127.0.0.1:8787',
  'http://localhost:8787',
  'http://127.0.0.1:8123',
  'http://localhost:8123',
  'https://8pzww4tbys-byte.github.io',
];
const allowedOrigins = Array.from(new Set([publicOrigin, ...list('ALLOWED_ORIGINS', defaultOrigins)]));
const adminEmails = emails(process.env.ADMIN_EMAIL);

export const PLANS = Object.freeze({
  free: Object.freeze({
    id: 'free',
    name: 'free',
    price: 0,
    limit: num('FREE_LIMIT', 10000, 1, 10000000),
    days: 0,
    paid: false,
    description: '10 000 уникальных посетителей в месяц',
  }),
});

export const PLAN_LIST = Object.values(PLANS);

export const config = Object.freeze({
  appVersion: '0.6.0',
  port: num('PORT', 8787, 1, 65535),
  host: process.env.HOST || '127.0.0.1',
  publicOrigin,
  allowedOrigins,
  trustProxy: bool('TRUST_PROXY', false),
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'server/data'),
  staticRoot: ROOT,
  freeLimit: PLANS.free.limit,
  supportEmail: String(process.env.SUPPORT_EMAIL || '').trim(),
  auth: Object.freeze({
    sessionSecret: String(process.env.SESSION_SECRET || ''),
    sessionDays: num('SESSION_DAYS', 30, 1, 180),
    cookieName: 'crunchy_session',
    adminEmail: adminEmails[0] || '',
    adminEmails: Object.freeze(adminEmails),
    adminPasswordHash: String(process.env.ADMIN_PASSWORD_HASH || '').trim(),
    adminLockMs: num('ADMIN_LOCK_MS', 15 * 60_000, 60_000, 24 * 3600_000),
    adminFailures: num('ADMIN_FAILURES', 5, 1, 100),
  }),
  security: {
    maxConnections: num('MAX_CONNECTIONS', 512, 1, 100000),
    maxConnectionsPerIp: num('MAX_CONNECTIONS_PER_IP', 24, 0, 10000),
    maxActiveRequests: num('MAX_ACTIVE_REQUESTS', 256, 1, 100000),
    maxRequestsPerIp: num('MAX_REQUESTS_PER_IP', 12, 0, 10000),
    maxBodyBytes: num('MAX_BODY_BYTES', 64 * 1024, 1024, 1024 * 1024),
    rateWindowMs: num('RATE_WINDOW_MS', 60_000, 1000, 3_600_000),
    staticLimit: num('RATE_LIMIT_STATIC', 600, 1, 1000000),
    apiLimit: num('RATE_LIMIT_API', 90, 1, 1000000),
    authLimit: num('RATE_LIMIT_AUTH', 12, 1, 1000000),
    supportLimit: num('RATE_LIMIT_SUPPORT', 6, 1, 1000000),
    banAfter: num('BAN_AFTER', 900, 1, 1000000),
    banMs: num('BAN_MS', 10 * 60_000, 1000, 7 * 24 * 3600_000),
    headersTimeoutMs: num('HEADERS_TIMEOUT_MS', 10_000, 1000, 120_000),
    requestTimeoutMs: num('REQUEST_TIMEOUT_MS', 20_000, 1000, 300_000),
    keepAliveTimeoutMs: num('KEEP_ALIVE_TIMEOUT_MS', 5_000, 500, 120_000),
    maxHeaderCount: num('MAX_HEADER_COUNT', 80, 10, 1000),
  },
});
