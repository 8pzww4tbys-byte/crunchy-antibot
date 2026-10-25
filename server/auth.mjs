import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function fromBase64url(value) {
  return Buffer.from(String(value), 'base64url');
}

export function safeEqual(leftValue, rightValue) {
  const left = Buffer.from(String(leftValue || ''));
  const right = Buffer.from(String(rightValue || ''));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function hashPassword(password) {
  const salt = randomBytes(18).toString('base64url');
  const derived = await scrypt(String(password), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${salt}$${base64url(derived)}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const parts = String(encoded || '').split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const salt = parts[1];
    const expected = fromBase64url(parts[2]);
    if (!salt || expected.length !== KEY_LENGTH) return false;
    const derived = await scrypt(String(password), salt, KEY_LENGTH, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 64 * 1024 * 1024,
    });
    return timingSafeEqual(derived, expected);
  } catch (_) {
    return false;
  }
}

export function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const item of String(header).split(';')) {
    const index = item.indexOf('=');
    if (index < 1) continue;
    const key = item.slice(0, index).trim();
    if (!key || Object.prototype.hasOwnProperty.call(cookies, key)) continue;
    let value = item.slice(index + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch (_) {
      continue;
    }
    cookies[key] = value;
  }
  return cookies;
}

export function readCookie(req, name) {
  return parseCookies(req.headers?.cookie)[name] || '';
}

export function signSession(payload, secret, ttlMs) {
  if (!secret) return '';
  const data = {
    ...payload,
    iat: Date.now(),
    exp: Date.now() + ttlMs,
  };
  const body = base64url(JSON.stringify(data));
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + signature;
}

export function verifySession(token, secret) {
  if (!token || !secret) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  const expected = createHmac('sha256', secret).update(body).digest();
  let provided;
  try {
    provided = fromBase64url(signature);
  } catch (_) {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  let data;
  try {
    data = JSON.parse(fromBase64url(body).toString('utf8'));
  } catch (_) {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  if (!Number.isFinite(data.exp) || data.exp <= Date.now()) return null;
  return data;
}

export function serializeSessionCookie(name, token, { secure = false, maxAgeSeconds = 0 } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  if (maxAgeSeconds > 0) parts.push(`Max-Age=${Math.floor(maxAgeSeconds)}`);
  return parts.join('; ');
}

export function serializeClearedSessionCookie(name, { secure = false } = {}) {
  const parts = [
    `${name}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
