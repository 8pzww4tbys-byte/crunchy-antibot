import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { PLANS } from './config.mjs';

const EMPTY = {
  version: 2,
  users: {},
  licenses: {},
  usage: {},
  logs: [],
  limitRequests: {},
};

const MAX_LOGS = 5000;

function text(value, max = 120) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function id(prefix) {
  return prefix + randomBytes(10).toString('base64url');
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function validEmail(value) {
  const email = text(value, 160);
  if (!email) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : null;
}

export function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

export function nextMonthStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

export class Store {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, 'store.json');
    this.data = this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) return structuredClone(EMPTY);
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return {
        version: 2,
        users: parsed.users && typeof parsed.users === 'object' ? parsed.users : {},
        licenses: parsed.licenses && typeof parsed.licenses === 'object' ? parsed.licenses : {},
        usage: parsed.usage && typeof parsed.usage === 'object' ? parsed.usage : {},
        logs: Array.isArray(parsed.logs) ? parsed.logs.slice(-MAX_LOGS) : [],
        limitRequests:
          parsed.limitRequests && typeof parsed.limitRequests === 'object'
            ? parsed.limitRequests
            : {},
      };
    } catch (error) {
      try {
        const backup = this.file + '.corrupt-' + Date.now();
        fs.renameSync(this.file, backup);
      } catch (_) {
        // Keep the original error below.
      }
      console.error('[store] failed to read data file:', error.message);
      return structuredClone(EMPTY);
    }
  }

  save() {
    fs.mkdirSync(this.directory, { recursive: true });
    const temp = this.file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }

  newLicenseKey() {
    return 'cr_' + randomBytes(18).toString('base64url');
  }

  createLicense(planId, details = {}, save = true) {
    const plan = PLANS[planId] || PLANS.free;
    const key = this.newLicenseKey();
    const limit = Math.max(1, Math.floor(number(details.limit, plan.limit)));
    const license = {
      key,
      plan: plan.id,
      siteName: text(details.siteName) || 'Без названия',
      email: validEmail(details.email) || '',
      userId: text(details.userId, 64) || null,
      limit,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      status: 'active',
    };
    this.data.licenses[key] = license;
    if (save) this.save();
    return license;
  }

  getLicense(key) {
    return this.data.licenses[text(key, 128)] || null;
  }

  getUserById(userId) {
    return this.data.users[text(userId, 64)] || null;
  }

  getUserByEmail(email) {
    const normalized = validEmail(email);
    if (!normalized) return null;
    return (
      Object.values(this.data.users).find((user) => user.email === normalized) || null
    );
  }

  getUserByLicenseKey(key) {
    const license = this.getLicense(key);
    return license?.userId ? this.getUserById(license.userId) : null;
  }

  createUser({ email, passwordHash, siteName }) {
    const normalized = validEmail(email);
    if (!normalized || this.getUserByEmail(normalized)) return null;

    const userId = id('usr_');
    const safeSiteName = text(siteName, 120) || 'Без названия';
    const license = this.createLicense(
      'free',
      { siteName: safeSiteName, email: normalized, userId, limit: PLANS.free.limit },
      false
    );
    const now = new Date().toISOString();
    const user = {
      id: userId,
      email: normalized,
      passwordHash,
      siteName: safeSiteName,
      licenseKey: license.key,
      limit: license.limit,
      blocked: false,
      createdAt: now,
      lastLoginAt: null,
    };
    this.data.licenses[license.key].userId = userId;
    this.data.users[userId] = user;
    this.save();
    return { user, license };
  }

  setUserLimit(userId, limit) {
    const user = this.getUserById(userId);
    if (!user) return null;
    const value = Math.min(10000000, Math.max(1, Math.floor(number(limit, PLANS.free.limit))));
    user.limit = value;
    const license = this.getLicense(user.licenseKey);
    if (license) license.limit = value;
    this.save();
    return this.userView(user);
  }

  setUserBlocked(userId, blocked) {
    const user = this.getUserById(userId);
    if (!user) return null;
    user.blocked = Boolean(blocked);
    const license = this.getLicense(user.licenseKey);
    if (license) license.status = blocked ? 'blocked' : 'active';
    this.save();
    return this.userView(user);
  }

  createLimitRequest(user, requestedLimit, message) {
    const requestId = id('req_');
    const current = this.getLicense(user.licenseKey);
    const request = {
      id: requestId,
      userId: user.id,
      email: user.email,
      siteName: user.siteName,
      currentLimit: current ? this.usageView(current).limit : user.limit,
      requestedLimit: Math.min(10000000, Math.max(10001, Math.floor(number(requestedLimit)))),
      message: text(message, 500),
      status: 'pending',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    this.data.limitRequests[requestId] = request;
    this.save();
    return request;
  }

  getLimitRequest(requestId) {
    return this.data.limitRequests[text(requestId, 64)] || null;
  }

  pendingLimitRequest(userId) {
    return (
      Object.values(this.data.limitRequests).find(
        (request) => request.userId === userId && request.status === 'pending'
      ) || null
    );
  }

  resolveLimitRequest(requestId, status, approvedLimit = null) {
    const request = this.getLimitRequest(requestId);
    if (!request) return null;
    request.status = status === 'approved' ? 'approved' : 'rejected';
    request.resolvedAt = new Date().toISOString();
    if (request.status === 'approved') {
      const user = this.getUserById(request.userId);
      const current = user ? Math.floor(number(user.limit, PLANS.free.limit)) : 0;
      this.setUserLimit(
        request.userId,
        Math.max(current, approvedLimit || request.requestedLimit)
      );
    }
    this.save();
    return request;
  }

  listLimitRequests({ userId = '', pendingOnly = false, limit = 200 } = {}) {
    return Object.values(this.data.limitRequests)
      .filter((request) => !userId || request.userId === userId)
      .filter((request) => !pendingOnly || request.status === 'pending')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit);
  }

  usageView(license, date = new Date()) {
    const plan = PLANS[license.plan] || PLANS.free;
    const month = monthKey(date);
    const ids = this.data.usage[license.key]?.[month] || [];
    const used = ids.length;
    const configuredLimit = Math.floor(number(license.limit, plan.limit));
    const limit = configuredLimit > 0 ? configuredLimit : plan.limit;
    return {
      plan: plan.id,
      siteName: license.siteName,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      allowed: used < limit,
      expired: false,
      expiresAt: null,
      month,
      resetAt: nextMonthStart(date).toISOString(),
    };
  }

  recordUsage(licenseKey, visitorId, date = new Date()) {
    const license = this.getLicense(licenseKey);
    if (!license) return null;

    const owner = license.userId ? this.getUserById(license.userId) : null;
    if ((license.status && license.status !== 'active') || owner?.blocked) {
      return {
        ...this.usageView(license, date),
        allowed: false,
        reason: 'license_blocked',
      };
    }

    const plan = PLANS[license.plan] || PLANS.free;
    const configuredLimit = Math.floor(number(license.limit, plan.limit));
    const limit = configuredLimit > 0 ? configuredLimit : plan.limit;
    const month = monthKey(date);
    if (!this.data.usage[license.key]) this.data.usage[license.key] = {};
    if (!Array.isArray(this.data.usage[license.key][month])) {
      this.data.usage[license.key][month] = [];
    }
    const ids = this.data.usage[license.key][month];
    const hash = createHash('sha256')
      .update(license.key + ':' + String(visitorId))
      .digest('base64url')
      .slice(0, 16);

    const known = ids.includes(hash);
    let allowed = true;
    if (!known) {
      if (ids.length >= limit) {
        allowed = false;
      } else {
        ids.push(hash);
        this.save();
      }
    }

    return {
      ...this.usageView(license, date),
      allowed,
      reason: allowed ? null : 'quota_exceeded',
    };
  }

  userView(user) {
    const license = this.getLicense(user.licenseKey);
    const view = license
      ? this.usageView(license)
      : {
          plan: 'free',
          siteName: user.siteName,
          limit: user.limit || PLANS.free.limit,
          used: 0,
          remaining: user.limit || PLANS.free.limit,
          allowed: true,
          expired: false,
          expiresAt: null,
          month: monthKey(),
          resetAt: nextMonthStart().toISOString(),
        };
    return {
      id: user.id,
      email: user.email,
      siteName: user.siteName,
      licenseKey: user.licenseKey,
      blocked: Boolean(user.blocked),
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      limit: view.limit,
      usage: view,
    };
  }

  listUsers(limit = 500) {
    return Object.values(this.data.users)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit)
      .map((user) => this.userView(user));
  }

  stats() {
    const users = Object.values(this.data.users);
    const month = monthKey();
    let monthUsage = 0;
    for (const license of Object.values(this.data.licenses)) {
      monthUsage += this.data.usage[license.key]?.[month]?.length || 0;
    }
    return {
      users: users.length,
      blockedUsers: users.filter((user) => user.blocked).length,
      licenses: Object.keys(this.data.licenses).length,
      month,
      monthUsage,
      pendingRequests: Object.values(this.data.limitRequests).filter(
        (request) => request.status === 'pending'
      ).length,
    };
  }

  log(type, fields = {}, dedupeKey = '') {
    if (dedupeKey) {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const duplicate = this.data.logs.some(
        (entry) =>
          entry.dedupeKey === dedupeKey &&
          Number.isFinite(Date.parse(entry.at)) &&
          Date.parse(entry.at) >= cutoff
      );
      if (duplicate) return null;
    }

    const entry = {
      id: id('log_'),
      type: text(type, 48),
      at: new Date().toISOString(),
      userId: text(fields.userId, 64) || null,
      email: validEmail(fields.email) || '',
      ip: text(fields.ip, 64),
      userAgent: text(fields.userAgent, 220),
      meta: fields.meta && typeof fields.meta === 'object' ? fields.meta : null,
    };
    if (dedupeKey) entry.dedupeKey = text(dedupeKey, 160);
    this.data.logs.push(entry);
    if (this.data.logs.length > MAX_LOGS) {
      this.data.logs.splice(0, this.data.logs.length - MAX_LOGS);
    }
    this.save();
    return entry;
  }

  listLogs(limit = 200, type = '') {
    const wanted = text(type, 48);
    return this.data.logs
      .filter((entry) => !wanted || entry.type === wanted)
      .slice(-Math.min(1000, Math.max(1, Number(limit) || 200)))
      .reverse();
  }
}
