#!/usr/bin/env node
/**
 * Public smoke QA for a running crunchy antibot instance.
 *
 * Usage:
 *   QA_ADMIN_PASSWORD=... node qa-public.mjs
 *
 * Optional environment:
 *   QA_BASE            default https://crunchy.2-26-84-26.sslip.io
 *   QA_ADMIN_EMAIL     default admin@crunchy.2-26-84-26.sslip.io
 *   QA_ADMIN_PASSWORD  if empty, admin checks are skipped
 *   QA_KEEP=1          keep the generated test account (no effect here; printed for cleanup)
 *
 * The script never deletes data itself. It prints TEST_EMAIL / TEST_LICENSE so the
 * operator can remove the generated account from server/data/store.json.
 */

const BASE = (process.env.QA_BASE || 'https://crunchy.2-26-84-26.sslip.io').replace(/\/+$/, '');
const ADMIN_EMAIL = process.env.QA_ADMIN_EMAIL || 'admin@crunchy.2-26-84-26.sslip.io';
const ADMIN_PASSWORD = process.env.QA_ADMIN_PASSWORD || '';
const RUN = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const TEST_EMAIL = process.env.QA_TEST_EMAIL || `qa.${RUN}@example.com`;
const TEST_PASSWORD = `Qa!${RUN}${RUN}`;
const TEST_SITE = `QA Run ${RUN}`;
const VISITOR_ID = `qa-${RUN}-visitor`;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    failures.push(detail ? `${name} — ${detail}` : name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

function parseSetCookies(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie();
  }
  const raw = response.headers.get('set-cookie');
  if (!raw) return [];
  return raw.split(/,(?=\s*[^;=]+=)/g);
}

class Client {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
  }

  cookieHeader() {
    return Array.from(this.cookies, ([name, value]) => `${name}=${value}`).join('; ');
  }

  async request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (this.cookies.size) headers.set('cookie', this.cookieHeader());
    if (options.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    const response = await fetch(this.base + path, {
      ...options,
      headers,
      redirect: 'manual',
    });
    for (const cookie of parseSetCookies(response)) {
      const pair = cookie.split(';', 1)[0];
      const index = pair.indexOf('=');
      if (index < 1) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    return response;
  }

  async json(path, options = {}) {
    const response = await this.request(path, options);
    let body = null;
    try {
      body = await response.json();
    } catch (_) {
      body = null;
    }
    return { response, body };
  }
}

function post(client, path, body) {
  return client.json(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function main() {
  console.log(`crunchy antibot public QA`);
  console.log(`base:       ${BASE}`);
  console.log(`run:        ${RUN}`);
  console.log(`test email: ${TEST_EMAIL}`);

  const anonymous = new Client(BASE);
  const user = new Client(BASE);
  const admin = new Client(BASE);

  section('Static pages and clean URLs');
  const pages = [
    ['/', 'id="top"'],
    ['/register', 'register-form'],
    ['/login', 'login-form'],
    ['/dashboard', 'dashboard-page'],
    ['/admin', 'admin-page'],
    ['/support', 'support-form'],
    ['/examples/basic', 'crunchy'],
  ];
  for (const [path, marker] of pages) {
    const response = await anonymous.request(path);
    const text = await response.text();
    check(`GET ${path} -> 200`, response.status === 200, `status ${response.status}`);
    check(`${path} contains ${marker}`, text.includes(marker));
  }

  for (const path of ['/index.html', '/register.html', '/login.html', '/dashboard.html', '/admin.html', '/support.html']) {
    const response = await anonymous.request(path);
    const expected = path === '/index.html' ? '/' : path.replace(/\.html$/, '');
    const location = response.headers.get('location') || '';
    check(
      `GET ${path} -> 301 ${expected}`,
      response.status === 301 && new URL(location, BASE).pathname === expected,
      `status ${response.status}, location ${location}`
    );
  }

  const trailing = await anonymous.request('/register/');
  check(
    'GET /register/ -> 301 /register',
    trailing.status === 301 && new URL(trailing.headers.get('location') || '/', BASE).pathname === '/register',
    `status ${trailing.status}`
  );

  const missing = await anonymous.request('/definitely-not-a-page');
  check('GET /definitely-not-a-page -> 404', missing.status === 404, `status ${missing.status}`);

  section('Security headers');
  const home = await anonymous.request('/');
  const headers = home.headers;
  check(
    'X-Content-Type-Options: nosniff',
    (headers.get('x-content-type-options') || '').includes('nosniff')
  );
  check('X-Frame-Options: DENY', headers.get('x-frame-options') === 'DENY');
  check('Referrer-Policy is set', Boolean(headers.get('referrer-policy')));
  check('HSTS is set', Boolean(headers.get('strict-transport-security')));
  check('CSP is set on HTML', /default-src 'self'/.test(headers.get('content-security-policy') || ''));

  section('Plans and health');
  const health = await anonymous.json('/api/health');
  check('GET /api/health -> 200', health.response.status === 200, `status ${health.response.status}`);
  check('health.ok is true', health.body?.ok === true);
  check('free mode is enabled', health.body?.free === true);
  check('free limit is 10000', health.body?.freeLimit === 10000);
  check('exactly one plan', Array.isArray(health.body?.plans) && health.body.plans.length === 1);
  check('the only plan is free', health.body?.plans?.[0]?.id === 'free' && health.body?.plans?.[0]?.price === 0);
  check('no paid plans', health.body?.plans?.every((plan) => plan.paid === false) === true);

  const plans = await anonymous.json('/api/plans');
  check('GET /api/plans -> 200', plans.response.status === 200, `status ${plans.response.status}`);
  check('plans response has no paid plan', plans.body?.plans?.every((plan) => plan.paid === false) === true);

  const unauthorizedMe = await anonymous.json('/api/me');
  check('GET /api/me without a session -> 401', unauthorizedMe.response.status === 401, `status ${unauthorizedMe.response.status}`);

  section('Registration and user flow');
  const registration = await post(user, '/api/register', {
    siteName: TEST_SITE,
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  check('POST /api/register -> 201', registration.response.status === 201, `status ${registration.response.status}`);
  check('registration returns ok', registration.body?.ok === true);
  check('registration returns a license key', /^cr_/.test(registration.body?.licenseKey || ''));
  check('registration sets a session cookie', user.cookies.has('crunchy_session'));

  const licenseKey = registration.body?.licenseKey || '';
  console.log(`license:    ${licenseKey}`);
  console.log(`cleanup:    TEST_EMAIL=${TEST_EMAIL} TEST_LICENSE=${licenseKey}`);

  const me = await user.json('/api/me');
  check('GET /api/me with session -> 200', me.response.status === 200, `status ${me.response.status}`);
  check('session belongs to the test account', me.body?.user?.email === TEST_EMAIL);

  const usage = await post(anonymous, '/api/usage', {
    licenseKey,
    visitorId: VISITOR_ID,
  });
  check('POST /api/usage -> 200', usage.response.status === 200, `status ${usage.response.status}`);
  check('usage is allowed', usage.body?.allowed === true);
  check('usage counts one visitor', usage.body?.used === 1);
  check('usage limit is 10000', usage.body?.limit === 10000);

  const licenseInfo = await post(anonymous, '/api/license/info', { licenseKey });
  check('POST /api/license/info -> 200', licenseInfo.response.status === 200, `status ${licenseInfo.response.status}`);
  check('license info is free and allowed', licenseInfo.body?.plan === 'free' && licenseInfo.body?.allowed === true);

  const limitRequest = await user.json('/api/limit-request', {
    method: 'POST',
    body: JSON.stringify({ requestedLimit: 20000, message: `QA ${RUN}` }),
  });
  check('POST /api/limit-request -> 201', limitRequest.response.status === 201, `status ${limitRequest.response.status}`);
  const limitRequestId = limitRequest.body?.request?.id || '';

  const support = await post(anonymous, '/api/support', {
    name: 'QA',
    email: TEST_EMAIL,
    site: TEST_SITE,
    message: `Public QA support message for run ${RUN}`,
  });
  check('POST /api/support -> 201', support.response.status === 201, `status ${support.response.status}`);

  const logout = await post(user, '/api/logout', {});
  check('POST /api/logout -> 200', logout.response.status === 200, `status ${logout.response.status}`);
  check('logout clears the session cookie', !user.cookies.has('crunchy_session'));

  const login = await post(user, '/api/login', { email: TEST_EMAIL, password: TEST_PASSWORD });
  check('POST /api/login -> 200', login.response.status === 200, `status ${login.response.status}`);
  check('login returns the test account', login.body?.user?.email === TEST_EMAIL);

  if (!ADMIN_PASSWORD) {
    console.log('\nadmin checks skipped (set QA_ADMIN_PASSWORD to run them)');
  } else {
    section('Admin authentication');
    const legacy = await post(admin, '/api/admin/login', { username: 'admin', password: ADMIN_PASSWORD });
    check('legacy username "admin" -> 401', legacy.response.status === 401, `status ${legacy.response.status}`);

    const wrongEmail = await post(admin, '/api/admin/login', {
      email: 'admin@example.com',
      password: ADMIN_PASSWORD,
    });
    check('unknown admin e-mail -> 401', wrongEmail.response.status === 401, `status ${wrongEmail.response.status}`);

    const adminLogin = await post(admin, '/api/admin/login', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    check('admin login with e-mail -> 200', adminLogin.response.status === 200, `status ${adminLogin.response.status}`);
    check('admin session is set', admin.cookies.has('crunchy_session'));

    const overview = await admin.json('/api/admin/overview');
    check('GET /api/admin/overview -> 200', overview.response.status === 200, `status ${overview.response.status}`);
    check('overview has users', Array.isArray(overview.body?.users));
    check('overview has logs', Array.isArray(overview.body?.logs) && overview.body.logs.length > 0);
    const testUser = overview.body?.users?.find((item) => item.email === TEST_EMAIL);
    check('overview contains the test account', Boolean(testUser));

    if (testUser) {
      const block = await admin.json(`/api/admin/users/${encodeURIComponent(testUser.id)}/block`, {
        method: 'POST',
        body: JSON.stringify({ blocked: true }),
      });
      check('POST /api/admin/users/:id/block -> 200', block.response.status === 200, `status ${block.response.status}`);
      check('test account is blocked', block.body?.user?.blocked === true);

      const blockedUsage = await post(anonymous, '/api/usage', {
        licenseKey,
        visitorId: `${VISITOR_ID}-blocked`,
      });
      check('blocked license usage -> 403', blockedUsage.response.status === 403, `status ${blockedUsage.response.status}`);
      check('blocked license code', blockedUsage.body?.error === 'license_blocked');

      const unblock = await admin.json(`/api/admin/users/${encodeURIComponent(testUser.id)}/block`, {
        method: 'POST',
        body: JSON.stringify({ blocked: false }),
      });
      check('POST /api/admin/users/:id/block (false) -> 200', unblock.response.status === 200, `status ${unblock.response.status}`);

      const unblockedUsage = await post(anonymous, '/api/usage', {
        licenseKey,
        visitorId: `${VISITOR_ID}-unblocked`,
      });
      check('unblocked license usage -> 200', unblockedUsage.response.status === 200, `status ${unblockedUsage.response.status}`);
    }

    if (limitRequestId) {
      const resolved = await admin.json(`/api/admin/requests/${encodeURIComponent(limitRequestId)}`, {
        method: 'POST',
        body: JSON.stringify({ status: 'rejected' }),
      });
      check('POST /api/admin/requests/:id -> 200', resolved.response.status === 200, `status ${resolved.response.status}`);
    }

    const logs = await admin.json('/api/admin/logs?limit=10');
    check('GET /api/admin/logs -> 200', logs.response.status === 200, `status ${logs.response.status}`);
    check('logs response contains entries', Array.isArray(logs.body?.logs) && logs.body.logs.length > 0);

    const adminLogout = await post(admin, '/api/admin/logout', {});
    check('POST /api/admin/logout -> 200', adminLogout.response.status === 200, `status ${adminLogout.response.status}`);
    const afterLogout = await admin.json('/api/admin/overview');
    check('admin overview after logout -> 401', afterLogout.response.status === 401, `status ${afterLogout.response.status}`);
  }

  section('Result');
  const total = passed + failed;
  console.log(`passed: ${passed}/${total}`);
  if (failed) {
    console.log(`failed: ${failed}`);
    for (const failure of failures) console.log(` - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('all public checks passed');
  }
}

main().catch((error) => {
  console.error('\nQA crashed:', error);
  process.exitCode = 2;
});
