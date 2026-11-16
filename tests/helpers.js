'use strict';

/**
 * Helpers da suíte de QA do Barber Prime.
 * Sem dependencias externas: apenas Node 24 nativo.
 *
 * Contrato assumido: docs/CONTRATO-API.md
 *   - server.js exporta { createApp, start }
 *   - start({port, dbPath}) resolve { server, port, db, close }
 *   - cookies de sessao: Set-Cookie: bp_sess=<token>; HttpOnly; SameSite=Lax
 *   - fuso fixo America/Sao_Paulo, domingo fechado, grade de 15 min.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: esperar } = require('node:timers/promises');

const RAIZ = path.resolve(__dirname, '..');
const CAMINHO_SERVER = path.join(RAIZ, 'server.js');
const FUSO = 'America/Sao_Paulo';

// ---------------------------------------------------------------------------
// Datas e horas (America/Sao_Paulo, sem DST)
// ---------------------------------------------------------------------------

function doisDigitos(numero) {
  return String(numero).padStart(2, '0');
}

function validarFormatoData(data) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data))) {
    throw new Error(`data invalida (esperado YYYY-MM-DD): ${data}`);
  }
}

function dataSaoPaulo(referencia = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(referencia);
}

function horaSaoPaulo(referencia = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: FUSO,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(referencia);
}

/** Soma dias a uma data 'YYYY-MM-DD' sem sofrer com fuso/DST. */
function somarDias(data, dias) {
  validarFormatoData(data);
  const [ano, mes, dia] = data.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** 0 = domingo, 6 = sabado (calculado no calendario civil, sem fuso). */
function diaDaSemana(data) {
  validarFormatoData(data);
  const [ano, mes, dia] = data.split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

/**
 * Primeira data util (nao domingo) a partir de hoje+deslocamento.
 * A barbearia fecha aos domingos; sabado e dia util.
 */
function proximoDiaUtil(deslocamento = 1) {
  let data = somarDias(dataSaoPaulo(), deslocamento);
  while (diaDaSemana(data) === 0) data = somarDias(data, 1);
  return data;
}

/** Data futura a N dias (pula domingo). Aceita N negativo? Nao: use somarDias. */
function dataFutura(dias = 10) {
  if (!Number.isInteger(dias) || dias < 0) {
    throw new Error(`dias deve ser inteiro >= 0: ${dias}`);
  }
  return proximoDiaUtil(dias);
}

/** Proxima ocorrencia de domingo (para testar dia fechado). */
function proximoDomingo() {
  let data = somarDias(dataSaoPaulo(), 1);
  while (diaDaSemana(data) !== 0) data = somarDias(data, 1);
  return data;
}

function horaParaMinutos(hora) {
  const partes = String(hora).split(':').map(Number);
  if (partes.length !== 2 || partes.some(Number.isNaN)) {
    throw new Error(`hora invalida (esperado HH:MM): ${hora}`);
  }
  return partes[0] * 60 + partes[1];
}

function minutosParaHora(minutos) {
  return `${doisDigitos(Math.floor(minutos / 60))}:${doisDigitos(minutos % 60)}`;
}

function somarMinutos(hora, minutos) {
  return minutosParaHora(horaParaMinutos(hora) + minutos);
}

/**
 * Converte 'YYYY-MM-DD HH:MM' em minutos absolutos (epoch em minutos)
 * para comparacoes de sobreposicao, independente de fuso.
 */
function inicioParaMinutosAbsolutos(inicio) {
  const texto = String(inicio);
  const [data, hora] = texto.split(' ');
  if (!data || !hora) throw new Error(`inicio invalido (esperado YYYY-MM-DD HH:MM): ${inicio}`);
  const [ano, mes, dia] = data.split('-').map(Number);
  return Math.floor(Date.UTC(ano, mes - 1, dia) / 60000) + horaParaMinutos(hora);
}

/** Limite de antecedencia minima: agora + 30 min, em HH:MM. */
function limiteAntecedenciaMinima(referencia = new Date()) {
  return somarMinutos(horaSaoPaulo(referencia), 30);
}

// ---------------------------------------------------------------------------
// Cliente HTTP com cookie jar por instancia
// ---------------------------------------------------------------------------

class ClienteHTTP {
  constructor(baseUrl, rotulo = 'cliente-http') {
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.rotulo = rotulo;
    this.cookies = new Map();
    this.ultimaResposta = null;
  }

  cabecalhoCookies() {
    return [...this.cookies.entries()].map(([nome, valor]) => `${nome}=${valor}`).join('; ');
  }

  definirCookie(nome, valor) {
    this.cookies.set(nome, valor);
  }

  limparCookies() {
    this.cookies.clear();
  }

  aplicarCabecalhoCookies(cabecalho) {
    aplicarCookies(this, cabecalho);
  }

  async requisicao(metodo, caminho, corpo, opcoes = {}) {
    const headers = { Accept: 'application/json', ...(opcoes.headers || {}) };
    let body;

    if (Object.prototype.hasOwnProperty.call(opcoes, 'bruto')) {
      body = opcoes.bruto;
      if (!headers['Content-Type'] && opcoes.contentType !== null) {
        headers['Content-Type'] = opcoes.contentType || 'application/json';
      }
    } else if (corpo !== undefined) {
      body = JSON.stringify(corpo);
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    }

    const cookie = this.cabecalhoCookies();
    if (cookie) headers.Cookie = cookie;

    const resposta = await fetch(this.baseUrl + caminho, {
      method: metodo,
      headers,
      body,
      redirect: 'manual',
      signal: opcoes.signal,
    });

    const setCookies = typeof resposta.headers.getSetCookie === 'function'
      ? resposta.headers.getSetCookie()
      : (resposta.headers.get('set-cookie') ? [resposta.headers.get('set-cookie')] : []);

    for (const bruto of setCookies) {
      const par = bruto.split(';')[0];
      const separador = par.indexOf('=');
      if (separador <= 0) continue;
      const nome = par.slice(0, separador).trim();
      const valor = par.slice(separador + 1).trim();
      if (valor === '' || /max-age\s*=\s*0/i.test(bruto)) this.cookies.delete(nome);
      else this.cookies.set(nome, valor);
    }

    const texto = await resposta.text();
    let corpoResposta;
    if (texto !== '') {
      try {
        corpoResposta = JSON.parse(texto);
      } catch {
        corpoResposta = undefined;
      }
    } else {
      corpoResposta = null;
    }

    const resultado = {
      status: resposta.status,
      ok: resposta.ok,
      headers: resposta.headers,
      texto,
      corpo: corpoResposta,
      setCookies,
      resposta,
    };
    this.ultimaResposta = resultado;
    return resultado;
  }

  get(caminho, opcoes) {
    return this.requisicao('GET', caminho, undefined, opcoes);
  }

  post(caminho, corpo, opcoes) {
    return this.requisicao('POST', caminho, corpo, opcoes);
  }

  patch(caminho, corpo, opcoes) {
    return this.requisicao('PATCH', caminho, corpo, opcoes);
  }

  put(caminho, corpo, opcoes) {
    return this.requisicao('PUT', caminho, corpo, opcoes);
  }

  del(caminho, corpo, opcoes) {
    return this.requisicao('DELETE', caminho, corpo, opcoes);
  }

  async login(login, senha) {
    return this.post('/api/login', { login, senha });
  }
}

function novoCliente(baseUrl, rotulo) {
  return new ClienteHTTP(baseUrl, rotulo);
}

function aplicarCookies(clienteHttp, cabecalho) {
  for (const parte of String(cabecalho || '').split(';')) {
    const separador = parte.indexOf('=');
    if (separador <= 0) continue;
    clienteHttp.cookies.set(parte.slice(0, separador).trim(), parte.slice(separador + 1).trim());
  }
  return clienteHttp;
}

/** Le e converte um Response (fetch global) em JSON, com erro claro. */
async function json(resposta) {
  const texto = await resposta.text();
  if (texto === '') return null;
  try {
    return JSON.parse(texto);
  } catch {
    throw new Error(`resposta nao e JSON valido: ${texto.slice(0, 400)}`);
  }
}

// ---------------------------------------------------------------------------
// Subida do app com banco temporario
// ---------------------------------------------------------------------------

function caminhoBancoTemporario(prefixo = 'barberprime-qa') {
  return path.join(
    os.tmpdir(),
    `${prefixo}-${process.pid}-${Date.now()}-${crypto.randomUUID()}.db`,
  );
}

async function removerArquivosBanco(dbPath) {
  if (!dbPath || dbPath === ':memory:') return;
  const variantes = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`];
  for (let tentativa = 0; tentativa < 8; tentativa += 1) {
    let restantes = 0;
    for (const arquivo of variantes) {
      try {
        fs.rmSync(arquivo, { force: true });
      } catch {
        if (fs.existsSync(arquivo)) restantes += 1;
      }
    }
    if (restantes === 0) return;
    await esperar(60);
  }
}

/**
 * Descarta o cache de modulos do servidor antes de cada app.
 * O backend guarda rate limits em estado de modulo; sem isso, apps diferentes
 * dentro do mesmo processo de teste herdariam os baldes do teste anterior.
 * Nao altera o codigo de producao: apenas isola a instancia de teste.
 */
function limparCacheModulosDoServidor() {
  const raizSrc = path.join(RAIZ, 'src') + path.sep;
  for (const chave of Object.keys(require.cache)) {
    if (chave === CAMINHO_SERVER || chave.startsWith(raizSrc)) {
      delete require.cache[chave];
    }
  }
}

/**
 * Sobe o servidor real em porta 0 com banco temporario.
 * - dbPath informado: reaproveita o arquivo (testes de persistencia) e NAO apaga no close.
 * - sem dbPath: gera arquivo unico em os.tmpdir() e apaga no close.
 */
async function startTestApp(opcoes = {}) {
  if (!fs.existsSync(CAMINHO_SERVER)) {
    throw new Error(
      `server.js nao encontrado em ${CAMINHO_SERVER}. O backend ainda nao existe; a suite nao pode executar.`,
    );
  }

  limparCacheModulosDoServidor();
  const modulo = require(CAMINHO_SERVER);
  if (typeof modulo.start !== 'function') {
    throw new Error('server.js nao exporta start({port,dbPath}) conforme docs/CONTRATO-API.md');
  }

  const bancoGerado = !opcoes.dbPath;
  const dbPath = opcoes.dbPath || caminhoBancoTemporario();
  const app = await modulo.start({ port: 0, dbPath });

  if (!app || typeof app.port !== 'number' || !app.server) {
    throw new Error('start() nao devolveu {server, port, db, close} conforme docs/CONTRATO-API.md');
  }

  const base = `http://127.0.0.1:${app.port}`;
  let fechado = false;

  async function close() {
    if (fechado) return;
    fechado = true;
    try {
      if (typeof app.close === 'function') await app.close();
    } finally {
      if (bancoGerado || opcoes.removerBanco) await removerArquivosBanco(dbPath);
    }
  }

  return {
    app,
    server: app.server,
    db: app.db,
    port: app.port,
    base,
    dbPath,
    close,
    novoCliente: (rotulo) => novoCliente(base, rotulo),
  };
}

// ---------------------------------------------------------------------------
// Contas do seed e cadastro
// ---------------------------------------------------------------------------

const CONTAS_DEMO = {
  admin: { login: 'admin', senha: 'admin123', papel: 'admin' },
  barbeiro1: { login: 'barbeiro1', senha: 'barbeiro123', papel: 'barbeiro', barbeiroId: 1 },
  barbeiro2: { login: 'barbeiro2', senha: 'barbeiro123', papel: 'barbeiro', barbeiroId: 2 },
  barbeiro3: { login: 'barbeiro3', senha: 'barbeiro123', papel: 'barbeiro', barbeiroId: 3 },
  barbeiro4: { login: 'barbeiro4', senha: 'barbeiro123', papel: 'barbeiro', barbeiroId: 4 },
  cliente1: { login: '11987650001', senha: '1234', papel: 'cliente', nome: 'Ana Souza' },
  cliente2: { login: '11987650002', senha: '1234', papel: 'cliente', nome: 'Carlos Lima' },
  cliente3: { login: '11987650003', senha: '1234', papel: 'cliente', nome: 'Marina Alves' },
  cliente4: { login: '11987650004', senha: '1234', papel: 'cliente', nome: 'Pedro Santos' },
};

async function entrar(baseUrl, conta = 'admin') {
  const dados = typeof conta === 'string' ? CONTAS_DEMO[conta] : conta;
  if (!dados) throw new Error(`conta de seed desconhecida: ${conta}`);
  const clienteHttp = novoCliente(baseUrl, `login:${dados.login}`);
  const resposta = await clienteHttp.post('/api/login', {
    login: dados.login,
    senha: dados.senha,
  });
  if (resposta.status === 200) {
    return { cliente: clienteHttp, cli: clienteHttp, resposta, usuario: resposta.corpo && resposta.corpo.usuario };
  }

  // O contrato tambem define o login idempotente do cliente em POST /api/clientes
  // (telefone existente + PIN correto -> 200 + cookie). Usamos esse caminho para
  // obter sessao de cliente quando /api/login nao aceita o telefone como login.
  // O defeito de /api/login para clientes continua coberto em auth.test.js.
  if (dados.papel === 'cliente') {
    const alternativa = await clienteHttp.post('/api/clientes', {
      nome: 'Cliente',
      sobrenome: 'Demo',
      telefone: dados.login,
      pin: dados.senha,
    });
    if (alternativa.status === 200 || alternativa.status === 201) {
      return {
        cliente: clienteHttp,
        cli: clienteHttp,
        resposta: alternativa,
        usuario: alternativa.corpo && alternativa.corpo.usuario,
        viaCadastroIdempotente: true,
      };
    }
    throw new Error(
      `login/cadastro do cliente ${dados.login} falhou: login=${resposta.status} cadastro=${alternativa.status} corpo=${alternativa.texto.slice(0, 300)}`,
    );
  }

  throw new Error(
    `login de ${dados.login} falhou: status ${resposta.status} corpo=${resposta.texto.slice(0, 300)}`,
  );
}

let contadorTelefone = 0;

/** Telefone brasileiro de 11 digitos, unico dentro do processo. */
function telefoneUnico() {
  contadorTelefone += 1;
  const sequencial = String(contadorTelefone % 10000).padStart(4, '0');
  const aleatorio = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `119${sequencial}${aleatorio}`;
}

/** Cadastra um cliente novo e devolve { cliente, cli, telefone, usuario, resposta }. */
async function cadastrarCliente(baseUrl, dados = {}) {
  const clienteHttp = novoCliente(baseUrl, 'cliente-novo');
  const telefone = dados.telefone || telefoneUnico();
  const corpo = {
    nome: 'Cliente',
    sobrenome: 'De Teste',
    telefone,
    pin: '1234',
    ...dados,
  };
  const resposta = await clienteHttp.post('/api/clientes', corpo);
  if (resposta.status !== 201) {
    throw new Error(
      `cadastro de cliente falhou: status ${resposta.status} corpo=${resposta.texto.slice(0, 300)}`,
    );
  }
  return {
    cliente: clienteHttp,
    cli: clienteHttp,
    telefone,
    usuario: resposta.corpo && resposta.corpo.usuario,
    resposta,
  };
}

// ---------------------------------------------------------------------------
// Atalhos de agendamento e disponibilidade
// ---------------------------------------------------------------------------

function montarQuery(parametros = {}) {
  const partes = [];
  for (const [chave, valor] of Object.entries(parametros)) {
    if (valor === undefined || valor === null) continue;
    partes.push(`${encodeURIComponent(chave)}=${encodeURIComponent(valor)}`);
  }
  return partes.length ? `?${partes.join('&')}` : '';
}

function criarAgendamento(clienteHttp, opcoes = {}) {
  const corpo = {
    servicoId: 1,
    barbeiroId: 3,
    data: dataFutura(20),
    hora: '15:00',
    ...opcoes,
  };
  return clienteHttp.post('/api/agendamentos', corpo);
}

function reagendar(clienteHttp, id, opcoes = {}) {
  return clienteHttp.patch(`/api/agendamentos/${id}/reagendar`, opcoes);
}

function cancelar(clienteHttp, id) {
  return clienteHttp.patch(`/api/agendamentos/${id}/cancelar`, {});
}

function mudarStatus(clienteHttp, id, status) {
  return clienteHttp.patch(`/api/agendamentos/${id}/status`, { status });
}

function listarAgendamentos(clienteHttp, parametros = {}) {
  return clienteHttp.get(`/api/agendamentos${montarQuery(parametros)}`);
}

function consultarDisponibilidade(clienteHttp, parametros = {}) {
  return clienteHttp.get(`/api/disponibilidade${montarQuery(parametros)}`);
}

function duracaoDoAgendamento(agendamento) {
  const duracao = agendamento && (agendamento.duracaoMin ?? (agendamento.servico && agendamento.servico.duracaoMin));
  return Number(duracao || 0);
}

function intervaloDoAgendamento(agendamento) {
  const inicio = inicioParaMinutosAbsolutos(agendamento.inicio);
  const fim = agendamento.fim
    ? inicioParaMinutosAbsolutos(agendamento.fim)
    : inicio + duracaoDoAgendamento(agendamento);
  return { inicio, fim };
}

/**
 * Retorna pares de agendamentos ATIVOS (status 'agendado') do mesmo barbeiro
 * cujos intervalos se sobrepoem. Lista vazia = nenhuma sobreposicao.
 */
function encontrarSobreposicoes(agendamentos) {
  const ativos = (agendamentos || []).filter(
    (a) => a && a.status === 'agendado' && a.inicio && (a.barbeiro && a.barbeiro.id) !== undefined,
  );
  const porBarbeiro = new Map();
  for (const agendamento of ativos) {
    const id = agendamento.barbeiro.id;
    if (!porBarbeiro.has(id)) porBarbeiro.set(id, []);
    porBarbeiro.get(id).push(agendamento);
  }

  const conflitos = [];
  for (const [barbeiroId, lista] of porBarbeiro.entries()) {
    const ordenada = [...lista].sort(
      (a, b) => intervaloDoAgendamento(a).inicio - intervaloDoAgendamento(b).inicio,
    );
    let maiorFim = null;
    let referencia = null;
    for (const atual of ordenada) {
      const { inicio, fim } = intervaloDoAgendamento(atual);
      if (maiorFim !== null && inicio < maiorFim) {
        conflitos.push({
          barbeiroId,
          primeiro: referencia && referencia.id,
          segundo: atual.id,
          detalhe: `${referencia && referencia.inicio} x ${atual.inicio}`,
        });
      }
      if (maiorFim === null || fim > maiorFim) {
        maiorFim = fim;
        referencia = atual;
      }
    }
  }
  return conflitos;
}

// ---------------------------------------------------------------------------
// Banco (leitura via node:sqlite)
// ---------------------------------------------------------------------------

function consultarBanco(dbPath, sql, parametros = []) {
  const { DatabaseSync } = require('node:sqlite');
  const banco = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return banco.prepare(sql).all(...parametros);
  } finally {
    banco.close();
  }
}

/** Le agendamentos direto do banco; valida que a coluna `inicio` existe. */
function agendamentosDoBanco(dbPath) {
  const linhas = consultarBanco(dbPath, 'SELECT * FROM agendamentos');
  if (linhas.length > 0 && !Object.prototype.hasOwnProperty.call(linhas[0], 'inicio')) {
    throw new Error(
      `tabela agendamentos sem coluna 'inicio' (contrato). Colunas: ${Object.keys(linhas[0]).join(', ')}`,
    );
  }
  return linhas;
}

function statusDaLinha(linha) {
  return linha.status === undefined ? undefined : linha.status;
}

function barbeiroDaLinha(linha) {
  return linha.barbeiro_id !== undefined ? linha.barbeiro_id : linha.barbeiroId;
}

function contarAtivosNoSlotBanco(dbPath, barbeiroId, inicio) {
  return agendamentosDoBanco(dbPath).filter(
    (linha) => statusDaLinha(linha) === 'agendado'
      && barbeiroDaLinha(linha) === barbeiroId
      && linha.inicio === inicio,
  ).length;
}

// ---------------------------------------------------------------------------
// Utilidades de assercao / diagnostico
// ---------------------------------------------------------------------------

function resumoStatus(listaDeStatus) {
  const contagem = {};
  for (const status of listaDeStatus) contagem[status] = (contagem[status] || 0) + 1;
  return JSON.stringify(contagem);
}

function chavesDe(valor, acumulador = []) {
  if (Array.isArray(valor)) {
    for (const item of valor) chavesDe(item, acumulador);
  } else if (valor && typeof valor === 'object') {
    for (const [chave, item] of Object.entries(valor)) {
      acumulador.push(chave);
      chavesDe(item, acumulador);
    }
  }
  return acumulador;
}

/** true se qualquer objeto (inclusive aninhado) tem chave pin/senha/senha_hash. */
function contemCampoSensivel(valor) {
  return chavesDe(valor).some((chave) => /^(pin|senha|senha_hash|senhahash)$/i.test(chave));
}

function textoDoCorpo(resultado) {
  return resultado && typeof resultado.texto === 'string' ? resultado.texto : '';
}

module.exports = {
  FUSO,
  RAIZ,
  CAMINHO_SERVER,
  ClienteHTTP,

  dataSaoPaulo,
  horaSaoPaulo,
  somarDias,
  diaDaSemana,
  proximoDiaUtil,
  dataFutura,
  proximoDomingo,
  horaParaMinutos,
  minutosParaHora,
  somarMinutos,
  inicioParaMinutosAbsolutos,
  limiteAntecedenciaMinima,

  novoCliente,
  aplicarCookies,
  json,
  caminhoBancoTemporario,
  removerArquivosBanco,
  startTestApp,

  CONTAS_DEMO,
  entrar,
  telefoneUnico,
  cadastrarCliente,

  montarQuery,
  criarAgendamento,
  reagendar,
  cancelar,
  mudarStatus,
  listarAgendamentos,
  consultarDisponibilidade,
  duracaoDoAgendamento,
  intervaloDoAgendamento,
  encontrarSobreposicoes,

  consultarBanco,
  agendamentosDoBanco,
  contarAtivosNoSlotBanco,

  resumoStatus,
  chavesDe,
  contemCampoSensivel,
  textoDoCorpo,
};
