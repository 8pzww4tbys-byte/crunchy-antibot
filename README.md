# 🍪 crunchy antibot

Лёгкая клиентская капча без зависимостей и сборки. Три проверки, реальные фотографии, русский и английский интерфейс, клавиатура и мобильные жесты.

**Демо:** [8pzww4tbys-byte.github.io/crunchy-antibot](https://8pzww4tbys-byte.github.io/crunchy-antibot/)

```text
0.x  crunchy v0.2   пазл из фото: вставьте фрагмент в вырез
1.x  crunchy v1.0   сетка 3×3: выберите все фото с печеньем
2.x  crunchy v2.0   код с картинки: 4–7 символов, без учёта регистра
```

Версия виджета: **0.6.0**. Типов ровно три — `slider`, `grid`, `text`.

- 0 зависимостей, vanilla JS, один файл.
- Фотографии и логотип подхватываются по URL скрипта.
- RU/EN, управление мышью, пальцем и клавиатурой.
- Callbacks `onReady`, `onFail`, `onSuccess`, `onRefresh`.
- Готовый конфигуратор сигналов подозрительной активности на демо-странице.
- Клиентский токен `ca_...`, который проверяется на вашем сервере.

> Капча — это клиентская эвристика, а не криптографическая защита. Мотивированный бот может прочитать JS. Защищаемое действие проверяйте на сервере, а от объёмного DDoS используйте CDN/WAF.

---

## Быстрый старт

Одна команда копирует JS, CSS, логотип и фотографии в папку проекта:

```bash
npx github:8pzww4tbys-byte/crunchy-antibot add public/crunchy
```

Затем на странице:

```html
<link rel="stylesheet" href="/crunchy/crunchy-antibot.css">
<script src="/crunchy/crunchy-antibot.js"></script>

<div id="captcha"></div>
<script>
  const captcha = new CrunchyAntibot({
    el: '#captcha',
    type: 'text', // slider | grid | text
    locale: 'ru'
  });
</script>
```

Можно клонировать репозиторий и подключать файлы напрямую из `assets/`. Минимальный пример с формой — [`examples/basic.html`](examples/basic.html).

Без установки, через jsDelivr:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/8pzww4tbys-byte/crunchy-antibot@main/assets/crunchy-antibot.css">
<script src="https://cdn.jsdelivr.net/gh/8pzww4tbys-byte/crunchy-antibot@main/assets/crunchy-antibot.js"></script>
```

Фото и логотип загрузятся с того же CDN: путь считается от `src` скрипта.

---

## Три типа

### v0.2 — `slider`

Фотография с «вырезом»; фрагмент нужно перетащить в вырез. Работает мышью, пальцем и стрелками клавиатуры. При промахе виджет показывает новую попытку.

### v1.0 — `grid`

Сетка 3×3 с реальными фото. Нужно выбрать все клетки с печеньем; цель показана миниатюрой. Проверка — точное совпадение выбранного набора.

### v2.0 — `text`

Код из 4–7 символов на canvas. Ввод без учёта регистра, `Enter` проверяет. Код не хранится в DOM в открытом виде.

---

## API виджета

```js
const captcha = new CrunchyAntibot({
  el: '#captcha',
  type: 'grid',
  locale: 'ru',
  assetsPath: '/crunchy/',
  supportUrl: 'https://example.com/support',
  onReady(info) {},
  onFail(info) {},
  onSuccess(token, info) {},
  onRefresh(info) {}
});
```

| Опция | Тип | Описание |
|---|---|---|
| `el` | `string \| Element` | Контейнер. Обязательно. |
| `type` | `'slider' \| 'grid' \| 'text'` | Тип задания, по умолчанию `slider`. |
| `locale` | `'ru' \| 'en'` | Язык интерфейса, по умолчанию `ru`. |
| `assetsPath` | `string` | База для `photos/` и логотипа. По умолчанию — папка скрипта. |
| `supportUrl` | `string` | Куда ведёт «Не работает капча?». По умолчанию — GitHub Issues проекта. |
| `onReady` | `function` | Новое задание построено. |
| `onFail` | `function` | Провал; `info.reason`: `offset`, `selection`, `text`. |
| `onSuccess` | `function` | Успех; `token` вида `ca_...`, `info`: `{ type, attempts }`. |
| `onRefresh` | `function` | Пользователь запросил новое задание. |

Методы и свойства:

```js
captcha.reset();              // новое задание
captcha.setType('text');      // сменить тип
captcha.destroy();            // удалить виджет
CrunchyAntibot.version;       // '0.6.0'
CrunchyAntibot.versions;      // { slider: 'v0.2', grid: 'v1.0', text: 'v2.0' }
```

### Кнопка поддержки

В нижней части виджета есть ссылка **«Не работает капча?»** (в английской локали — `Captcha not working?`). Она открывается в новой вкладке. Адрес можно переопределить через `supportUrl`.

### Токен

`onSuccess` получает клиентский токен `ca_...`. Это **не** готовая серверная сессия: для реальной защиты отправьте токен на свой backend и проверьте его вместе с бизнес-действием. Виджет не хранит секрет и не умеет выдавать серверные права.

### Проверка квоты (внешний API)

Виджет умеет необязательно учитывать лимит через совместимый внешний API. Без `apiBase` эти опции не используются:

```js
new CrunchyAntibot({
  el: '#captcha',
  licenseKey: 'cr_...',
  apiBase: 'https://api.example.com',
  enforceQuota: true,
  visitorId: 'anonymous-id',
  onQuota(data) {},
  onQuotaError(error) {}
});
```

`enforceQuota` по умолчанию `true`: при исчерпанном лимите виджет блокируется. При ошибке backend виджет продолжает работать (fail-open). Клиентскую блокировку легко обойти — жёсткая проверка должна быть на вашем сервере. Серверная часть в этот репозиторий не входит.

---

## Сигналы подозрительной активности

Виджет не показывается на каждый запрос. Демо-конфигуратор использует три сигнала:

1. **Всплеск активности** — N событий за окно времени.
2. **Признаки автоматизации** — `webdriver`, подозрительные свойства браузера, отсутствие движения/фокуса.
3. **Повторные неудачные действия** — N ошибок защищаемого действия подряд.

Логика находится в [`assets/demo.js`](assets/demo.js) и может быть перенесена в ваш код. Порог и окно настраиваются. Капча показывается только после сигнала.

---

## Структура

```text
index.html                  демо и конфигуратор
examples/basic.html         пример защиты формы
assets/
  crunchy-antibot.js        виджет 0.6.0
  crunchy-antibot.css       стили виджета
  crunchy-logo.png          логотип
  demo.js / demo.css        демонстрационная страница
  photos/                   реальные фотографии (Unsplash)
bin/crunchy-antibot.js      установщик одной командой
```

---

## Проверка

```bash
npm run check
```

Проверяет синтаксис виджета, демо и установщика.

---

## Лицензия

MIT. См. [LICENSE](LICENSE).

Фотографии взяты с [Unsplash](https://unsplash.com) по [Unsplash License](https://unsplash.com/license). Список источников — [`assets/photos/CREDITS.md`](assets/photos/CREDITS.md).
