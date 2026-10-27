#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');

const source = path.join(__dirname, '..', 'assets');
const targetArg = process.argv[3];

function usage() {
  console.log([
    'crunchy antibot ' + pkg.version,
    '',
    'Использование:',
    '  npx github:8pzww4tbys-byte/crunchy-antibot add public/crunchy',
    '  npx crunchy-antibot add public/crunchy',
    '',
    'Команда add копирует JS, CSS, логотип и фотографии.',
    'Опции:',
    '  -h, --help      показать помощь',
    '  -v, --version   показать версию',
  ].join('\n'));
}

function fail(message) {
  console.error('crunchy antibot: ' + message);
  process.exitCode = 1;
}

function webPath(target) {
  let relative = path.relative(process.cwd(), target).split(path.sep).join('/');
  if (!relative || relative === '.') relative = path.basename(target);
  if (relative.startsWith('../')) relative = path.basename(target);
  if (relative.startsWith('public/')) relative = relative.slice('public/'.length);
  return '/' + relative.replace(/^\/+/, '');
}

function add(target) {
  if (!target) {
    fail('укажите папку: add public/crunchy');
    usage();
    return;
  }

  const destination = path.resolve(process.cwd(), target);
  if (fs.existsSync(destination) && !fs.statSync(destination).isDirectory()) {
    fail('это не папка: ' + destination);
    return;
  }

  fs.mkdirSync(destination, { recursive: true });

  const files = ['crunchy-antibot.js', 'crunchy-antibot.css', 'crunchy-logo.png'];
  for (const file of files) {
    const from = path.join(source, file);
    if (!fs.existsSync(from)) {
      fail('в пакете нет файла ' + file);
      return;
    }
    fs.copyFileSync(from, path.join(destination, file));
  }

  const photos = path.join(source, 'photos');
  if (fs.existsSync(photos)) {
    fs.cpSync(photos, path.join(destination, 'photos'), {
      recursive: true,
      force: true,
    });
  }

  const base = webPath(destination);
  console.log('');
  console.log('  crunchy antibot ' + pkg.version + ' установлен');
  console.log('  ' + destination);
  console.log('');
  console.log('  Подключение:');
  console.log('');
  console.log('  <link rel="stylesheet" href="' + base + '/crunchy-antibot.css">');
  console.log('  <script src="' + base + '/crunchy-antibot.js"><\/script>');
  console.log('');
  console.log('  <div id="captcha"></div>');
  console.log('  <script>');
  console.log('    new CrunchyAntibot({');
  console.log("      el: '#captcha',");
  console.log("      type: 'text'");
  console.log('    });');
  console.log('  <\/script>');
  console.log('');
  console.log('  Фото и логотип подхватятся автоматически по URL скрипта.');
  console.log('');
}

const command = process.argv[2];

if (!command || command === '-h' || command === '--help' || command === 'help') {
  usage();
} else if (command === '-v' || command === '--version') {
  console.log(pkg.version);
} else if (command === 'add') {
  add(targetArg);
} else {
  fail('неизвестная команда: ' + command);
  usage();
}
