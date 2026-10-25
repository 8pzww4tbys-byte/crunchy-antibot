(function () {
  'use strict';

  const $ = (selector, scope) => (scope || document).querySelector(selector);
  const $$ = (selector, scope) => Array.from((scope || document).querySelectorAll(selector));
  const TYPES = ['slider', 'grid', 'text'];

  const REASONS = {
    offset: 'позиция',
    selection: 'выбор фото',
    text: 'код'
  };

  /* Live demo ------------------------------------------------------------- */

  const mount = $('#captcha-mount');
  const tabs = $$('.tab');
  const logList = $('#log-list');
  const tokenEl = $('#last-token');
  let captcha = null;
  let currentType = null;

  function timeLabel() {
    const now = new Date();
    return [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map((value) => String(value).padStart(2, '0'))
      .join(':');
  }

  function addLog(text, tone) {
    if (!logList) return;
    const empty = $('.log-empty', logList);
    if (empty) empty.remove();

    const item = document.createElement('li');
    item.className = 'log-item' + (tone ? ' is-' + tone : '');

    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = timeLabel();

    const message = document.createElement('span');
    message.className = 'log-text';
    message.textContent = text;

    item.appendChild(time);
    item.appendChild(message);
    logList.prepend(item);

    while (logList.children.length > 12) {
      logList.lastElementChild.remove();
    }
  }

  function makeCaptcha(type) {
    if (captcha) {
      captcha.destroy();
      captcha = null;
    }
    if (!mount) return;
    mount.innerHTML = '';
    if (tokenEl) tokenEl.textContent = '—';

    captcha = new window.CrunchyAntibot({
      el: mount,
      type: type,
      assetsPath: 'assets/',
      onReady: function (info) {
        addLog('готово · ' + info.version, 'info');
      },
      onRefresh: function (info) {
        addLog('новая проверка · ' + info.version, 'info');
      },
      onFail: function (info) {
        addLog('не совпало (' + (REASONS[info.reason] || info.reason) + ') · попытка ' + info.attempts, 'fail');
      },
      onSuccess: function (token, info) {
        if (tokenEl) tokenEl.textContent = token;
        addLog('успех · ' + info.version + ' · ' + token, 'success');
      }
    });
  }

  function selectTab(type, shouldScroll) {
    if (TYPES.indexOf(type) < 0) type = 'slider';
    const changed = currentType !== type;
    currentType = type;

    tabs.forEach((tab) => {
      const active = tab.dataset.type === type;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
    });

    if (changed || !captcha) {
      makeCaptcha(type);
    }

    if (shouldScroll) {
      const section = $('#demo');
      if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  tabs.forEach((tab, index) => {
    tab.tabIndex = tab.classList.contains('is-active') ? 0 : -1;

    tab.addEventListener('click', function () {
      selectTab(tab.dataset.type, false);
    });

    tab.addEventListener('keydown', function (event) {
      let next = -1;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next < 0) return;

      event.preventDefault();
      selectTab(tabs[next].dataset.type, false);
      tabs[next].focus();
    });
  });

  $$('[data-jump]').forEach((card) => {
    card.addEventListener('click', function (event) {
      event.preventDefault();
      selectTab(card.dataset.jump, true);
    });
  });

  const resetDemo = $('#reset-demo');
  if (resetDemo) {
    resetDemo.addEventListener('click', function () {
      if (!captcha) return;
      captcha.reset();
      if (tokenEl) tokenEl.textContent = '—';
      addLog('задание сброшено', 'info');
    });
  }

  /* Suspicion guard configurator ----------------------------------------- */

  const cfgType = $('#cfg-type');
  const cfgRate = $('#cfg-rate');
  const cfgRateConfig = $('#cfg-rate-config');
  const cfgRateCount = $('#cfg-rate-count');
  const cfgRateWindow = $('#cfg-rate-window');
  const cfgRateValue = $('#cfg-rate-value');
  const cfgRateLimit = $('#cfg-rate-limit');
  const cfgAuto = $('#cfg-auto');
  const cfgBotState = $('#cfg-bot-state');
  const cfgFail = $('#cfg-fail');
  const cfgFailConfig = $('#cfg-fail-config');
  const cfgFailCount = $('#cfg-fail-count');
  const cfgFailValue = $('#cfg-fail-value');
  const cfgFailLimit = $('#cfg-fail-limit');
  const cfgHint = $('#cfg-hint');
  const cfgForm = $('#cfg-form');
  const cfgSubmit = $('#cfg-submit');
  const cfgSlot = $('#cfg-slot');
  const cfgState = $('#cfg-state');
  const cfgCode = $('#cfg-code');
  const cfgRestart = $('#cfg-restart');
  const cfgBurst = $('#cfg-burst');
  const cfgFailure = $('#cfg-failure');
  const cfgBot = $('#cfg-bot');
  const cfgReset = $('#cfg-reset');

  let cfgCaptcha = null;
  let cfgSolved = false;
  let cfgTriggered = false;
  let cfgFailures = 0;
  let cfgEvents = [];
  let cfgBotSeen = false;
  let cfgReason = '';
  let cfgRevision = 0;

  function readNumber(input, fallback, min, max) {
    const parsed = parseInt(input.value, 10);
    const value = Number.isFinite(parsed) ? parsed : fallback;
    return Math.min(max, Math.max(min, value));
  }

  function rateLimit() {
    return readNumber(cfgRateCount, 20, 3, 500);
  }

  function windowSeconds() {
    return readNumber(cfgRateWindow, 10, 1, 120);
  }

  function failLimit() {
    return readNumber(cfgFailCount, 3, 1, 20);
  }

  function recentEvents() {
    const cutoff = Date.now() - windowSeconds() * 1000;
    cfgEvents = cfgEvents.filter((time) => time >= cutoff);
    return cfgEvents;
  }

  function setCfgState(text, tone) {
    if (!cfgState) return;
    cfgState.textContent = text || '';
    cfgState.className = 'preview-status' + (tone ? ' is-' + tone : '');
  }

  function updateGuardStats() {
    const recent = recentEvents();
    const rate = rateLimit();
    const fails = failLimit();
    const stopped = cfgTriggered || cfgSolved;

    if (cfgRateValue) cfgRateValue.textContent = String(recent.length);
    if (cfgRateLimit) cfgRateLimit.textContent = String(rate);
    if (cfgFailValue) cfgFailValue.textContent = String(cfgFailures);
    if (cfgFailLimit) cfgFailLimit.textContent = String(fails);
    if (cfgBotState) {
      cfgBotState.textContent = 'автоматизация: ' + (cfgBotSeen ? 'да' : 'нет');
      cfgBotState.classList.toggle('is-bot', cfgBotSeen && cfgAuto.checked);
    }
    if (cfgRateValue) cfgRateValue.classList.toggle('is-hot', cfgRate.checked && recent.length >= rate);
    if (cfgFailValue) cfgFailValue.classList.toggle('is-hot', cfgFail.checked && cfgFailures >= fails);

    if (cfgRateConfig) cfgRateConfig.classList.toggle('is-disabled', !cfgRate.checked);
    if (cfgFailConfig) cfgFailConfig.classList.toggle('is-disabled', !cfgFail.checked);
    if (cfgRateCount) cfgRateCount.disabled = !cfgRate.checked || stopped;
    if (cfgRateWindow) cfgRateWindow.disabled = !cfgRate.checked || stopped;
    if (cfgFailCount) cfgFailCount.disabled = !cfgFail.checked || stopped;
    if (cfgBurst) cfgBurst.disabled = !cfgRate.checked || stopped;
    if (cfgFailure) cfgFailure.disabled = !cfgFail.checked || stopped;
    if (cfgBot) cfgBot.disabled = !cfgAuto.checked || stopped;
  }

  function updateCfgHint() {
    if (!cfgHint) return;
    const parts = [];
    if (cfgRate.checked) {
      parts.push(rateLimit() + ' событий за ' + windowSeconds() + ' с');
    }
    if (cfgAuto.checked) {
      parts.push('признаки автоматизации');
    }
    if (cfgFail.checked) {
      parts.push(failLimit() + ' неудачных действий подряд');
    }
    cfgHint.textContent = parts.length
      ? 'Капча появится при: ' + parts.join(' · ') + '. Сигналы работают по «или».'
      : 'Все сигналы выключены — капча не появится.';
  }

  function setObservingState() {
    if (cfgTriggered || cfgSolved) return;
    const recent = recentEvents().length;
    if (!cfgRate.checked && !cfgAuto.checked && !cfgFail.checked) {
      setCfgState('Все сигналы выключены — капча не появится.');
      return;
    }

    const bits = [];
    if (cfgRate.checked) bits.push(recent + ' событий');
    if (cfgFail.checked) bits.push(cfgFailures + ' ошибок');
    if (cfgAuto.checked) {
      bits.push(cfgBotSeen ? 'автоматизация обнаружена' : 'автоматизация не обнаружена');
    }
    setCfgState('Наблюдение: ' + bits.join(' · ') + '.');
  }

  function detectSuspicion() {
    const recent = recentEvents();
    if (cfgRate.checked && recent.length >= rateLimit()) {
      return {
        type: 'rate',
        text: 'Подозрительная активность: ' + recent.length + ' событий за ' + windowSeconds() + ' с.'
      };
    }
    if (cfgFail.checked && cfgFailures >= failLimit()) {
      return {
        type: 'failures',
        text: 'Много неудачных действий: ' + cfgFailures + ' подряд.'
      };
    }
    if (cfgAuto.checked && cfgBotSeen) {
      return {
        type: 'automation',
        text: 'Обнаружены признаки автоматизации.'
      };
    }
    return null;
  }

  function ensureCfgCaptcha(revision) {
    if (cfgCaptcha) return cfgCaptcha;
    if (!cfgSlot) return null;

    cfgSlot.hidden = false;
    const host = document.createElement('div');
    host.className = 'cfg-captcha-host';
    cfgSlot.appendChild(host);
    const type = TYPES.indexOf(cfgType.value) >= 0 ? cfgType.value : 'slider';

    cfgCaptcha = new window.CrunchyAntibot({
      el: host,
      type: type,
      assetsPath: 'assets/',
      onReady: function () {
        if (revision !== cfgRevision) return;
        if (!cfgSolved) {
          setCfgState(cfgReason ? cfgReason + ' Пройдите проверку.' : 'Пройдите проверку.');
        }
      },
      onFail: function () {
        if (revision !== cfgRevision) return;
        cfgFailures += 1;
        updateGuardStats();
        setCfgState('Не совпало — попробуйте ещё раз.', 'error');
      },
      onSuccess: function (token) {
        if (revision !== cfgRevision) return;
        cfgSolved = true;
        cfgSubmit.disabled = false;
        cfgEvents = [];
        cfgFailures = 0;
        cfgBotSeen = false;
        updateGuardStats();
        setCfgState('Проверка пройдена. Токен: ' + token, 'ok');
      }
    });

    return cfgCaptcha;
  }

  function triggerGuard(reason) {
    if (cfgSolved || cfgTriggered) return;
    cfgTriggered = true;
    cfgReason = reason.text;
    cfgSubmit.disabled = true;
    updateGuardStats();
    setCfgState(reason.text + ' Включена проверка.');
    ensureCfgCaptcha(cfgRevision);
  }

  function evaluateGuard() {
    updateGuardStats();
    if (cfgSolved || cfgTriggered) return;
    const reason = detectSuspicion();
    if (reason) {
      triggerGuard(reason);
    } else {
      setObservingState();
    }
  }

  function resetGuard() {
    cfgRevision += 1;
    if (cfgCaptcha) {
      cfgCaptcha.destroy();
      cfgCaptcha = null;
    }
    if (cfgSlot) {
      cfgSlot.innerHTML = '';
      cfgSlot.hidden = true;
    }
    cfgSolved = false;
    cfgTriggered = false;
    cfgReason = '';
    cfgFailures = 0;
    cfgEvents = [];
    cfgBotSeen = false;
    if (cfgSubmit) {
      cfgSubmit.disabled = false;
      cfgSubmit.textContent = 'Отправить';
    }
    if (cfgRateCount) cfgRateCount.value = String(rateLimit());
    if (cfgRateWindow) cfgRateWindow.value = String(windowSeconds());
    if (cfgFailCount) cfgFailCount.value = String(failLimit());
    updateGuardStats();
    updateCfgHint();
    setObservingState();
  }

  function renderCfgCode() {
    if (!cfgCode) return;
    const type = TYPES.indexOf(cfgType.value) >= 0 ? cfgType.value : 'slider';
    const rateEnabled = cfgRate.checked;
    const failEnabled = cfgFail.checked;
    const autoEnabled = cfgAuto.checked;
    const rate = rateLimit();
    const seconds = windowSeconds();
    const fails = failLimit();

    const lines = [
      '// Client-side heuristic only. Real DDoS protection belongs on the server/CDN.',
      '// container: <div id="captcha" hidden></div>',
      "const slot = document.querySelector('#captcha');",
      'let captcha = null;'
    ];
    if (rateEnabled) lines.push('let events = [];');
    if (failEnabled) lines.push('let failures = 0;');

    lines.push('');
    lines.push('function showCaptcha(reason) {');
    lines.push('  slot.hidden = false;');
    lines.push('  if (captcha) return;');
    lines.push('  captcha = new CrunchyAntibot({');
    lines.push('    el: slot,');
    lines.push("    type: '" + type + "',");
    lines.push('    onSuccess: function (token) {');
    lines.push('      // verify the token on your backend');
    lines.push('    }');
    lines.push('  });');
    lines.push("  console.log('captcha triggered:', reason);");
    lines.push('}');

    if (rateEnabled) {
      lines.push('');
      lines.push('function noteActivity() {');
      lines.push('  const now = Date.now();');
      lines.push('  events = events.filter(function (time) {');
      lines.push('    return now - time < ' + seconds * 1000 + ';');
      lines.push('  });');
      lines.push('  events.push(now);');
      lines.push('  if (events.length >= ' + rate + ') showCaptcha("rate");');
      lines.push('}');
      lines.push('');
      lines.push('window.fetch = (function (original) {');
      lines.push('  return function () {');
      lines.push('    noteActivity();');
      lines.push('    return original.apply(this, arguments);');
      lines.push('  };');
      lines.push('})(window.fetch);');
      lines.push("document.addEventListener('click', noteActivity, { passive: true });");
    }

    if (autoEnabled) {
      lines.push('');
      lines.push('if (navigator.webdriver || /HeadlessChrome|bot|crawler/i.test(navigator.userAgent)) {');
      lines.push('  showCaptcha("automation");');
      lines.push('}');
    }

    if (failEnabled) {
      lines.push('');
      lines.push('function noteFailure() {');
      lines.push('  failures += 1;');
      lines.push('  if (failures >= ' + fails + ') showCaptcha("failures");');
      lines.push('}');
      lines.push('// call noteFailure() when the backend rejects a protected action');
    }

    if (!rateEnabled && !autoEnabled && !failEnabled) {
      lines.push('');
      lines.push('// no signals enabled — showCaptcha() is never called automatically');
    }

    lines.push('');
    lines.push("const form = document.querySelector('#protected-form');");
    lines.push("form.addEventListener('submit', function (event) {");
    lines.push('  if (slot.hidden || (captcha && captcha.solved)) return;');
    lines.push('  event.preventDefault();');
    lines.push('});');

    cfgCode.textContent = lines.join('\n');
  }

  function applyCfg() {
    if (!cfgType) return;
    resetGuard();
    renderCfgCode();
  }

  if (cfgType) {
    cfgType.addEventListener('change', applyCfg);
    [cfgRate, cfgAuto, cfgFail].forEach((input) => {
      if (input) input.addEventListener('change', applyCfg);
    });
    [cfgRateCount, cfgRateWindow, cfgFailCount].forEach((input) => {
      if (!input) return;
      input.addEventListener('change', function () {
        const min = Number(input.min || 1);
        const max = Number(input.max || 100);
        const value = readNumber(input, min, min, max);
        input.value = String(value);
        applyCfg();
      });
    });

    [cfgRestart, cfgReset].forEach((button) => {
      if (button) button.addEventListener('click', applyCfg);
    });

    if (cfgBurst) {
      cfgBurst.addEventListener('click', function () {
        if (!cfgRate.checked) return;
        const now = Date.now();
        for (let i = 0; i < 10; i += 1) cfgEvents.push(now);
        evaluateGuard();
      });
    }

    if (cfgFailure) {
      cfgFailure.addEventListener('click', function () {
        if (!cfgFail.checked) return;
        cfgFailures += 1;
        evaluateGuard();
      });
    }

    if (cfgBot) {
      cfgBot.addEventListener('click', function () {
        if (!cfgAuto.checked) return;
        cfgBotSeen = true;
        evaluateGuard();
      });
    }

    if (cfgForm) {
      cfgForm.addEventListener('submit', function (event) {
        event.preventDefault();
        if (cfgTriggered && !cfgSolved) {
          setCfgState('Сначала пройдите проверку.', 'error');
          return;
        }
        setCfgState(
          cfgSolved
            ? 'Действие выполнено после проверки (демо).'
            : 'Действие выполнено без проверки — подозрений нет (демо).',
          'ok'
        );
      });
    }

    window.setInterval(function () {
      if (cfgTriggered || cfgSolved) {
        updateGuardStats();
        return;
      }
      approachGuard();
    }, 1000);

    applyCfg();
  }

  function approachGuard() {
    updateGuardStats();
    const reason = detectSuspicion();
    if (reason) {
      triggerGuard(reason);
    } else {
      setObservingState();
    }
  }

  /* Clipboard ------------------------------------------------------------- */

  function fallbackCopy(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {
      ok = false;
    }
    area.remove();
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return fallbackCopy(text); }
      );
    }
    return Promise.resolve(fallbackCopy(text));
  }

  document.addEventListener('click', function (event) {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const source = document.getElementById(button.dataset.copy);
    if (!source) return;

    const original = button.textContent;
    copyText(source.textContent.trim()).then(function (ok) {
      button.textContent = ok ? 'Скопировано' : 'Не вышло';
      button.classList.toggle('is-copied', ok);
      window.setTimeout(function () {
        button.textContent = original;
        button.classList.remove('is-copied');
      }, 1600);
    });
  });

  /* Initial state --------------------------------------------------------- */

  selectTab('slider', false);
})();
