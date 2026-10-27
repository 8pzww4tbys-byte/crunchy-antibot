/*!
 * crunchy antibot 0.6.0
 * Client-side captcha with three variants: photo fragment, photo selection, text code.
 * No dependencies. MIT.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CrunchyAntibot = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '0.6.0';
  const TYPES = ['slider', 'grid', 'text'];
  const TYPE_VERSIONS = { slider: 'v0.2', grid: 'v1.0', text: 'v2.0' };
  const DEFAULT_SUPPORT_URL = 'https://github.com/8pzww4tbys-byte/crunchy-antibot/issues';
  const SCRIPT_BASE = (function () {
    try {
      const script = document.currentScript;
      if (script && script.src) return script.src.replace(/[^/]*$/, '');
    } catch (err) { /* noop */ }
    return 'assets/';
  })();

  const TEXT = {
    ru: {
      prompt: {
        slider: 'Вставьте фрагмент фото в вырез',
        grid: 'Выберите все фото с печеньем',
        text: 'Введите код с картинки'
      },
      status: {
        readySlider: 'Перетащите ползунок вправо',
        readyGrid: 'Отметьте все фото с печеньем',
        readyText: 'Введите от 4 до 7 символов',
        dragging: 'Отпустите ползунок, чтобы проверить',
        selected: function (n) {
          return n === 0 ? 'Отметьте все фото с печеньем' : 'Выбрано: ' + n;
        },
        fail: 'Не совпало — новая попытка',
        success: 'Проверка пройдена',
        verify: 'Проверить',
        refresh: 'Новое задание',
        emptyCode: 'Сначала введите код',
        quotaExceeded: 'Лимит проверок исчерпан. Попробуйте позже.',
        licenseExpired: 'Ключ доступа недействителен.',
        licenseInvalid: 'Ключ не найден. Проверьте licenseKey.',
        quotaCheckError: 'Не удалось проверить лимит.',
        support: 'Не работает капча?',
        loading: 'Загружаем фото…',
        overlayTitle: 'Готово',
        overlayText: 'Проверка пройдена',
        handle: 'Ползунок капчи',
        dragHint: 'перетащите',
        enterToCheck: 'Enter — проверить',
        codeInput: 'Код с картинки',
        codePlaceholder: 'Код с картинки',
        cell: function (index, name) {
          return 'Фото ' + index + ': ' + name;
        },
        option: 'Вариант'
      },
      ariaGroup: 'Капча crunchy antibot'
    },
    en: {
      prompt: {
        slider: 'Drag the photo fragment into the gap',
        grid: 'Select every cookie photo',
        text: 'Enter the code from the image'
      },
      status: {
        readySlider: 'Drag the handle to the right',
        readyGrid: 'Pick every cookie photo',
        readyText: 'Enter 4 to 7 characters',
        dragging: 'Release the handle to check',
        selected: function (n) {
          return n === 0 ? 'Pick every cookie photo' : 'Selected: ' + n;
        },
        fail: 'Not quite — one more try',
        success: 'Verified',
        verify: 'Check',
        refresh: 'New challenge',
        emptyCode: 'Enter the code first',
        quotaExceeded: 'Usage limit reached. Try again later.',
        licenseExpired: 'Access key is not valid.',
        licenseInvalid: 'License key not found. Check licenseKey.',
        quotaCheckError: 'Could not check the usage limit.',
        support: 'Captcha not working?',
        loading: 'Loading photo…',
        overlayTitle: 'Done',
        overlayText: 'Challenge completed',
        handle: 'Captcha slider',
        dragHint: 'drag',
        enterToCheck: 'Press Enter to check',
        codeInput: 'Code from the image',
        codePlaceholder: 'Code from the image',
        cell: function (index, name) {
          return 'Photo ' + index + ': ' + name;
        },
        option: 'Option'
      },
      ariaGroup: 'crunchy antibot captcha'
    }
  };

  const COOKIE_PHOTOS = [
    { file: 'cookie-1.jpg', ru: 'печенье', en: 'cookies', target: true },
    { file: 'cookie-2.jpg', ru: 'печенье', en: 'cookies', target: true },
    { file: 'cookie-3.jpg', ru: 'печенье', en: 'cookies', target: true }
  ];

  const OTHER_PHOTOS = [
    { file: 'bars.jpg', ru: 'батончик', en: 'cereal bar' },
    { file: 'cake-1.jpg', ru: 'шоколадный торт', en: 'chocolate cake' },
    { file: 'cake-2.jpg', ru: 'торт', en: 'cake' },
    { file: 'croissant.jpg', ru: 'круассан', en: 'croissant' },
    { file: 'sundae.jpg', ru: 'мороженое', en: 'ice cream sundae' },
    { file: 'pizza.jpg', ru: 'пицца', en: 'pizza' },
    { file: 'sushi.jpg', ru: 'суши', en: 'sushi' },
    { file: 'strawberry.jpg', ru: 'клубника', en: 'strawberries' },
    { file: 'bread.jpg', ru: 'хлеб', en: 'bread' },
    { file: 'coffee.jpg', ru: 'кофе', en: 'coffee' },
    { file: 'burger.jpg', ru: 'бургер', en: 'burger' },
    { file: 'ice-cream.jpg', ru: 'мороженое', en: 'ice cream' },
    { file: 'fries.jpg', ru: 'картофель фри', en: 'fries' },
    { file: 'salad.jpg', ru: 'салат', en: 'salad' }
  ];

  const SLIDER_PHOTOS = ['slider-1.jpg', 'slider-2.jpg', 'slider-3.jpg'];

  const SLIDER_W = 340;
  const SLIDER_H = 200;
  const GAP = 56;
  const TOLERANCE = 7;
  const TEXT_W = 340;
  const TEXT_H = 96;
  const TEXT_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

  function normalizeBase(path) {
    const value = path == null ? '' : String(path);
    if (!value) return '';
    return value.charAt(value.length - 1) === '/' ? value : value + '/';
  }

  function supportUrl(value) {
    try {
      const base = typeof location !== 'undefined' ? location.href : 'http://localhost/';
      const url = new URL(String(value || ''), base);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return url.href;
    } catch (err) {
      return '';
    }
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function randInt(min, max) {
    return Math.floor(rand(min, max + 1));
  }

  function shuffle(list) {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function setupCanvas(canvas, width, height) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.aspectRatio = width + ' / ' + height;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, dpr: dpr, width: width, height: height };
  }

  function drawCover(ctx, image, width, height) {
    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    if (!iw || !ih) return;
    const scale = Math.max(width / iw, height / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);
  }

  function drawFallback(ctx, width, height) {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#e8c08f');
    gradient.addColorStop(1, '#a96940');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 16; i += 1) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const r = 8 + Math.random() * 26;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 246, 226, ' + (0.08 + Math.random() * 0.12) + ')';
      ctx.fill();
    }
    const vignette = ctx.createRadialGradient(
      width / 2, height / 2, Math.min(width, height) * 0.25,
      width / 2, height / 2, Math.max(width, height) * 0.7
    );
    vignette.addColorStop(0, 'rgba(40, 20, 8, 0)');
    vignette.addColorStop(1, 'rgba(40, 20, 8, 0.3)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  function makeToken() {
    const bytes = new Uint8Array(8);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) {
      out += bytes[i].toString(16).padStart(2, '0');
    }
    return 'ca_' + out;
  }

  function makeCode() {
    const length = randInt(4, 7);
    let code = '';
    for (let i = 0; i < length; i += 1) {
      code += TEXT_CHARS.charAt(randInt(0, TEXT_CHARS.length - 1));
    }
    return code;
  }

  function makeVisitorId() {
    try {
      const key = 'crunchy_visitor_id';
      let id = localStorage.getItem(key);
      if (!id) {
        id = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
        localStorage.setItem(key, id);
      }
      return id;
    } catch (err) {
      return 'v_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
    }
  }

  function bitePath(ctx, x, y, size) {
    const corner = Math.min(12, size * 0.18);
    const biteRadius = size * 0.23;
    const biteX = x + size * 0.52;

    ctx.beginPath();
    ctx.moveTo(x + corner, y);
    ctx.lineTo(biteX - biteRadius, y);
    ctx.arc(biteX, y, biteRadius, Math.PI, 0, true);
    ctx.lineTo(x + size - corner, y);
    ctx.quadraticCurveTo(x + size, y, x + size, y + corner);
    ctx.lineTo(x + size, y + size - corner);
    ctx.quadraticCurveTo(x + size, y + size, x + size - corner, y + size);
    ctx.lineTo(x + corner, y + size);
    ctx.quadraticCurveTo(x, y + size, x, y + size - corner);
    ctx.lineTo(x, y + corner);
    ctx.quadraticCurveTo(x, y, x + corner, y);
    ctx.closePath();
  }

  class CrunchyAntibot {
    constructor(options) {
      const opts = options || {};
      if (!opts.el) {
        throw new Error('[crunchy-antibot] Укажите контейнер: new CrunchyAntibot({ el: "#captcha" })');
      }
      const host = typeof opts.el === 'string' ? document.querySelector(opts.el) : opts.el;
      if (!host) {
        throw new Error('[crunchy-antibot] Контейнер не найден: ' + opts.el);
      }

      this.el = host;
      this.options = opts;
      this.locale = opts.locale === 'en' ? 'en' : 'ru';
      this.t = TEXT[this.locale];
      this.type = TYPES.indexOf(opts.type) >= 0 ? opts.type : 'slider';
      this.assetsPath = normalizeBase(opts.assetsPath != null ? opts.assetsPath : SCRIPT_BASE);
      this.attempts = 0;
      this.solved = false;
      this._locked = false;
      this._timer = null;
      this._challengeAc = null;
      this._quotaAc = null;
      this._shellAc = new AbortController();
      this._verify = null;
      this.supportUrl = supportUrl(opts.supportUrl || DEFAULT_SUPPORT_URL);
      this.licenseKey = typeof opts.licenseKey === 'string' ? opts.licenseKey.trim() : '';
      this.apiBase = typeof opts.apiBase === 'string' ? opts.apiBase.replace(/\/+$/, '') : '';
      this.visitorId = opts.visitorId || makeVisitorId();
      this.quota = null;
      this.quotaError = null;
      this.quotaDenied = false;
      this._buildShell();
      this.reset();
      if (this.licenseKey && this.apiBase) this._loadQuota();
    }

    _photoUrl(file) {
      return this.assetsPath + 'photos/' + file;
    }

    _buildShell() {
      const root = document.createElement('div');
      root.className = 'ca';
      root.setAttribute('role', 'group');
      root.setAttribute('aria-label', this.t.ariaGroup);
      root.innerHTML = [
        '<div class="ca-head">',
        '<span class="ca-brand"><span class="ca-brand-text"><b>crunchy</b> antibot</span></span>',
        '<span class="ca-kind"></span>',
        '</div>',
        '<div class="ca-body"></div>',
        '<div class="ca-foot">',
        '<div class="ca-status" role="status" aria-live="polite"><span class="ca-dot" aria-hidden="true"></span><span class="ca-status-text"></span></div>',
        '<div class="ca-actions">',
        '<button type="button" class="ca-icon ca-refresh" aria-label="">',
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
        '<path d="M20 11a8 8 0 1 0-2.3 5.7"></path><path d="M20 4v7h-7"></path>',
        '</svg></button>',
        '<button type="button" class="ca-check"></button>',
        '</div>',
        '</div>',
        '<div class="ca-support-row"><a class="ca-support" target="_blank" rel="noopener noreferrer"></a></div>'
      ].join('');

      const brand = root.querySelector('.ca-brand');
      const logo = document.createElement('img');
      logo.className = 'ca-logo';
      logo.alt = '';
      logo.width = 26;
      logo.height = 26;
      logo.src = this.assetsPath + 'crunchy-logo.png';
      logo.addEventListener('error', function () {
        logo.style.display = 'none';
      });
      brand.insertBefore(logo, brand.firstChild);

      this.el.appendChild(root);
      this._root = root;
      this._body = root.querySelector('.ca-body');
      this._kind = root.querySelector('.ca-kind');
      this._statusText = root.querySelector('.ca-status-text');
      this._statusBox = root.querySelector('.ca-status');
      this._refreshBtn = root.querySelector('.ca-refresh');
      this._checkBtn = root.querySelector('.ca-check');
      this._refreshBtn.setAttribute('aria-label', this.t.status.refresh);
      this._refreshBtn.setAttribute('title', this.t.status.refresh);
      this._checkBtn.textContent = this.t.status.verify;

      this._supportLink = root.querySelector('.ca-support');
      if (this.supportUrl) {
        this._supportLink.href = this.supportUrl;
        this._supportLink.textContent = this.t.status.support;
      } else {
        this._supportLink.parentNode.remove();
        this._supportLink = null;
      }
    }

    setType(type) {
      if (TYPES.indexOf(type) < 0 || type === this.type) return this;
      this.type = type;
      this.reset();
      return this;
    }

    reset() {
      if (this._challengeAc) this._challengeAc.abort();
      this._challengeAc = new AbortController();
      const signal = this._challengeAc.signal;
      this._clearTimers();

      this.solved = false;
      this._locked = false;
      this._verify = null;
      this._root.classList.remove('is-solved', 'is-shaking', 'is-dragging');
      this._root.dataset.type = this.type;
      this._root.dataset.version = TYPE_VERSIONS[this.type];
      this._root.removeAttribute('data-state');
      this._kind.textContent = TYPE_VERSIONS[this.type];
      this._checkBtn.disabled = false;
      this._refreshBtn.disabled = false;
      this._checkBtn.style.display = this.type === 'slider' ? 'none' : '';
      this._body.innerHTML = '';

      this._prompt = el('div', 'ca-prompt');
      this._stage = el('div', 'ca-stage');
      this._controls = el('div', 'ca-controls');
      this._overlay = el('div', 'ca-overlay');
      this._overlay.setAttribute('aria-hidden', 'true');
      this._overlay.innerHTML = [
        '<div class="ca-overlay-card">',
        '<span class="ca-overlay-check" aria-hidden="true">✓</span>',
        '<strong></strong>',
        '<span class="ca-overlay-text"></span>',
        '<code class="ca-token"></code>',
        '</div>'
      ].join('');
      this._overlay.querySelector('strong').textContent = this.t.status.overlayTitle;
      this._overlay.querySelector('.ca-overlay-text').textContent = this.t.status.overlayText;
      this._tokenEl = this._overlay.querySelector('.ca-token');

      this._body.appendChild(this._prompt);
      this._body.appendChild(this._stage);
      this._body.appendChild(this._controls);
      this._body.appendChild(this._overlay);

      this._statusBox.removeAttribute('data-tone');
      const ready = {
        slider: this.t.status.readySlider,
        grid: this.t.status.readyGrid,
        text: this.t.status.readyText
      }[this.type];
      this._setStatus(ready, 'idle');

      this._refreshBtn.addEventListener('click', () => {
        if (this.solved) return;
        this._emit('onRefresh', { type: this.type, version: TYPE_VERSIONS[this.type], attempts: this.attempts });
        this.reset();
      }, { signal: signal });

      this._checkBtn.addEventListener('click', () => {
        if (this.solved || this._locked || !this._verify) return;
        this._verify();
      }, { signal: signal });

      if (this.type === 'slider') this._buildSlider(signal);
      if (this.type === 'grid') this._buildGrid(signal);
      if (this.type === 'text') this._buildText(signal);

      if (this.quotaDenied) {
        const status = this.quota && this.quota.error === 'license_expired'
          ? this.t.status.licenseExpired
          : this.quota && this.quota.error === 'quota_exceeded'
            ? this.t.status.quotaExceeded
            : this.t.status.licenseInvalid;
        this._applyQuotaDenied(status);
      }

      this._emit('onReady', { type: this.type, version: TYPE_VERSIONS[this.type], attempts: this.attempts });
    }

    _buildSlider(signal) {
      const t = this.t;
      this._prompt.textContent = t.prompt.slider;

      const wrap = el('div', 'ca-canvas');
      const canvas = document.createElement('canvas');
      canvas.className = 'ca-puzzle-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      wrap.appendChild(canvas);
      this._stage.appendChild(wrap);

      const track = el('div', 'ca-track');
      const hint = el('span', 'ca-track-hint', t.status.dragHint);
      hint.setAttribute('aria-hidden', 'true');
      const handle = el('div', 'ca-handle');
      handle.setAttribute('role', 'slider');
      handle.setAttribute('tabindex', '0');
      handle.setAttribute('aria-label', t.status.handle);
      handle.setAttribute('aria-valuemin', '0');
      handle.setAttribute('aria-valuemax', '100');
      handle.setAttribute('aria-valuenow', '0');
      handle.innerHTML = '<span aria-hidden="true">→</span>';
      track.appendChild(hint);
      track.appendChild(handle);
      this._controls.appendChild(track);

      const c = setupCanvas(canvas, SLIDER_W, SLIDER_H);
      const scene = document.createElement('canvas');
      scene.width = Math.round(SLIDER_W * c.dpr);
      scene.height = Math.round(SLIDER_H * c.dpr);
      const sctx = scene.getContext('2d');
      sctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0);
      drawFallback(sctx, SLIDER_W, SLIDER_H);

      const gapX = randInt(100, SLIDER_W - GAP - 12);
      const gapY = randInt(12, SLIDER_H - GAP - 12);
      let fraction = 0;
      let loaded = false;

      const pieceX = function () {
        return fraction * (SLIDER_W - GAP);
      };

      const draw = () => {
        const ctx = c.ctx;
        ctx.clearRect(0, 0, SLIDER_W, SLIDER_H);
        ctx.drawImage(scene, 0, 0, SLIDER_W, SLIDER_H);

        ctx.save();
        bitePath(ctx, gapX, gapY, GAP);
        ctx.clip();
        ctx.fillStyle = 'rgba(28, 16, 8, 0.52)';
        ctx.fillRect(gapX - 1, gapY - 1, GAP + 2, GAP + 2);
        ctx.restore();

        ctx.save();
        bitePath(ctx, gapX, gapY, GAP);
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255, 252, 244, 0.92)';
        ctx.stroke();
        ctx.restore();

        const px = pieceX();
        ctx.save();
        ctx.shadowColor = 'rgba(30, 16, 7, 0.45)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 3;
        bitePath(ctx, px, gapY, GAP);
        ctx.fillStyle = 'rgba(30, 16, 7, 1)';
        ctx.fill();
        ctx.restore();

        ctx.save();
        bitePath(ctx, px, gapY, GAP);
        ctx.clip();
        ctx.drawImage(
          scene,
          gapX * c.dpr, gapY * c.dpr, GAP * c.dpr, GAP * c.dpr,
          px, gapY, GAP, GAP
        );
        ctx.restore();

        ctx.save();
        bitePath(ctx, px, gapY, GAP);
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = 'rgba(255, 252, 244, 0.95)';
        ctx.stroke();
        ctx.restore();
      };

      const setFraction = (next) => {
        fraction = clamp(next, 0, 1);
        handle.style.setProperty('--f', fraction.toFixed(4));
        handle.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
        hint.style.opacity = fraction > 0.005 ? '0' : '';
        draw();
      };

      const verify = () => {
        if (this.solved || this._locked) return;
        if (!loaded) {
          this._setStatus(t.status.loading, 'idle');
          return;
        }
        if (fraction < 0.02) {
          this._setStatus(t.status.readySlider, 'idle');
          return;
        }
        if (Math.abs(pieceX() - gapX) <= TOLERANCE) {
          setFraction(gapX / (SLIDER_W - GAP));
          this._succeed();
        } else {
          this._fail('offset');
        }
      };
      this._verify = verify;

      let dragging = false;
      let grabDx = 1;

      handle.addEventListener('pointerdown', (event) => {
        if (this.solved || this._locked) return;
        event.preventDefault();
        dragging = true;
        const rect = handle.getBoundingClientRect();
        grabDx = event.clientX - (rect.left + rect.width / 2);
        this._root.classList.add('is-dragging');
        this._setStatus(t.status.dragging, 'working');
        try {
          handle.setPointerCapture(event.pointerId);
        } catch (err) { /* noop */ }
      }, { signal: signal });

      handle.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        event.preventDefault();
        const rect = track.getBoundingClientRect();
        const handleWidth = handle.offsetWidth || 46;
        const usable = Math.max(1, rect.width - handleWidth);
        const center = event.clientX - grabDx;
        setFraction((center - rect.left - handleWidth / 2) / usable);
      }, { signal: signal });

      const stopDrag = (event) => {
        if (!dragging) return;
        dragging = false;
        this._root.classList.remove('is-dragging');
        try {
          handle.releasePointerCapture(event.pointerId);
        } catch (err) { /* noop */ }
        verify();
      };

      handle.addEventListener('pointerup', stopDrag, { signal: signal });
      handle.addEventListener('pointercancel', (event) => {
        if (!dragging) return;
        dragging = false;
        this._root.classList.remove('is-dragging');
        try {
          handle.releasePointerCapture(event.pointerId);
        } catch (err) { /* noop */ }
        this._setStatus(t.status.readySlider, 'idle');
      }, { signal: signal });

      handle.addEventListener('keydown', (event) => {
        if (this.solved || this._locked) return;
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          event.preventDefault();
          setFraction(fraction + (event.shiftKey ? 0.08 : 0.02));
          this._setStatus(t.status.enterToCheck, 'working');
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          event.preventDefault();
          setFraction(fraction - (event.shiftKey ? 0.08 : 0.02));
          this._setStatus(t.status.enterToCheck, 'working');
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          verify();
        }
      }, { signal: signal });

      setFraction(0);

      const photo = SLIDER_PHOTOS[randInt(0, SLIDER_PHOTOS.length - 1)];
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        if (signal.aborted) return;
        drawCover(sctx, image, SLIDER_W, SLIDER_H);
        loaded = true;
        draw();
      };
      image.onerror = () => {
        if (signal.aborted) return;
        loaded = true;
        draw();
      };
      image.src = this._photoUrl(photo);
    }

    _buildGrid(signal) {
      const t = this.t;
      this._prompt.textContent = t.prompt.grid;
      const chip = el('span', 'ca-target');
      const chipImage = document.createElement('img');
      chipImage.src = this._photoUrl(COOKIE_PHOTOS[0].file);
      chipImage.alt = '';
      chip.appendChild(chipImage);
      this._prompt.appendChild(chip);

      const targets = COOKIE_PHOTOS.slice();
      const selected = new Set();
      const targetSet = new Set();
      const distractors = shuffle(OTHER_PHOTOS.slice()).slice(0, 6);
      const items = shuffle(targets.concat(distractors));

      const grid = el('div', 'ca-grid');
      grid.setAttribute('role', 'group');

      items.forEach((item, index) => {
        if (item.target) targetSet.add(index);
        const button = el('button', 'ca-cell');
        button.type = 'button';
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-label', t.status.cell(index + 1, item[this.locale]));

        const image = document.createElement('img');
        image.src = this._photoUrl(item.file);
        image.alt = '';
        image.draggable = false;
        image.loading = 'eager';
        button.appendChild(image);

        const mark = el('span', 'ca-cell-mark', '✓');
        mark.setAttribute('aria-hidden', 'true');
        button.appendChild(mark);

        button.addEventListener('click', () => {
          if (this.solved || this._locked) return;
          if (selected.has(index)) {
            selected.delete(index);
            button.classList.remove('is-selected');
            button.setAttribute('aria-pressed', 'false');
          } else {
            selected.add(index);
            button.classList.add('is-selected');
            button.setAttribute('aria-pressed', 'true');
          }
          this._setStatus(
            t.status.selected(selected.size),
            selected.size > 0 ? 'working' : 'idle'
          );
        }, { signal: signal });

        grid.appendChild(button);
      });

      this._stage.appendChild(grid);

      this._verify = () => {
        if (this.solved || this._locked) return;
        if (selected.size === 0) {
          this._setStatus(t.status.selected(0), 'idle');
          return;
        }
        const ok = selected.size === targetSet.size &&
          Array.from(selected).every((index) => targetSet.has(index));
        if (ok) {
          this._succeed();
        } else {
          this._fail('selection');
        }
      };
    }

    _buildText(signal) {
      const t = this.t;
      this._prompt.textContent = t.prompt.text;

      const canvas = document.createElement('canvas');
      canvas.className = 'ca-text-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      this._stage.appendChild(canvas);

      const input = document.createElement('input');
      input.className = 'ca-text-input';
      input.type = 'text';
      input.maxLength = 7;
      input.autocomplete = 'off';
      input.autocapitalize = 'off';
      input.spellcheck = false;
      input.placeholder = t.status.codePlaceholder;
      input.setAttribute('aria-label', t.status.codeInput);
      this._controls.appendChild(input);
      this._textInput = input;

      const answer = makeCode();
      const c = setupCanvas(canvas, TEXT_W, TEXT_H);
      const ctx = c.ctx;

      ctx.fillStyle = '#fffaf1';
      ctx.fillRect(0, 0, TEXT_W, TEXT_H);

      const glow = ctx.createLinearGradient(0, 0, TEXT_W, TEXT_H);
      glow.addColorStop(0, 'rgba(232, 86, 63, 0.08)');
      glow.addColorStop(0.5, 'rgba(240, 164, 60, 0.08)');
      glow.addColorStop(1, 'rgba(47, 143, 91, 0.06)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, TEXT_W, TEXT_H);

      for (let i = 0; i < 3; i += 1) {
        ctx.beginPath();
        const y = 20 + Math.random() * (TEXT_H - 40);
        ctx.moveTo(12, y);
        for (let x = 12; x <= TEXT_W - 12; x += 12) {
          ctx.lineTo(x, y + Math.sin((x + i * 35) / 22) * 4);
        }
        ctx.strokeStyle = 'rgba(89, 54, 30, ' + (0.12 + i * 0.03) + ')';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      for (let i = 0; i < 48; i += 1) {
        ctx.beginPath();
        ctx.arc(
          Math.random() * TEXT_W,
          Math.random() * TEXT_H,
          0.6 + Math.random() * 1.6,
          0,
          Math.PI * 2
        );
        ctx.fillStyle = 'rgba(89, 54, 30, ' + (0.12 + Math.random() * 0.18) + ')';
        ctx.fill();
      }

      const palette = ['#4a2a16', '#a84618', '#6d3f1d', '#2c1b10'];
      const slot = (TEXT_W - 42) / answer.length;
      const fontSize = clamp(44 - answer.length * 1.3, 29, 42);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let i = 0; i < answer.length; i += 1) {
        const x = 21 + slot * (i + 0.5) + rand(-2.5, 2.5);
        const y = TEXT_H / 2 + rand(-6, 6);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rand(-0.22, 0.22));
        ctx.scale(1, rand(0.9, 1.12));
        ctx.font = '700 ' + fontSize.toFixed(1) + 'px "Trebuchet MS", "Segoe UI", sans-serif';
        ctx.fillStyle = palette[i % palette.length];
        ctx.fillText(answer.charAt(i), 0, 0);
        ctx.restore();
      }

      for (let i = 0; i < 2; i += 1) {
        ctx.beginPath();
        ctx.moveTo(10, 20 + Math.random() * 60);
        ctx.bezierCurveTo(
          TEXT_W * 0.3, Math.random() * TEXT_H,
          TEXT_W * 0.7, Math.random() * TEXT_H,
          TEXT_W - 10, 20 + Math.random() * 60
        );
        ctx.strokeStyle = 'rgba(232, 86, 63, 0.18)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      const verify = () => {
        if (this.solved || this._locked) return;
        const value = input.value.trim();
        if (!value) {
          this._setStatus(t.status.emptyCode, 'idle');
          input.focus();
          return;
        }
        if (value.toLowerCase() === answer.toLowerCase()) {
          this._succeed();
        } else {
          this._fail('text');
        }
      };
      this._verify = verify;

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          verify();
        }
      }, { signal: signal });

      input.addEventListener('input', () => {
        if (this._statusBox.getAttribute('data-tone') === 'error') {
          this._setStatus(t.status.readyText, 'idle');
        }
      }, { signal: signal });
    }

    _applyQuotaDenied(message) {
      if (this.solved) return;
      this.quotaDenied = true;
      this._locked = true;
      this._clearTimers();
      if (this._checkBtn) this._checkBtn.disabled = true;
      if (this._refreshBtn) this._refreshBtn.disabled = true;
      if (this._root) this._root.classList.add('is-quota');
      if (this._stage) this._stage.inert = true;
      if (this._controls) this._controls.inert = true;
      this._setStatus(message || this.t.status.quotaExceeded, 'error');
    }

    _loadQuota() {
      if (!this.licenseKey || !this.apiBase) return Promise.resolve(null);
      if (this._quotaAc) this._quotaAc.abort();
      const controller = new AbortController();
      this._quotaAc = controller;

      return fetch(this.apiBase + '/api/usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey: this.licenseKey,
          visitorId: this.visitorId
        }),
        signal: controller.signal
      })
        .then((response) => response.json()
          .catch(() => null)
          .then((data) => ({ response, data })))
        .then(({ response, data }) => {
          if (controller.signal.aborted) return null;
          if (!data) {
            const error = new Error('Usage endpoint did not return JSON');
            this.quotaError = error;
            this._emit('onQuotaError', error);
            return null;
          }
          this.quota = data;
          if (!response.ok || data.allowed === false) {
            if (typeof this.options.onQuota === 'function') this._emit('onQuota', data);
            if (this.options.enforceQuota === false) return data;
            const message = response.status === 404
              ? this.t.status.licenseInvalid
              : data.error === 'license_expired'
                ? this.t.status.licenseExpired
                : this.t.status.quotaExceeded;
            this._applyQuotaDenied(message);
            return data;
          }

          const wasDenied = this.quotaDenied;
          this.quotaDenied = false;
          this.quotaError = null;
          if (this._root) this._root.classList.remove('is-quota');
          if (wasDenied) this.reset();
          if (typeof this.options.onQuota === 'function') this._emit('onQuota', data);
          return data;
        })
        .catch((error) => {
          if (error.name === 'AbortError') return null;
          this.quotaError = error;
          this._emit('onQuotaError', error);
          return null;
        });
    }

    checkQuota() {
      return this._loadQuota();
    }

    _setStatus(text, tone) {
      this._statusText.textContent = text;
      this._statusBox.setAttribute('data-tone', tone || 'idle');
    }

    _fail(reason) {
      if (this.solved || this._locked) return;
      this._locked = true;
      this.attempts += 1;
      this._setStatus(this.t.status.fail, 'error');
      this._root.classList.remove('is-shaking');
      void this._root.offsetWidth;
      this._root.classList.add('is-shaking');
      this._emit('onFail', {
        type: this.type,
        version: TYPE_VERSIONS[this.type],
        attempts: this.attempts,
        reason: reason || 'unknown'
      });
      this._timer = setTimeout(() => this.reset(), 1050);
    }

    _succeed() {
      if (this.solved || this._locked) return;
      this.solved = true;
      this._locked = true;
      this._clearTimers();
      const token = makeToken();
      this._tokenEl.textContent = token;
      this._overlay.setAttribute('aria-hidden', 'false');
      this._root.classList.add('is-solved');
      this._root.dataset.state = 'solved';
      this._setStatus(this.t.status.success, 'success');
      this._checkBtn.disabled = true;
      this._refreshBtn.disabled = true;
      this._stage.inert = true;
      this._controls.inert = true;
      this._emit('onSuccess', token, {
        type: this.type,
        version: TYPE_VERSIONS[this.type],
        attempts: this.attempts
      });
    }

    _clearTimers() {
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
    }

    _emit(name) {
      const args = Array.prototype.slice.call(arguments, 1);
      const fn = this.options[name];
      if (typeof fn !== 'function') return;
      try {
        fn.apply(null, args);
      } catch (err) {
        console.error('[crunchy-antibot]', err);
      }
    }

    destroy() {
      this._clearTimers();
      if (this._challengeAc) this._challengeAc.abort();
      if (this._quotaAc) this._quotaAc.abort();
      if (this._shellAc) this._shellAc.abort();
      if (this._root && this._root.parentNode) {
        this._root.parentNode.removeChild(this._root);
      }
      this._root = null;
      this._textInput = null;
    }
  }

  CrunchyAntibot.version = VERSION;
  CrunchyAntibot.types = TYPES.slice();
  CrunchyAntibot.versions = Object.assign({}, TYPE_VERSIONS);

  return CrunchyAntibot;
});
