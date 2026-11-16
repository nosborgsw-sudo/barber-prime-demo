'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.resolve(__dirname, '..');
const autonomo = fs.readFileSync(path.join(raiz, 'app-autonomo.html'));
const index = fs.readFileSync(path.join(raiz, 'index.html'));

test('index.html publicado no Pages é cópia fiel da demonstração autônoma', () => {
  assert.ok(
    index.equals(autonomo),
    'index.html divergiu de app-autonomo.html; rode "npm run build:pages" e commite o resultado'
  );
});

test('demonstração pública não depende de recursos externos', () => {
  const texto = autonomo.toString('utf8').replace(/xmlns="[^"]*"/g, '');
  const externos = texto.match(/https?:\/\/[^\s"'<>]+/g) || [];
  assert.deepEqual(
    externos,
    [],
    `a demo precisa funcionar offline; referências externas encontradas: ${externos.join(', ')}`
  );
});
