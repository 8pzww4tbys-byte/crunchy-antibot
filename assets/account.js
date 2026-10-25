(function () {
  'use strict';

  var PRODUCTION_ORIGIN = 'https://2-26-84-26.sslip.io';

  // GitHub Pages serves only static files. Auth needs the Node backend,
  // so account pages always continue on the production origin.
  if (/\.github\.io$/i.test(location.hostname)) {
    var projectPath = location.pathname.replace(/^\/crunchy-antibot(?=\/|$)/, '') || '/';
    location.replace(PRODUCTION_ORIGIN + projectPath + location.search + location.hash);
    return;
  }

  var API_BASE = String(window.CRUNCHY_API_BASE || '').replace(/\/+$/, '');
  if (!API_BASE && /^(127\.0\.0\.1|localhost)$/i.test(location.hostname) && location.port !== '8787') {
    API_BASE = location.protocol + '//' + location.hostname + ':8787';
  }

  var $ = function (selector, scope) {
    return (scope || document).querySelector(selector);
  };

  function number(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatNumber(value) {
    return number(value).toLocaleString('ru-RU');
  }

  function dateLabel(value) {
    if (!value) return '—';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function setStatus(element, message, tone) {
    if (!element) return;
    element.textContent = message || '';
    element.className = 'form-status' + (tone ? ' is-' + tone : '');
  }

  async function api(path, options) {
    var request = options || {};
    var response;
    try {
      response = await fetch(API_BASE + path, {
        method: request.method || 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: Object.assign(
          { Accept: 'application/json' },
          request.body ? { 'Content-Type': 'application/json' } : {}
        ),
        body: request.body ? JSON.stringify(request.body) : undefined
      });
    } catch (error) {
      var network = new Error('Не удалось связаться с сервером. Проверьте соединение.');
      network.cause = error;
      throw network;
    }

    var data = null;
    try {
      data = await response.json();
    } catch (_) {
      data = null;
    }
    if (!response.ok) {
      var failure = new Error((data && data.message) || 'Ошибка запроса');
      failure.status = response.status;
      failure.code = data && data.error;
      failure.data = data;
      throw failure;
    }
    return data || {};
  }

  function busy(form, value) {
    if (!form) return;
    var button = form.querySelector('button[type="submit"]');
    if (!button) return;
    if (value) {
      button.dataset.label = button.textContent;
      button.textContent = 'Подождите…';
      button.disabled = true;
    } else {
      button.textContent = button.dataset.label || button.textContent;
      button.disabled = false;
    }
  }

  function fieldValue(selector) {
    var input = $(selector);
    return input ? String(input.value || '').trim() : '';
  }

  function copyText(value) {
    if (!value) return Promise.reject(new Error('empty'));
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(value);
    }
    return new Promise(function (resolve, reject) {
      var input = document.createElement('textarea');
      input.value = value;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      try {
        document.execCommand('copy');
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        input.remove();
      }
    });
  }

  function bindCopyButtons() {
    document.addEventListener('click', function (event) {
      var button = event.target.closest('[data-copy-value]');
      if (!button) return;
      var target = document.getElementById(button.getAttribute('data-copy-value'));
      if (!target) return;
      copyText(target.textContent).then(function () {
        var previous = button.textContent;
        button.textContent = 'Скопировано';
        setTimeout(function () {
          button.textContent = previous;
        }, 1400);
      }).catch(function () {
        button.textContent = 'Не удалось';
      });
    });
  }

  function bindLogout() {
    document.querySelectorAll('[data-logout]').forEach(function (button) {
      button.addEventListener('click', async function () {
        button.disabled = true;
        try {
          await api('/api/logout', { method: 'POST', body: {} });
        } catch (_) {
          // The cookie is cleared client-side by the redirect anyway.
        }
        location.href = 'index.html';
      });
    });
  }

  /* Registration ---------------------------------------------------------- */

  function initRegister() {
    var form = $('#register-form');
    var status = $('#register-status');
    if (!form) return;

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (fieldValue('#reg-password') !== fieldValue('#reg-password-confirm')) {
        setStatus(status, 'Пароли не совпадают', 'error');
        return;
      }
      setStatus(status, '');
      busy(form, true);
      try {
        await api('/api/register', {
          method: 'POST',
          body: {
            siteName: fieldValue('#reg-site'),
            email: fieldValue('#reg-email'),
            password: fieldValue('#reg-password')
          }
        });
        setStatus(status, 'Аккаунт создан. Открываем кабинет…', 'success');
        location.href = 'dashboard.html';
      } catch (error) {
        setStatus(status, error.message, 'error');
        busy(form, false);
      }
    });
  }

  /* Login ----------------------------------------------------------------- */

  function initLogin() {
    var form = $('#login-form');
    var status = $('#login-status');
    if (!form) return;

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      setStatus(status, '');
      busy(form, true);
      try {
        await api('/api/login', {
          method: 'POST',
          body: {
            email: fieldValue('#login-email'),
            password: fieldValue('#login-password')
          }
        });
        location.href = 'dashboard.html';
      } catch (error) {
        setStatus(status, error.message, 'error');
        busy(form, false);
      }
    });
  }

  /* Dashboard ------------------------------------------------------------- */

  function renderRequests(requests) {
    var box = $('#request-history');
    if (!box) return;
    box.textContent = '';
    var items = Array.isArray(requests) ? requests : [];
    if (!items.length) {
      var empty = document.createElement('p');
      empty.className = 'request-note';
      empty.textContent = 'Запросов на увеличение лимита пока нет.';
      box.appendChild(empty);
      return;
    }

    items.forEach(function (request) {
      var row = document.createElement('div');
      row.className = 'request-item';
      var text = document.createElement('span');
      var state = request.status === 'approved'
        ? 'одобрен'
        : request.status === 'rejected'
          ? 'отклонён'
          : 'ожидает ответа';
      text.textContent = formatNumber(request.requestedLimit) + ' юзеров · ' + dateLabel(request.createdAt);
      var badge = document.createElement('span');
      badge.className = 'badge' + (request.status === 'approved' ? ' is-ok' : request.status === 'rejected' ? ' is-off' : '');
      badge.textContent = state;
      row.appendChild(text);
      row.appendChild(badge);
      box.appendChild(row);
    });
  }

  function renderDashboard(data) {
    var user = data.user;
    var usage = user.usage || {};
    var limit = number(usage.limit || user.limit);
    var used = number(usage.used);
    var remaining = number(usage.remaining);

    var site = $('#dash-site');
    if (site) site.textContent = user.siteName;
    var email = $('#dash-email');
    if (email) email.textContent = user.email;
    var key = $('#dash-key');
    if (key) key.textContent = user.licenseKey;
    var limitText = $('#dash-limit');
    if (limitText) limitText.textContent = formatNumber(limit) + ' / месяц';
    var usedText = $('#dash-used');
    if (usedText) usedText.textContent = formatNumber(used);
    var remainingText = $('#dash-remaining');
    if (remainingText) remainingText.textContent = formatNumber(remaining) + ' осталось';
    var monthText = $('#dash-month');
    if (monthText) monthText.textContent = usage.month || '—';
    var resetText = $('#dash-reset');
    if (resetText) resetText.textContent = dateLabel(usage.resetAt);
    var created = $('#dash-created');
    if (created) created.textContent = dateLabel(user.createdAt);

    var percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
    var bar = $('#usage-bar');
    if (bar) {
      bar.style.width = percent.toFixed(1) + '%';
      bar.parentElement.classList.toggle('is-high', percent >= 90);
    }

    var requestLimit = $('#request-limit');
    if (requestLimit) requestLimit.placeholder = String(Math.max(10001, limit * 2));
    var current = $('#request-current');
    if (current) current.textContent = formatNumber(limit);

    renderRequests(data.requests);
  }

  async function loadDashboard() {
    var data;
    try {
      data = await api('/api/me');
    } catch (error) {
      if (error.status === 401) {
        location.replace('login.html');
        return;
      }
      var dashboardStatus = $('#dashboard-status');
      setStatus(dashboardStatus, error.message, 'error');
      return;
    }
    renderDashboard(data);
  }

  function initDashboard() {
    if (!$('#dashboard-page')) return;
    bindLogout();
    loadDashboard();

    var refresh = $('#dash-refresh');
    if (refresh) {
      refresh.addEventListener('click', function () {
        refresh.disabled = true;
        loadDashboard().finally(function () {
          refresh.disabled = false;
        });
      });
    }

    var form = $('#request-form');
    var status = $('#request-status');
    if (form) {
      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        var requested = number(fieldValue('#request-limit'));
        if (!Number.isInteger(requested) || requested < 1) {
          setStatus(status, 'Укажите целое число юзеров', 'error');
          return;
        }
        setStatus(status, '');
        busy(form, true);
        try {
          await api('/api/limit-request', {
            method: 'POST',
            body: {
              requestedLimit: requested,
              message: fieldValue('#request-message')
            }
          });
          setStatus(status, 'Запрос отправлен администратору.', 'success');
          form.reset();
          await loadDashboard();
        } catch (error) {
          setStatus(status, error.message, 'error');
        } finally {
          busy(form, false);
        }
      });
    }
  }

  /* Admin ----------------------------------------------------------------- */

  var LOG_LABELS = {
    register: 'регистрация',
    login: 'вход',
    logout: 'выход',
    login_failed: 'ошибка входа',
    login_blocked: 'вход заблокирован',
    limit_request: 'запрос лимита',
    support_request: 'поддержка',
    quota_exceeded: 'лимит исчерпан',
    admin_login: 'вход админа',
    admin_login_failed: 'ошибка входа админа',
    admin_logout: 'выход админа',
    admin_limit_changed: 'лимит изменён',
    admin_user_blocked: 'юзер заблокирован',
    admin_user_unblocked: 'юзер разблокирован',
    admin_limit_request_resolved: 'запрос обработан'
  };

  function metaLabel(entry) {
    var meta = entry.meta || {};
    if (entry.type === 'support_request') {
      return [meta.name, meta.message].filter(Boolean).join(': ');
    }
    if (entry.type === 'limit_request') {
      return 'нужно ' + formatNumber(meta.requestedLimit) + ' (сейчас ' + formatNumber(meta.currentLimit) + ')';
    }
    if (entry.type === 'admin_limit_changed') return 'лимит ' + formatNumber(meta.limit);
    if (entry.type === 'admin_limit_request_resolved') return meta.status + (meta.limit ? ' · ' + formatNumber(meta.limit) : '');
    if (entry.type === 'quota_exceeded') return formatNumber(meta.used) + ' / ' + formatNumber(meta.limit);
    if (entry.type === 'register') return meta.siteName || '';
    if (entry.type === 'admin_login_failed') return meta.login || '';
    return '';
  }

  function tableCell(textValue, strong) {
    var cell = document.createElement('td');
    if (strong) {
      var strongEl = document.createElement('strong');
      strongEl.textContent = textValue;
      cell.appendChild(strongEl);
    } else {
      cell.textContent = textValue;
    }
    return cell;
  }

  function actionButton(label, action, id, extra) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'mini-action' + (action === 'block' ? ' is-danger' : '');
    button.textContent = label;
    button.dataset.action = action;
    button.dataset.id = id;
    if (extra) button.dataset.extra = extra;
    return button;
  }

  function renderUsers(users) {
    var body = $('#admin-users');
    if (!body) return;
    body.textContent = '';
    if (!users.length) {
      var emptyRow = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.colSpan = 8;
      emptyCell.className = 'empty-state';
      emptyCell.textContent = 'Пользователей пока нет.';
      emptyRow.appendChild(emptyCell);
      body.appendChild(emptyRow);
      return;
    }

    users.forEach(function (user) {
      var row = document.createElement('tr');
      row.appendChild(tableCell(user.email, true));
      row.appendChild(tableCell(user.siteName));
      var keyCell = document.createElement('td');
      var key = document.createElement('code');
      key.textContent = user.licenseKey;
      keyCell.appendChild(key);
      row.appendChild(keyCell);
      row.appendChild(tableCell(formatNumber(user.limit)));
      row.appendChild(tableCell(formatNumber(user.usage ? user.usage.used : 0)));
      row.appendChild(tableCell(dateLabel(user.createdAt)));
      row.appendChild(tableCell(user.blocked ? 'заблокирован' : 'активен'));

      var actions = document.createElement('td');
      var wrap = document.createElement('div');
      wrap.className = 'table-actions';
      var input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.max = '10000000';
      input.value = String(user.limit);
      input.setAttribute('aria-label', 'Новый лимит для ' + user.email);
      var limitButton = actionButton('Лимит', 'limit', user.id);
      limitButton.dataset.input = 'limit-' + user.id;
      input.id = 'limit-' + user.id;
      var blockButton = actionButton(user.blocked ? 'Разблок' : 'Блок', 'block', user.id);
      blockButton.dataset.blocked = user.blocked ? '0' : '1';
      wrap.appendChild(input);
      wrap.appendChild(limitButton);
      wrap.appendChild(blockButton);
      actions.appendChild(wrap);
      row.appendChild(actions);
      body.appendChild(row);
    });
  }

  function renderRequestsTable(requests) {
    var body = $('#admin-requests');
    if (!body) return;
    body.textContent = '';
    var items = Array.isArray(requests) ? requests : [];
    if (!items.length) {
      var emptyRow = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.colSpan = 6;
      emptyCell.className = 'empty-state';
      emptyCell.textContent = 'Запросов нет.';
      emptyRow.appendChild(emptyCell);
      body.appendChild(emptyRow);
      return;
    }

    items.forEach(function (request) {
      var row = document.createElement('tr');
      row.appendChild(tableCell(request.email, true));
      row.appendChild(tableCell(request.siteName));
      row.appendChild(tableCell(formatNumber(request.currentLimit)));
      row.appendChild(tableCell(formatNumber(request.requestedLimit)));
      row.appendChild(tableCell(request.message || '—'));
      var actions = document.createElement('td');
      var wrap = document.createElement('div');
      wrap.className = 'table-actions';
      var state = document.createElement('span');
      state.className = 'badge' + (request.status === 'approved' ? ' is-ok' : request.status === 'rejected' ? ' is-off' : '');
      state.textContent = request.status === 'pending' ? 'ожидает' : request.status === 'approved' ? 'одобрен' : 'отклонён';
      wrap.appendChild(state);
      if (request.status === 'pending') {
        var approve = actionButton('Одобрить', 'approve', request.id);
        var reject = actionButton('Отклонить', 'reject', request.id);
        reject.classList.add('is-danger');
        wrap.appendChild(approve);
        wrap.appendChild(reject);
      }
      actions.appendChild(wrap);
      row.appendChild(actions);
      body.appendChild(row);
    });
  }

  function renderLogs(logs) {
    var box = $('#admin-logs');
    if (!box) return;
    box.textContent = '';
    var items = Array.isArray(logs) ? logs : [];
    if (!items.length) {
      var empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'Журнал пока пуст.';
      box.appendChild(empty);
      return;
    }

    items.forEach(function (entry) {
      var row = document.createElement('div');
      row.className = 'log-row';
      var time = document.createElement('time');
      time.dateTime = entry.at;
      time.textContent = dateLabel(entry.at);
      var type = document.createElement('span');
      type.className = 'log-type';
      type.textContent = LOG_LABELS[entry.type] || entry.type;
      var who = document.createElement('span');
      who.className = 'log-who';
      var details = metaLabel(entry);
      who.textContent = [entry.email || 'гость', details].filter(Boolean).join(' · ');
      var ip = document.createElement('span');
      ip.className = 'log-ip';
      ip.textContent = entry.ip || '—';
      row.appendChild(time);
      row.appendChild(type);
      row.appendChild(who);
      row.appendChild(ip);
      box.appendChild(row);
    });
  }

  function renderAdmin(data) {
    var stats = data.stats || {};
    var map = {
      'stat-users': stats.users,
      'stat-usage': stats.monthUsage,
      'stat-requests': stats.pendingRequests,
      'stat-blocked': stats.blockedUsers,
      'stat-month': stats.month
    };
    Object.keys(map).forEach(function (id) {
      var element = document.getElementById(id);
      if (element) element.textContent = typeof map[id] === 'number' ? formatNumber(map[id]) : (map[id] || '—');
    });
    renderUsers(data.users || []);
    renderRequestsTable(data.requests || []);
    renderLogs(data.logs || []);
  }

  async function loadAdmin() {
    var login = $('#admin-login');
    var panel = $('#admin-panel');
    var error = $('#admin-load-error');
    try {
      var data = await api('/api/admin/overview');
      if (login) login.hidden = true;
      if (panel) panel.hidden = false;
      if (error) error.textContent = '';
      renderAdmin(data);
    } catch (failure) {
      if (failure.status === 401) {
        if (login) login.hidden = false;
        if (panel) panel.hidden = true;
        return;
      }
      if (login) login.hidden = true;
      if (panel) panel.hidden = true;
      if (error) error.textContent = failure.message;
    }
  }

  function initAdmin() {
    if (!$('#admin-page')) return;
    var loginForm = $('#admin-login-form');
    var loginStatus = $('#admin-login-status');

    if (loginForm) {
      loginForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        setStatus(loginStatus, '');
        busy(loginForm, true);
        try {
          await api('/api/admin/login', {
            method: 'POST',
            body: {
              username: fieldValue('#admin-username'),
              password: fieldValue('#admin-password')
            }
          });
          await loadAdmin();
        } catch (error) {
          setStatus(loginStatus, error.message, 'error');
        } finally {
          busy(loginForm, false);
        }
      });
    }

    var logout = $('#admin-logout');
    if (logout) {
      logout.addEventListener('click', async function () {
        logout.disabled = true;
        try {
          await api('/api/admin/logout', { method: 'POST', body: {} });
        } catch (_) {
          // ignore
        }
        location.reload();
      });
    }

    var refresh = $('#admin-refresh');
    if (refresh) {
      refresh.addEventListener('click', function () {
        refresh.disabled = true;
        loadAdmin().finally(function () {
          refresh.disabled = false;
        });
      });
    }

    var usersBody = $('#admin-users');
    if (usersBody) {
      usersBody.addEventListener('click', async function (event) {
        var button = event.target.closest('button[data-action]');
        if (!button) return;
        var action = button.dataset.action;
        var userId = button.dataset.id;
        button.disabled = true;
        try {
          if (action === 'block') {
            await api('/api/admin/users/' + encodeURIComponent(userId) + '/block', {
              method: 'POST',
              body: { blocked: button.dataset.blocked === '1' }
            });
          } else if (action === 'limit') {
            var input = document.getElementById(button.dataset.input);
            var limit = number(input ? input.value : 0);
            if (!Number.isInteger(limit) || limit < 1 || limit > 10000000) {
              throw new Error('Лимит должен быть от 1 до 10 000 000');
            }
            await api('/api/admin/users/' + encodeURIComponent(userId) + '/limit', {
              method: 'POST',
              body: { limit: limit }
            });
          }
          await loadAdmin();
        } catch (error) {
          alert(error.message);
          button.disabled = false;
        }
      });
    }

    var requestsBody = $('#admin-requests');
    if (requestsBody) {
      requestsBody.addEventListener('click', async function (event) {
        var button = event.target.closest('button[data-action]');
        if (!button) return;
        var action = button.dataset.action;
        if (action !== 'approve' && action !== 'reject') return;
        button.disabled = true;
        try {
          await api('/api/admin/requests/' + encodeURIComponent(button.dataset.id), {
            method: 'POST',
            body: { status: action === 'approve' ? 'approved' : 'rejected' }
          });
          await loadAdmin();
        } catch (error) {
          alert(error.message);
          button.disabled = false;
        }
      });
    }

    loadAdmin();
  }

  /* Support --------------------------------------------------------------- */

  function initSupport() {
    var form = $('#support-form');
    var status = $('#support-status');
    if (!form) return;

    api('/api/me').then(function (data) {
      var email = $('#support-email');
      if (email && !email.value) email.value = data.user.email;
      var name = $('#support-name');
      if (name && !name.value) name.value = data.user.siteName;
    }).catch(function () {
      // Anonymous support is allowed.
    });

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      setStatus(status, '');
      busy(form, true);
      try {
        var data = await api('/api/support', {
          method: 'POST',
          body: {
            name: fieldValue('#support-name'),
            email: fieldValue('#support-email'),
            site: fieldValue('#support-site'),
            message: fieldValue('#support-message')
          }
        });
        setStatus(status, data.message || 'Сообщение отправлено.', 'success');
        form.reset();
      } catch (error) {
        setStatus(status, error.message, 'error');
      } finally {
        busy(form, false);
      }
    });
  }

  function init() {
    bindCopyButtons();
    var page = document.body.getAttribute('data-page');
    if (page === 'register') initRegister();
    if (page === 'login') initLogin();
    if (page === 'dashboard') initDashboard();
    if (page === 'admin') initAdmin();
    if (page === 'support') initSupport();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
