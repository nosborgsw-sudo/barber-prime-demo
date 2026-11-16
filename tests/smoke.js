'use strict';

/**
 * Smoke test end-to-end do Barber Prime.
 *
 * Sobe `node server.js` como processo filho duas vezes, com o MESMO arquivo de
 * banco e portas livres distintas:
 *   1) health, login admin, criacao e listagem de agendamento;
 *   2) reinicio com o mesmo DB e conferencia da persistencia.
 *
 * Sucesso imprime exatamente: SMOKE OK
 * Qualquer falha imprime diagnostico e sai com codigo 1.
 *
 * Uso: node tests/smoke.js
 */

const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: esperar } = require('node:timers/promises');

const {
  RAIZ,
  caminhoBancoTemporario,
  removerArquivosBanco,
  dataFutura,
} = require('./helpers');

const CAMINHO_SERVER = path.join(RAIZ, 'server.js');
const TIMEOUT_HEALTH_MS = 30000;
const TIMEOUT_SAIDA_MS = 10000;

let processoAtual = null;
let dbPath = null;
let logsDoFilho = [];

function registrarLog(prefixo, mensagem) {
  console.log(`[smoke] ${prefixo}: ${mensagem}`);
}

function falhar(mensagem) {
  throw new Error(mensagem);
}

function portaLivre() {
  return new Promise((resolve, reject) => {
    const servidor = net.createServer();
    servidor.unref();
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', () => {
      const { port } = servidor.address();
      servidor.close(() => resolve(port));
    });
  });
}

async function requisicao(url, opcoes = {}) {
  const resposta = await fetch(url, {
    ...opcoes,
    signal: AbortSignal.timeout(opcoes.timeoutMs || 5000),
  });
  const texto = await resposta.text();
  let corpo;
  if (texto !== '') {
    try {
      corpo = JSON.parse(texto);
    } catch {
      corpo = undefined;
    }
  } else {
    corpo = null;
  }
  const setCookies = typeof resposta.headers.getSetCookie === 'function'
    ? resposta.headers.getSetCookie()
    : [];
  return { status: resposta.status, headers: resposta.headers, texto, corpo, setCookies };
}

function cookieDeSessao(resposta) {
  const cookies = (resposta.setCookies || [])
    .map((bruto) => bruto.split(';')[0])
    .filter((par) => par.startsWith('bp_sess='));
  if (cookies.length === 0) falhar('login nao devolveu Set-Cookie bp_sess');
  return cookies.join('; ');
}

async function subirServidor(rotulo) {
  if (!fs.existsSync(CAMINHO_SERVER)) {
    falhar(`server.js nao encontrado em ${CAMINHO_SERVER}`);
  }

  const porta = await portaLivre();
  logsDoFilho = [];

  const filho = spawn(process.execPath, ['server.js'], {
    cwd: RAIZ,
    env: {
      ...process.env,
      PORT: String(porta),
      DB_PATH: dbPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  processoAtual = filho;

  const guardar = (fluxo, tipo) => {
    fluxo.setEncoding('utf8');
    fluxo.on('data', (pedaco) => {
      logsDoFilho.push(`[${tipo}] ${pedaco}`);
      if (logsDoFilho.length > 200) logsDoFilho.shift();
    });
  };
  guardar(filho.stdout, 'stdout');
  guardar(filho.stderr, 'stderr');

  let erroDeSpawn = null;
  filho.once('error', (erro) => {
    erroDeSpawn = erro;
  });

  const base = `http://127.0.0.1:${porta}`;
  const limite = Date.now() + TIMEOUT_HEALTH_MS;

  while (Date.now() < limite) {
    if (erroDeSpawn) falhar(`falha ao iniciar ${rotulo}: ${erroDeSpawn.message}`);
    if (filho.exitCode !== null) {
      falhar(
        `${rotulo} encerrou prematuramente (exit=${filho.exitCode}). Saida do filho:\n${logsDoFilho.join('')}`,
      );
    }
    try {
      const health = await requisicao(`${base}/api/health`, { timeoutMs: 1000 });
      if (health.status >= 200 && health.status < 300) {
        registrarLog('health', `${rotulo} respondeu ${health.status} em ${base}`);
        return { filho, base, porta };
      }
    } catch {
      // servidor ainda subindo
    }
    await esperar(100);
  }

  falhar(
    `${rotulo} nao respondeu /api/health em ${TIMEOUT_HEALTH_MS}ms. Saida do filho:\n${logsDoFilho.join('')}`,
  );
}

function esperarSaida(filho, ms) {
  return new Promise((resolve) => {
    if (filho.exitCode !== null) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => resolve(false), ms);
    filho.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function encerrar(filho, rotulo) {
  if (!filho) return;
  if (filho.exitCode !== null) {
    processoAtual = null;
    return;
  }
  registrarLog('encerrar', rotulo);
  filho.kill();
  const saiu = await esperarSaida(filho, TIMEOUT_SAIDA_MS);
  if (!saiu) {
    filho.kill('SIGKILL');
    await esperarSaida(filho, 3000);
  }
  processoAtual = null;
}

async function loginAdmin(base) {
  const resposta = await requisicao(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'admin', senha: 'admin123' }),
  });
  if (resposta.status !== 200) {
    falhar(`login admin falhou: status ${resposta.status} corpo=${resposta.texto.slice(0, 400)}`);
  }
  if (!resposta.corpo || !resposta.corpo.usuario || resposta.corpo.usuario.papel !== 'admin') {
    falhar(`login admin devolveu papel inesperado: ${resposta.texto.slice(0, 400)}`);
  }
  return cookieDeSessao(resposta);
}

async function executar() {
  if (!fs.existsSync(CAMINHO_SERVER)) {
    falhar(`server.js nao encontrado em ${CAMINHO_SERVER}. O backend ainda nao existe.`);
  }

  dbPath = caminhoBancoTemporario('barberprime-smoke');
  registrarLog('banco', dbPath);

  // ---------- primeira subida ----------
  let servidor = await subirServidor('primeira subida');
  const cookieAdmin = await loginAdmin(servidor.base);

  const clientes = await requisicao(`${servidor.base}/api/admin/clientes`, {
    headers: { Cookie: cookieAdmin },
  });
  if (clientes.status !== 200) {
    falhar(`GET /api/admin/clientes falhou: ${clientes.status} ${clientes.texto.slice(0, 400)}`);
  }
  const cliente = (clientes.corpo && clientes.corpo.clientes && clientes.corpo.clientes[0]) || null;
  if (!cliente) falhar('seed nao tem cliente demo para o smoke');

  const data = dataFutura(35);
  const hora = '15:00';
  const barbeiroId = 4;

  const criacao = await requisicao(`${servidor.base}/api/agendamentos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieAdmin },
    body: JSON.stringify({
      servicoId: 1,
      barbeiroId,
      data,
      hora,
      clienteId: cliente.id,
    }),
  });
  if (criacao.status !== 201) {
    falhar(`criacao de agendamento falhou: ${criacao.status} ${criacao.texto.slice(0, 600)}`);
  }
  const agendamento = criacao.corpo && criacao.corpo.agendamento;
  if (!agendamento || !agendamento.id) falhar('criacao nao devolveu agendamento.id');
  registrarLog('agendamento', `criado id=${agendamento.id} em ${data} ${hora}`);

  const listagem = await requisicao(
    `${servidor.base}/api/agendamentos?escopo=todos&data=${data}&barbeiroId=${barbeiroId}`,
    { headers: { Cookie: cookieAdmin } },
  );
  if (listagem.status !== 200) {
    falhar(`listagem falhou: ${listagem.status} ${listagem.texto.slice(0, 400)}`);
  }
  const encontrado = (listagem.corpo.agendamentos || []).find((item) => item.id === agendamento.id);
  if (!encontrado) falhar(`agendamento ${agendamento.id} nao apareceu na listagem`);
  if (encontrado.status !== 'agendado') falhar(`agendamento deveria estar 'agendado', veio '${encontrado.status}'`);
  registrarLog('listagem', `agendamento ${agendamento.id} conferido`);

  await encerrar(servidor.filho, 'primeira subida');

  // ---------- segunda subida, mesmo banco ----------
  servidor = await subirServidor('segunda subida');
  const cookieAdmin2 = await loginAdmin(servidor.base);

  const listagem2 = await requisicao(
    `${servidor.base}/api/agendamentos?escopo=todos&data=${data}&barbeiroId=${barbeiroId}`,
    { headers: { Cookie: cookieAdmin2 } },
  );
  if (listagem2.status !== 200) {
    falhar(`listagem pos-reinicio falhou: ${listagem2.status} ${listagem2.texto.slice(0, 400)}`);
  }
  const persistido = (listagem2.corpo.agendamentos || []).find((item) => item.id === agendamento.id);
  if (!persistido) {
    falhar(`agendamento ${agendamento.id} NAO persistiu apos reinicio com DB ${dbPath}`);
  }
  if (persistido.status !== 'agendado') {
    falhar(`agendamento persistido com status inesperado: ${persistido.status}`);
  }
  registrarLog('persistencia', `agendamento ${agendamento.id} sobreviveu ao reinicio`);

  await encerrar(servidor.filho, 'segunda subida');
}

(async () => {
  try {
    await executar();
    await removerArquivosBanco(dbPath);
    console.log('SMOKE OK');
  } catch (erro) {
    console.error(`SMOKE FALHOU: ${erro && erro.message ? erro.message : erro}`);
    if (erro && erro.stack) console.error(erro.stack);
    if (logsDoFilho.length > 0) {
      console.error('--- ultimos logs do servidor filho ---');
      console.error(logsDoFilho.join(''));
    }
    try {
      await encerrar(processoAtual, 'limpeza apos falha');
    } catch {
      // ignora
    }
    await removerArquivosBanco(dbPath);
    console.log('SMOKE FALHOU');
    process.exitCode = 1;
  }
})();
