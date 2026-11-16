// Gera o index.html publicado no GitHub Pages a partir da demonstração autônoma.
// O arquivo é copiado byte a byte (sem transformação) e o teste tests/pages.test.js
// garante que as duas cópias não divergem.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const raiz = resolve(import.meta.dirname, '..');
const origem = resolve(raiz, 'app-autonomo.html');
const destino = resolve(raiz, 'index.html');

const conteudo = readFileSync(origem);
if (conteudo.length === 0) {
  console.error('app-autonomo.html está vazio; nada foi publicado.');
  process.exit(1);
}

const externos = conteudo
  .toString('utf8')
  .replace(/xmlns="[^"]*"/g, '')
  .match(/https?:\/\/[^\s"'<>]+/g);

if (externos) {
  console.error('A demonstração pública não pode depender de recursos externos:');
  for (const url of externos) console.error(`  - ${url}`);
  process.exit(1);
}

copyFileSync(origem, destino);
writeFileSync(resolve(raiz, '.nojekyll'), '');
console.log(`index.html gerado a partir de app-autonomo.html (${conteudo.length} bytes).`);
