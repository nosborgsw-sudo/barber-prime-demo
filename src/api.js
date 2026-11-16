'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const util = require('./util');
const auth = require('./auth');
const avail = require('./availability');
const seed = require('./seed');
const { transacao, comoErroHttp } = require('./db');

const {
  ErroHttp,
  agoraLocal,
  validarData,
  validarHora,
  horaParaMin,
  minParaHora,
  inteiroValido,
  inteiroPositivo,
  booleanoValido,
  listaStrings,
  jsonSeguro,
  rotuloUsuario,
  normalizarTelefone,
  textoValido,
  diferencaDias,
  listarDias,
} = util;

const LIMITE_CORPO = 100 * 1024;
const MAX_DIAS_RANGE = 366;

const TIPOS_ESTATICOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

// ---------------------------------------------------------------------------
// Rate limit em memória
// ---------------------------------------------------------------------------

const BALDES = new Map();

const LIMITES = {
  login: { max: 10, janelaMs: 5 * 60 * 1000 },
  cadastro: { max: 5, janelaMs: 60 * 1000 },
  mutacao: { max: 60, janelaMs: 60 * 1000 },
};

function ipDaRequisicao(req) {
  return (
    (req.socket && req.socket.remoteAddress) ||
    (req.connection && req.connection.remoteAddress) ||
    'desconhecido'
  );
}

function podarBaldes(agora) {
  if (BALDES.size < 2000) return;
  for (const [chave, balde] of BALDES) {
    if (agora - balde.inicio > 10 * 60 * 1000) BALDES.delete(chave);
  }
}

function limitar(req, tipo) {
  const cfg = LIMITES[tipo];
  const agora = Date.now();
  const chave = `${tipo}|${ipDaRequisicao(req)}`;
  let balde = BALDES.get(chave);
  if (!balde || agora - balde.inicio >= cfg.janelaMs) {
    balde = { inicio: agora, contagem: 0 };
    BALDES.set(chave, balde);
  }
  if (balde.contagem >= cfg.max) {
    throw new ErroHttp(
      429,
      'limite_excedido',
      'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
    );
  }
  balde.contagem += 1;
  podarBaldes(agora);
  return chave;
}

function liberarLimite(chave) {
  if (chave) BALDES.delete(chave);
}

/**
 * Limite de mutações gerais (60/min por IP).
 * A cota conta escritas bem-sucedidas: requisições que terminam em 409/422
 * (por exemplo, 100 reservas simultâneas no mesmo slot) não podem ser
 * bloqueadas pelo limitador, pois o contrato exige que todas cheguem à
 * revalidação transacional. Rejeitamos a requisição quando a cota de
 * sucessos da janela já foi atingida.
 */
function verificarLimiteMutacao(req) {
  const cfg = LIMITES.mutacao;
  const agora = Date.now();
  const chave = `mutacao|${ipDaRequisicao(req)}`;
  let balde = BALDES.get(chave);
  if (!balde || agora - balde.inicio >= cfg.janelaMs) {
    balde = { inicio: agora, contagem: 0 };
    BALDES.set(chave, balde);
  }
  if (balde.contagem >= cfg.max) {
    throw new ErroHttp(
      429,
      'limite_excedido',
      'Muitas operações. Aguarde um minuto e tente novamente.'
    );
  }
  podarBaldes(agora);
  return chave;
}

function registrarMutacaoSucesso(chave) {
  const balde = BALDES.get(chave);
  if (!balde) return;
  if (Date.now() - balde.inicio < LIMITES.mutacao.janelaMs) {
    balde.contagem += 1;
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function enviarJson(res, status, obj, headers = {}) {
  if (res.writableEnded) return;
  const corpo = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(corpo),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(corpo);
}

function enviar204(res, headers = {}) {
  if (res.writableEnded) return;
  res.writeHead(204, { 'Cache-Control': 'no-store', ...headers });
  res.end();
}

function enviarTexto(res, status, texto, tipo = 'text/plain; charset=utf-8') {
  if (res.writableEnded) return;
  const corpo = String(texto);
  res.writeHead(status, {
    'Content-Type': tipo,
    'Content-Length': Buffer.byteLength(corpo),
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(corpo);
}

function tratarErro(res, erro) {
  if (res.writableEnded) return;
  const http = comoErroHttp(erro);
  if (http) {
    enviarJson(res, http.status, { erro: http.erro, mensagem: http.mensagem });
    return;
  }
  console.error('[barber-prime] erro:', erro && erro.message ? erro.message : String(erro));
  enviarJson(res, 500, {
    erro: 'erro_interno',
    mensagem: 'Erro interno. Tente novamente.',
  });
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    let excedeu = false;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > LIMITE_CORPO) {
        excedeu = true;
        return; // continua drenando o socket, sem guardar
      }
      partes.push(chunk);
    });
    req.on('end', () => {
      if (excedeu) {
        reject(new ErroHttp(413, 'carga_muito_grande', 'O corpo da requisição excede 100 KB.'));
        return;
      }
      resolve(Buffer.concat(partes).toString('utf8'));
    });
    req.on('error', (erro) => {
      reject(new ErroHttp(400, 'requisicao_invalida', erro.message || 'Falha ao ler o corpo.'));
    });
  });
}

async function lerCorpoJson(req) {
  const texto = await lerCorpo(req);
  if (!texto.trim()) return {};
  let valor;
  try {
    valor = JSON.parse(texto);
  } catch {
    throw new ErroHttp(400, 'json_invalido', 'Corpo JSON inválido.');
  }
  if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) {
    throw new ErroHttp(400, 'json_invalido', 'O corpo da requisição deve ser um objeto JSON.');
  }
  return valor;
}

function exigirConteudoJson(req) {
  const tipo = String(req.headers['content-type'] || '').trim();
  if (!/^application\/json(?:\s*;|$)/i.test(tipo)) {
    throw new ErroHttp(
      415,
      'tipo_conteudo_invalido',
      'Envie Content-Type: application/json.'
    );
  }
}

function checarOrigem(req) {
  const host = String(req.headers.host || '').toLowerCase();
  for (const nome of ['origin', 'referer']) {
    const valor = req.headers[nome];
    if (!valor) continue;
    let origemHost;
    try {
      origemHost = new URL(String(valor)).host.toLowerCase();
    } catch {
      throw new ErroHttp(403, 'sem_permissao', 'Origem da requisição não autorizada.');
    }
    if (!host || origemHost !== host) {
      throw new ErroHttp(403, 'sem_permissao', 'Origem da requisição não autorizada.');
    }
  }
}

// ---------------------------------------------------------------------------
// Serialização
// ---------------------------------------------------------------------------

function nomeCompleto(nome, sobrenome) {
  return [nome, sobrenome].filter(Boolean).join(' ').trim();
}

function barbeiroObj(linha) {
  return {
    id: Number(linha.id),
    nome: nomeCompleto(linha.nome, linha.sobrenome),
    apelido: linha.apelido || null,
    especialidades: jsonSeguro(linha.especialidades, []),
    bio: linha.bio || '',
    fotoUrl: linha.foto_url || null,
    ativo: Boolean(linha.ativo),
  };
}

function servicoObj(linha) {
  return {
    id: Number(linha.id),
    nome: linha.nome,
    descricao: linha.descricao || '',
    precoCentavos: Number(linha.preco_centavos),
    duracaoMin: Number(linha.duracao_min),
    ativo: Boolean(linha.ativo),
  };
}

function jornadaObj(linha) {
  return {
    diaSemana: Number(linha.dia_semana),
    ativo: Boolean(linha.ativo),
    inicio: linha.inicio,
    fim: linha.fim,
    intervaloInicio: linha.intervalo_inicio || null,
    intervaloFim: linha.intervalo_fim || null,
  };
}

function bloqueioObj(linha) {
  return {
    id: Number(linha.id),
    barbeiroId: linha.barbeiro_id === null ? null : Number(linha.barbeiro_id),
    data: linha.data,
    horaInicio: linha.hora_inicio,
    horaFim: linha.hora_fim,
    motivo: linha.motivo || '',
  };
}

const SQL_AGENDAMENTO = `
  SELECT a.*,
         s.nome AS servico_nome,
         b.id AS barbeiro_id,
         ub.nome AS barbeiro_nome,
         ub.sobrenome AS barbeiro_sobrenome,
         c.nome AS cliente_nome,
         c.sobrenome AS cliente_sobrenome,
         c.telefone AS cliente_telefone
    FROM agendamentos a
    JOIN servicos s ON s.id = a.servico_id
    JOIN barbeiros b ON b.id = a.barbeiro_id
    JOIN usuarios ub ON ub.id = b.usuario_id
    JOIN usuarios c ON c.id = a.cliente_id
`;

function agendamentoObj(linha) {
  return {
    id: Number(linha.id),
    status: linha.status,
    inicio: linha.inicio,
    fim: linha.fim,
    data: linha.data,
    hora: linha.hora,
    duracaoMin: Number(linha.duracao_min),
    servico: {
      id: Number(linha.servico_id),
      nome: linha.servico_nome,
      precoCentavos: Number(linha.preco_centavos),
      duracaoMin: Number(linha.duracao_min),
    },
    barbeiro: {
      id: Number(linha.barbeiro_id),
      nome: nomeCompleto(linha.barbeiro_nome, linha.barbeiro_sobrenome),
    },
    cliente: {
      id: Number(linha.cliente_id),
      nome: linha.cliente_nome,
      sobrenome: linha.cliente_sobrenome || '',
      telefone: linha.cliente_telefone || null,
    },
    criadoEm: linha.criado_em,
    atualizadoEm: linha.atualizado_em,
  };
}

function buscarAgendamento(db, id) {
  const linha = db.prepare(`${SQL_AGENDAMENTO} WHERE a.id = ?`).get(id);
  return linha ? agendamentoObj(linha) : null;
}

function buscarAgendamentoBruto(db, id) {
  return db.prepare('SELECT * FROM agendamentos WHERE id = ?').get(id) || null;
}

function buscarBarbeiroAgenda(db, barbeiroId) {
  return (
    db
      .prepare(
        `SELECT b.id, u.nome, u.sobrenome
           FROM barbeiros b
           JOIN usuarios u ON u.id = b.usuario_id
          WHERE b.id = ?`
      )
      .get(barbeiroId) || null
  );
}

function configObj(db) {
  const linhas = db.prepare('SELECT chave, valor FROM configuracoes').all();
  const mapa = {};
  for (const linha of linhas) mapa[linha.chave] = linha.valor;
  const padrao = seed.CONFIG_INICIAL;
  const numero = (chave, fallback) => {
    const n = Number(mapa[chave]);
    return Number.isFinite(n) ? n : fallback;
  };
  const feriados = db
    .prepare('SELECT data, descricao FROM feriados ORDER BY data')
    .all()
    .map((f) => ({ data: f.data, descricao: f.descricao }));
  return {
    nomeBarbearia: mapa.nomeBarbearia || padrao.nomeBarbearia,
    endereco: mapa.endereco || padrao.endereco,
    telefoneContato: mapa.telefoneContato || padrao.telefoneContato,
    horarioFuncionamento: mapa.horarioFuncionamento || padrao.horarioFuncionamento,
    antecedenciaMinMin: numero('antecedenciaMinMin', 30),
    antecedenciaMaxDias: numero('antecedenciaMaxDias', 365),
    fuso: mapa.fuso || padrao.fuso,
    feriados,
  };
}

function registrarHistorico(db, { agendamentoId, acao, de = null, para = null, usuarioId = null, detalhe = null }) {
  db.prepare(
    `INSERT INTO historico_agendamentos
       (agendamento_id, acao, de_status, para_status, usuario_id, em, detalhe)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(agendamentoId, acao, de, para, usuarioId, agoraLocal().texto, detalhe);
}

function auditar(db, usuario, acao, detalhe = null) {
  const rotulo = typeof usuario === 'string' ? usuario : rotuloUsuario(usuario);
  db.prepare('INSERT INTO auditoria (usuario, acao, detalhe, em) VALUES (?, ?, ?, ?)').run(
    rotulo,
    acao,
    detalhe,
    agoraLocal().texto
  );
}

// ---------------------------------------------------------------------------
// Validações de payload
// ---------------------------------------------------------------------------

function exigirNome(valor, campo, { min = 2, max = 60, obrigatorio = true } = {}) {
  if (valor === undefined || valor === null) {
    if (!obrigatorio) return null;
    throw new ErroHttp(422, 'validacao', `Informe ${campo}.`);
  }
  if (valor === '') {
    if (min === 0) return '';
    if (!obrigatorio) return '';
    throw new ErroHttp(422, 'validacao', `Informe ${campo}.`);
  }
  const texto = textoValido(valor, min, max);
  if (texto === null) {
    throw new ErroHttp(422, 'validacao', `${campo} deve ter entre ${min} e ${max} caracteres.`);
  }
  return texto;
}

function exigirTextoOpcional(valor, campo, max) {
  if (valor === undefined || valor === null) return undefined;
  if (typeof valor !== 'string') {
    throw new ErroHttp(422, 'validacao', `${campo} inválido.`);
  }
  const texto = valor.trim();
  if (texto.length > max) {
    throw new ErroHttp(422, 'validacao', `${campo} deve ter no máximo ${max} caracteres.`);
  }
  return texto;
}

function exigirInteiro(valor, campo, { min = null, max = null } = {}) {
  const n = inteiroValido(valor);
  if (n === null) throw new ErroHttp(422, 'validacao', `${campo} inválido.`);
  if (min !== null && n < min) throw new ErroHttp(422, 'validacao', `${campo} inválido.`);
  if (max !== null && n > max) throw new ErroHttp(422, 'validacao', `${campo} inválido.`);
  return n;
}

function exigirHora(valor, campo) {
  if (!validarHora(valor)) {
    throw new ErroHttp(422, 'validacao', `${campo} deve estar no formato HH:MM.`);
  }
  return valor;
}

function exigirData(valor, campo = 'data') {
  if (!validarData(valor)) {
    throw new ErroHttp(422, 'validacao', `${campo} inválida. Use YYYY-MM-DD.`);
  }
  return valor;
}

function exigirUsuarioExistente(db, usuarioId) {
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(usuarioId);
  if (!usuario || usuario.papel !== 'cliente' || !Number(usuario.ativo)) {
    throw new ErroHttp(422, 'validacao', 'Cliente inválido.');
  }
  return usuario;
}

function exigirBarbeiroAtivo(db, barbeiroId) {
  const barbeiro = db
    .prepare(
      `SELECT b.*, u.nome, u.sobrenome, u.login, u.ativo AS usuario_ativo
         FROM barbeiros b
         JOIN usuarios u ON u.id = b.usuario_id
        WHERE b.id = ?`
    )
    .get(barbeiroId);
  if (!barbeiro) throw new ErroHttp(404, 'nao_encontrado', 'Barbeiro não encontrado.');
  if (!Number(barbeiro.ativo) || !Number(barbeiro.usuario_ativo)) {
    throw new ErroHttp(422, 'validacao', 'Barbeiro inativo.');
  }
  return barbeiro;
}

function autorizarAgendamento(usuario, bruto) {
  if (usuario.papel === 'admin') return;
  if (usuario.papel === 'cliente' && Number(bruto.cliente_id) === Number(usuario.id)) return;
  if (
    usuario.papel === 'barbeiro' &&
    usuario.barbeiroId &&
    Number(bruto.barbeiro_id) === Number(usuario.barbeiroId)
  ) {
    return;
  }
  throw new ErroHttp(403, 'sem_permissao', 'Você não tem permissão sobre este agendamento.');
}

function validarNovoBarbeiro(corpo, { senhaObrigatoria = true } = {}) {
  const nome = exigirNome(corpo.nome, 'nome');
  const sobrenome = exigirNome(corpo.sobrenome, 'sobrenome', { min: 0, max: 60 });
  const login = exigirNome(corpo.login, 'login', { min: 3, max: 60 });
  if (!/^[A-Za-z0-9._@-]+$/.test(login)) {
    throw new ErroHttp(422, 'validacao', 'login contém caracteres inválidos.');
  }
  let senha;
  if (corpo.senha !== undefined || senhaObrigatoria) {
    if (typeof corpo.senha !== 'string' || corpo.senha.length < 6 || corpo.senha.length > 200) {
      throw new ErroHttp(422, 'validacao', 'senha deve ter entre 6 e 200 caracteres.');
    }
    senha = corpo.senha;
  }
  const apelido = exigirTextoOpcional(corpo.apelido, 'apelido', 60);
  let especialidades;
  if (corpo.especialidades !== undefined) {
    especialidades = listaStrings(corpo.especialidades, 20, 60);
    if (especialidades === null) {
      throw new ErroHttp(422, 'validacao', 'especialidades deve ser uma lista de textos.');
    }
  }
  const bio = exigirTextoOpcional(corpo.bio, 'bio', 500);
  const fotoUrl = exigirTextoOpcional(corpo.fotoUrl, 'fotoUrl', 500);
  return { nome, sobrenome, login, senha, apelido, especialidades, bio, fotoUrl };
}

function validarServico(corpo, { parcial = false } = {}) {
  const saida = {};
  if (!parcial || corpo.nome !== undefined) {
    saida.nome = exigirNome(corpo.nome, 'nome', { min: 2, max: 80 });
  }
  if (!parcial || corpo.descricao !== undefined) {
    saida.descricao = exigirTextoOpcional(corpo.descricao, 'descricao', 500) ?? '';
  }
  if (!parcial || corpo.precoCentavos !== undefined) {
    saida.precoCentavos = exigirInteiro(corpo.precoCentavos, 'precoCentavos', {
      min: 0,
      max: 100000000,
    });
  }
  if (!parcial || corpo.duracaoMin !== undefined) {
    saida.duracaoMin = exigirInteiro(corpo.duracaoMin, 'duracaoMin', { min: 1, max: 600 });
  }
  if (corpo.ativo !== undefined) {
    const ativo = booleanoValido(corpo.ativo);
    if (ativo === null) throw new ErroHttp(422, 'validacao', 'ativo inválido.');
    saida.ativo = ativo;
  }
  return saida;
}

function validarJornadas(corpo) {
  if (!Array.isArray(corpo.jornadas)) {
    throw new ErroHttp(422, 'validacao', 'jornadas deve ser uma lista.');
  }
  if (corpo.jornadas.length > 7) {
    throw new ErroHttp(422, 'validacao', 'jornadas aceita no máximo 7 dias.');
  }
  const vistos = new Set();
  const saida = [];
  for (const item of corpo.jornadas) {
    if (!item || typeof item !== 'object') {
      throw new ErroHttp(422, 'validacao', 'Jornada inválida.');
    }
    const dia = exigirInteiro(item.diaSemana, 'diaSemana', { min: 0, max: 6 });
    if (vistos.has(dia)) {
      throw new ErroHttp(422, 'validacao', 'diaSemana repetido nas jornadas.');
    }
    vistos.add(dia);
    const ativo = booleanoValido(item.ativo);
    if (ativo === null) throw new ErroHttp(422, 'validacao', 'ativo da jornada inválido.');
    if (!ativo) {
      saida.push({
        diaSemana: dia,
        ativo: false,
        inicio: '09:00',
        fim: '18:00',
        intervaloInicio: null,
        intervaloFim: null,
      });
      continue;
    }
    const inicio = exigirHora(item.inicio, 'inicio');
    const fim = exigirHora(item.fim, 'fim');
    if (horaParaMin(inicio) >= horaParaMin(fim)) {
      throw new ErroHttp(422, 'validacao', 'O início da jornada deve ser antes do fim.');
    }
    let intervaloInicio = null;
    let intervaloFim = null;
    const temInicio = item.intervaloInicio !== undefined && item.intervaloInicio !== null && item.intervaloInicio !== '';
    const temFim = item.intervaloFim !== undefined && item.intervaloFim !== null && item.intervaloFim !== '';
    if (temInicio || temFim) {
      if (!temInicio || !temFim) {
        throw new ErroHttp(422, 'validacao', 'Informe início e fim do intervalo.');
      }
      intervaloInicio = exigirHora(item.intervaloInicio, 'intervaloInicio');
      intervaloFim = exigirHora(item.intervaloFim, 'intervaloFim');
      if (horaParaMin(intervaloInicio) >= horaParaMin(intervaloFim)) {
        throw new ErroHttp(422, 'validacao', 'O intervalo deve ter início antes do fim.');
      }
      if (
        horaParaMin(intervaloInicio) < horaParaMin(inicio) ||
        horaParaMin(intervaloFim) > horaParaMin(fim)
      ) {
        throw new ErroHttp(422, 'validacao', 'O intervalo deve estar dentro da jornada.');
      }
    }
    saida.push({ diaSemana: dia, ativo: true, inicio, fim, intervaloInicio, intervaloFim });
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Estáticos
// ---------------------------------------------------------------------------

function servirEstatico(req, res, caminho, publicDir) {
  const metodo = req.method;
  if (metodo !== 'GET' && metodo !== 'HEAD') {
    enviarTexto(res, 405, 'Método não permitido.');
    return;
  }

  let rel;
  try {
    rel = decodeURIComponent(caminho);
  } catch {
    enviarTexto(res, 400, 'Caminho inválido.');
    return;
  }
  if (rel.includes('\0')) {
    enviarTexto(res, 400, 'Caminho inválido.');
    return;
  }
  if (rel === '/' || rel === '') rel = '/index.html';

  const raiz = path.resolve(publicDir);
  let destino = path.resolve(raiz, `.${rel}`);
  if (!(destino === raiz || destino.startsWith(raiz + path.sep))) {
    enviarTexto(res, 404, 'Não encontrado.');
    return;
  }

  let stat = null;
  try {
    stat = fs.statSync(destino);
  } catch {
    stat = null;
  }

  if (stat && stat.isDirectory()) {
    const index = path.join(destino, 'index.html');
    if (fs.existsSync(index)) {
      destino = index;
      stat = fs.statSync(destino);
    } else {
      stat = null;
    }
  }

  if (!stat || !stat.isFile()) {
    const temExtensao = path.extname(rel) !== '';
    const index = path.join(raiz, 'index.html');
    // Fallback de SPA: somente GET sem extensão e nunca para /api.
    if (!temExtensao && metodo === 'GET' && fs.existsSync(index)) {
      destino = index;
      try {
        stat = fs.statSync(index);
      } catch {
        stat = null;
      }
    }
    if (!stat || !stat.isFile()) {
      enviarTexto(res, 404, 'Não encontrado.');
      return;
    }
  }

  const ext = path.extname(destino).toLowerCase();
  const tipo = TIPOS_ESTATICOS[ext] || 'application/octet-stream';
  const cache = path.basename(destino) === 'index.html' ? 'no-cache' : 'public, max-age=60';
  let conteudo;
  try {
    conteudo = fs.readFileSync(destino);
  } catch {
    enviarTexto(res, 404, 'Não encontrado.');
    return;
  }
  res.writeHead(200, {
    'Content-Type': tipo,
    'Content-Length': conteudo.length,
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
  });
  if (metodo === 'HEAD') res.end();
  else res.end(conteudo);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function login(ctx) {
  const { req, res, db, corpo } = ctx;
  const chaveLimite = limitar(req, 'login');
  const loginInformado = typeof corpo.login === 'string' ? corpo.login.trim() : '';
  const senha = typeof corpo.senha === 'string' ? corpo.senha : '';
  // Clientes entram com telefone + PIN; equipe com login + senha.
  // Prioriza a coluna login para não haver ambiguidade com telefone.
  const telefoneInformado = normalizarTelefone(loginInformado);
  const selecionarUsuario = db.prepare(
    `SELECT u.*, b.id AS barbeiro_id
       FROM usuarios u
       LEFT JOIN barbeiros b ON b.usuario_id = u.id
      WHERE u.login = ?`
  );
  let linha = loginInformado ? selecionarUsuario.get(loginInformado) : null;
  if (!linha && telefoneInformado) {
    linha = db
      .prepare(
        `SELECT u.*, b.id AS barbeiro_id
           FROM usuarios u
           LEFT JOIN barbeiros b ON b.usuario_id = u.id
          WHERE u.telefone = ? AND u.papel = 'cliente'`
      )
      .get(telefoneInformado);
  }

  const hash =
    linha && (linha.papel === 'cliente' ? linha.pin_hash : linha.senha_hash);
  const valido = Boolean(linha && Number(linha.ativo) && hash && auth.verificarSegredo(senha, hash));

  if (!valido) {
    if (!linha) auth.compararComFicticio(senha);
    throw new ErroHttp(401, 'credenciais_invalidas', 'Login ou senha inválidos.');
  }

  const sessao = auth.criarSessao(db, linha.id);
  liberarLimite(chaveLimite);
  enviarJson(
    res,
    200,
    { usuario: auth.usuarioPublico(linha) },
    { 'Set-Cookie': auth.cookieSessao(sessao.token) }
  );
}

function logout(ctx) {
  const { res, db, token } = ctx;
  auth.apagarSessao(db, token);
  enviar204(res, { 'Set-Cookie': auth.cookieLimparSessao() });
}

function me(ctx) {
  const usuario = auth.exigirUsuario(ctx.usuario);
  enviarJson(ctx.res, 200, { usuario: auth.usuarioPublico(usuario) });
}

/**
 * Bootstrap de sessão: sempre 200. Devolve o usuário ou null quando não há
 * sessão. Evita que a tela inicial dispare um 401 esperado (que apareceria
 * como erro de console no navegador) só para descobrir que é visitante.
 */
function sessao(ctx) {
  const usuario = ctx.usuario;
  enviarJson(ctx.res, 200, {
    usuario: usuario ? auth.usuarioPublico(usuario) : null,
  });
}

function listarBarbeiros(ctx) {
  const linhas = ctx.db
    .prepare(
      `SELECT b.*, u.nome, u.sobrenome
         FROM barbeiros b
         JOIN usuarios u ON u.id = b.usuario_id
        ORDER BY b.id`
    )
    .all();
  enviarJson(ctx.res, 200, { barbeiros: linhas.map(barbeiroObj) });
}

function listarServicos(ctx) {
  const linhas = ctx.db.prepare('SELECT * FROM servicos ORDER BY id').all();
  enviarJson(ctx.res, 200, { servicos: linhas.map(servicoObj) });
}

function obterConfiguracoes(ctx) {
  enviarJson(ctx.res, 200, configObj(ctx.db));
}

function criarCliente(ctx) {
  const { req, res, db, corpo } = ctx;
  limitar(req, 'cadastro');
  const nome = exigirNome(corpo.nome, 'nome');
  const sobrenome = exigirNome(corpo.sobrenome, 'sobrenome');
  const telefone = normalizarTelefone(corpo.telefone);
  if (!telefone) {
    throw new ErroHttp(422, 'validacao', 'Telefone deve ter 10 ou 11 dígitos.');
  }
  if (typeof corpo.pin !== 'string' || !/^\d{4,6}$/.test(corpo.pin)) {
    throw new ErroHttp(422, 'validacao', 'PIN deve ter de 4 a 6 dígitos.');
  }
  const pin = corpo.pin;

  const resultado = transacao(db, () => {
    const existente = db
      .prepare('SELECT * FROM usuarios WHERE telefone = ?')
      .get(telefone);
    if (existente) {
      if (
        existente.papel !== 'cliente' ||
        !existente.pin_hash ||
        !auth.verificarSegredo(pin, existente.pin_hash)
      ) {
        return { conflito: true };
      }
      return { usuarioId: Number(existente.id), jaExistia: true };
    }
    const agora = agoraLocal();
    const id = Number(
      db
        .prepare(
          `INSERT INTO usuarios
             (papel, nome, sobrenome, telefone, login, senha_hash, pin_hash, ativo, criado_em, atualizado_em)
           VALUES ('cliente', ?, ?, ?, NULL, NULL, ?, 1, ?, ?)`
        )
        .run(nome, sobrenome, telefone, auth.hashSegredo(pin), agora.texto, agora.texto)
        .lastInsertRowid
    );
    return { usuarioId: id, jaExistia: false };
  });

  if (resultado.conflito) {
    throw new ErroHttp(
      409,
      'cadastro_nao_concluido',
      'Não foi possível concluir o cadastro com esses dados. Se você já tem conta, entre com seu PIN.'
    );
  }

  const usuario = db
    .prepare('SELECT * FROM usuarios WHERE id = ?')
    .get(resultado.usuarioId);
  const sessao = auth.criarSessao(db, usuario.id);
  if (resultado.jaExistia) {
    enviarJson(
      res,
      200,
      { usuario: auth.usuarioPublico(usuario), jaExistia: true },
      { 'Set-Cookie': auth.cookieSessao(sessao.token) }
    );
  } else {
    enviarJson(
      res,
      201,
      { usuario: auth.usuarioPublico(usuario) },
      { 'Set-Cookie': auth.cookieSessao(sessao.token) }
    );
  }
}

function consultarDisponibilidade(ctx) {
  const servicoId = inteiroPositivo(ctx.url.searchParams.get('servicoId'));
  if (!servicoId) throw new ErroHttp(422, 'validacao', 'servicoId é obrigatório.');
  const data = ctx.url.searchParams.get('data');
  if (!data) throw new ErroHttp(422, 'validacao', 'data é obrigatória.');
  const barbeiroParam = ctx.url.searchParams.get('barbeiroId');
  let barbeiroId = null;
  if (barbeiroParam !== null && barbeiroParam !== '') {
    barbeiroId = inteiroPositivo(barbeiroParam);
    if (!barbeiroId) throw new ErroHttp(422, 'validacao', 'barbeiroId inválido.');
  }
  const resultado = avail.disponibilidade(ctx.db, { servicoId, data, barbeiroId });
  enviarJson(ctx.res, 200, resultado);
}

function consultarResumoDisponibilidade(ctx) {
  const servicoId = inteiroPositivo(ctx.url.searchParams.get('servicoId'));
  if (!servicoId) throw new ErroHttp(422, 'validacao', 'servicoId é obrigatório.');
  const de = ctx.url.searchParams.get('de');
  const ate = ctx.url.searchParams.get('ate');
  if (!de || !ate) throw new ErroHttp(422, 'validacao', 'Informe de e ate.');
  const resultado = avail.resumoDisponibilidade(ctx.db, { servicoId, de, ate });
  enviarJson(ctx.res, 200, resultado);
}

function criarAgendamento(ctx) {
  const { res, db, corpo, usuario } = ctx;
  auth.exigirUsuario(usuario);
  if (usuario.papel === 'barbeiro') {
    throw new ErroHttp(403, 'sem_permissao', 'Barbeiros não criam agendamentos por esta rota.');
  }

  let clienteId;
  if (usuario.papel === 'admin') {
    const informado = inteiroPositivo(corpo.clienteId);
    if (!informado) throw new ErroHttp(422, 'validacao', 'clienteId é obrigatório para admin.');
    exigirUsuarioExistente(db, informado);
    clienteId = informado;
  } else {
    clienteId = Number(usuario.id); // clienteId do corpo é ignorado
  }

  const servicoId = inteiroPositivo(corpo.servicoId);
  if (!servicoId) throw new ErroHttp(422, 'validacao', 'servicoId é obrigatório.');
  const servico = avail.servicoPorId(db, servicoId);

  const data = exigirData(corpo.data);
  const hora = exigirHora(corpo.hora, 'hora');

  let barbeiroId = null;
  if (corpo.barbeiroId !== undefined && corpo.barbeiroId !== null && corpo.barbeiroId !== '') {
    barbeiroId = inteiroPositivo(corpo.barbeiroId);
    if (!barbeiroId) throw new ErroHttp(422, 'validacao', 'barbeiroId inválido.');
  }

  let agendamentoId;
  try {
    agendamentoId = transacao(db, () => {
      const duracao = Number(servico.duracao_min);
      let escolhido = barbeiroId;

      if (escolhido === null) {
        const candidatos = avail.barbeirosAtivos(db);
        for (const candidato of candidatos) {
          try {
            avail.validarSlot(db, {
              data,
              hora,
              duracaoMin: duracao,
              barbeiroId: Number(candidato.id),
            });
            escolhido = Number(candidato.id);
            break;
          } catch (erro) {
            if (erro instanceof ErroHttp && erro.status === 422) throw erro;
          }
        }
        if (escolhido === null) {
          throw new ErroHttp(
            409,
            'horario_indisponivel',
            'Nenhum barbeiro tem este horário disponível.'
          );
        }
      } else {
        exigirBarbeiroAtivo(db, escolhido);
        avail.validarSlot(db, {
          data,
          hora,
          duracaoMin: duracao,
          barbeiroId: escolhido,
        });
      }

      const agora = agoraLocal();
      const inicio = `${data} ${hora}`;
      const fim = `${data} ${minParaHora(horaParaMin(hora) + duracao)}`;
      const id = Number(
        db
          .prepare(
            `INSERT INTO agendamentos
               (cliente_id, barbeiro_id, servico_id, data, hora, duracao_min, preco_centavos,
                inicio, fim, status, criado_em, atualizado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'agendado', ?, ?)`
          )
          .run(
            clienteId,
            escolhido,
            servico.id,
            data,
            hora,
            duracao,
            Number(servico.preco_centavos),
            inicio,
            fim,
            agora.texto,
            agora.texto
          ).lastInsertRowid
      );
      registrarHistorico(db, {
        agendamentoId: id,
        acao: 'criado',
        para: 'agendado',
        usuarioId: usuario.id,
      });
      return id;
    });
  } catch (erro) {
    const http = comoErroHttp(erro);
    if (http) throw http;
    throw erro;
  }

  enviarJson(res, 201, { agendamento: buscarAgendamento(db, agendamentoId) });
}

function listarAgendamentos(ctx) {
  const { db, usuario, url } = ctx;
  auth.exigirUsuario(usuario);

  const escopo = url.searchParams.get('escopo') || 'proximos';
  if (!['proximos', 'historico', 'todos'].includes(escopo)) {
    throw new ErroHttp(422, 'validacao', 'escopo inválido.');
  }
  const dataFiltro = url.searchParams.get('data');
  if (dataFiltro && !validarData(dataFiltro)) {
    throw new ErroHttp(422, 'validacao', 'data inválida.');
  }
  let barbeiroFiltro = null;
  const paramBarbeiro = url.searchParams.get('barbeiroId');
  if (paramBarbeiro !== null && paramBarbeiro !== '') {
    barbeiroFiltro = inteiroPositivo(paramBarbeiro);
    if (!barbeiroFiltro) throw new ErroHttp(422, 'validacao', 'barbeiroId inválido.');
  }
  let clienteFiltro = null;
  const paramCliente = url.searchParams.get('clienteId');
  if (paramCliente !== null && paramCliente !== '') {
    clienteFiltro = inteiroPositivo(paramCliente);
    if (!clienteFiltro) throw new ErroHttp(422, 'validacao', 'clienteId inválido.');
  }

  const condicoes = [];
  const params = [];

  if (usuario.papel === 'cliente') {
    if (clienteFiltro !== null && clienteFiltro !== Number(usuario.id)) {
      throw new ErroHttp(403, 'sem_permissao', 'Você só pode ver seus próprios agendamentos.');
    }
    condicoes.push('a.cliente_id = ?');
    params.push(usuario.id);
    if (barbeiroFiltro !== null) {
      condicoes.push('a.barbeiro_id = ?');
      params.push(barbeiroFiltro);
    }
  } else if (usuario.papel === 'barbeiro') {
    if (barbeiroFiltro !== null && barbeiroFiltro !== Number(usuario.barbeiroId)) {
      throw new ErroHttp(403, 'sem_permissao', 'Você só pode ver a sua própria agenda.');
    }
    condicoes.push('a.barbeiro_id = ?');
    params.push(usuario.barbeiroId);
    if (clienteFiltro !== null) {
      condicoes.push('a.cliente_id = ?');
      params.push(clienteFiltro);
    }
  } else {
    if (barbeiroFiltro !== null) {
      condicoes.push('a.barbeiro_id = ?');
      params.push(barbeiroFiltro);
    }
    if (clienteFiltro !== null) {
      condicoes.push('a.cliente_id = ?');
      params.push(clienteFiltro);
    }
  }

  if (dataFiltro) {
    condicoes.push('a.data = ?');
    params.push(dataFiltro);
  }

  if (escopo !== 'todos') {
    const agora = agoraLocal();
    const referencia = `${agora.data} ${agora.hora}`;
    if (escopo === 'proximos') {
      condicoes.push("a.status = 'agendado' AND a.inicio >= ?");
      params.push(referencia);
    } else {
      condicoes.push("NOT (a.status = 'agendado' AND a.inicio >= ?)");
      params.push(referencia);
    }
  }

  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const linhas = db
    .prepare(`${SQL_AGENDAMENTO} ${where} ORDER BY a.inicio ASC, a.id ASC`)
    .all(...params);
  enviarJson(ctx.res, 200, { agendamentos: linhas.map(agendamentoObj) });
}

function reagendar(ctx) {
  const { db, corpo, usuario, res } = ctx;
  auth.exigirUsuario(usuario);
  const bruto = buscarAgendamentoBruto(db, ctx.id);
  if (!bruto) throw new ErroHttp(404, 'nao_encontrado', 'Agendamento não encontrado.');
  autorizarAgendamento(usuario, bruto);
  if (bruto.status !== 'agendado') {
    throw new ErroHttp(409, 'estado_invalido', 'Somente agendamentos ativos podem ser reagendados.');
  }

  const data = exigirData(corpo.data);
  const hora = exigirHora(corpo.hora, 'hora');
  let novoBarbeiroId = Number(bruto.barbeiro_id);
  if (corpo.barbeiroId !== undefined && corpo.barbeiroId !== null && corpo.barbeiroId !== '') {
    novoBarbeiroId = inteiroPositivo(corpo.barbeiroId);
    if (!novoBarbeiroId) throw new ErroHttp(422, 'validacao', 'barbeiroId inválido.');
  }
  const duracao = Number(bruto.duracao_min);

  try {
    transacao(db, () => {
      exigirBarbeiroAtivo(db, novoBarbeiroId);
      // Revalida ignorando o próprio agendamento; a linha antiga só é
      // substituída depois de o novo horário ser aceito, na mesma transação.
      avail.validarSlot(db, {
        data,
        hora,
        duracaoMin: duracao,
        barbeiroId: novoBarbeiroId,
        ignorarAgendamentoId: bruto.id,
      });
      const inicio = `${data} ${hora}`;
      const fim = `${data} ${minParaHora(horaParaMin(hora) + duracao)}`;
      db.prepare(
        `UPDATE agendamentos
            SET barbeiro_id = ?, data = ?, hora = ?, inicio = ?, fim = ?, atualizado_em = ?
          WHERE id = ?`
      ).run(novoBarbeiroId, data, hora, inicio, fim, agoraLocal().texto, bruto.id);
      registrarHistorico(db, {
        agendamentoId: bruto.id,
        acao: 'reagendado',
        de: bruto.status,
        para: 'agendado',
        usuarioId: usuario.id,
        detalhe: `novo horário ${inicio}`,
      });
    });
  } catch (erro) {
    const http = comoErroHttp(erro);
    if (http) throw http;
    throw erro;
  }

  enviarJson(res, 200, { agendamento: buscarAgendamento(db, bruto.id) });
}

function cancelar(ctx) {
  const { db, usuario, res } = ctx;
  auth.exigirUsuario(usuario);
  const bruto = buscarAgendamentoBruto(db, ctx.id);
  if (!bruto) throw new ErroHttp(404, 'nao_encontrado', 'Agendamento não encontrado.');
  autorizarAgendamento(usuario, bruto);
  if (bruto.status !== 'agendado') {
    throw new ErroHttp(409, 'estado_invalido', 'Este agendamento não pode mais ser cancelado.');
  }
  transacao(db, () => {
    db.prepare(
      "UPDATE agendamentos SET status = 'cancelado', atualizado_em = ? WHERE id = ?"
    ).run(agoraLocal().texto, bruto.id);
    registrarHistorico(db, {
      agendamentoId: bruto.id,
      acao: 'cancelado',
      de: bruto.status,
      para: 'cancelado',
      usuarioId: usuario.id,
    });
  });
  enviarJson(res, 200, { agendamento: buscarAgendamento(db, bruto.id) });
}

function atualizarClienteMe(ctx) {
  const { db, usuario, corpo, res } = ctx;
  auth.exigirPapel(usuario, 'cliente');
  const pinAtual = typeof corpo.pinAtual === 'string' ? corpo.pinAtual : '';
  if (!usuario.pin_hash || !auth.verificarSegredo(pinAtual, usuario.pin_hash)) {
    throw new ErroHttp(401, 'credenciais_invalidas', 'PIN atual incorreto.');
  }

  const campos = [];
  const params = [];
  if (corpo.nome !== undefined) {
    campos.push('nome = ?');
    params.push(exigirNome(corpo.nome, 'nome'));
  }
  if (corpo.sobrenome !== undefined) {
    campos.push('sobrenome = ?');
    params.push(exigirNome(corpo.sobrenome, 'sobrenome'));
  }
  if (corpo.pinNovo !== undefined) {
    if (typeof corpo.pinNovo !== 'string' || !/^\d{4,6}$/.test(corpo.pinNovo)) {
      throw new ErroHttp(422, 'validacao', 'PIN novo deve ter de 4 a 6 dígitos.');
    }
    campos.push('pin_hash = ?');
    params.push(auth.hashSegredo(corpo.pinNovo));
  }
  if (campos.length > 0) {
    campos.push('atualizado_em = ?');
    params.push(agoraLocal().texto);
    params.push(usuario.id);
    db.prepare(`UPDATE usuarios SET ${campos.join(', ')} WHERE id = ?`).run(...params);
  }

  const atualizado = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(usuario.id);
  enviarJson(res, 200, { usuario: auth.usuarioPublico(atualizado) });
}

function minhaAgenda(ctx) {
  const { db, usuario, url, res } = ctx;
  auth.exigirPapel(usuario, 'barbeiro');
  const barbeiroId = Number(usuario.barbeiroId);

  const dataParam = url.searchParams.get('data');
  let de;
  let ate;
  if (dataParam) {
    de = exigirData(dataParam, 'data');
    ate = de;
  } else {
    const hoje = agoraLocal().data;
    de = url.searchParams.get('de') || hoje;
    ate = url.searchParams.get('ate') || util.somarDias(de, 6);
    exigirData(de, 'de');
    exigirData(ate, 'ate');
  }
  if (ate < de) throw new ErroHttp(422, 'validacao', 'ate deve ser >= de.');
  if (diferencaDias(de, ate) + 1 > MAX_DIAS_RANGE) {
    throw new ErroHttp(422, 'validacao', `Intervalo máximo de ${MAX_DIAS_RANGE} dias.`);
  }

  const agendamentos = db
    .prepare(
      `${SQL_AGENDAMENTO}
        WHERE a.barbeiro_id = ? AND a.data BETWEEN ? AND ?
        ORDER BY a.inicio ASC, a.id ASC`
    )
    .all(barbeiroId, de, ate)
    .map(agendamentoObj);

  const bloqueios = db
    .prepare(
      `SELECT * FROM bloqueios
        WHERE data BETWEEN ? AND ? AND (barbeiro_id = ? OR barbeiro_id IS NULL)
        ORDER BY data ASC, hora_inicio ASC`
    )
    .all(de, ate, barbeiroId)
    .map(bloqueioObj);

  const barbeiro = buscarBarbeiroAgenda(db, barbeiroId);
  enviarJson(res, 200, {
    barbeiro: barbeiro
      ? { id: Number(barbeiro.id), nome: nomeCompleto(barbeiro.nome, barbeiro.sobrenome) }
      : { id: barbeiroId, nome: '' },
    agendamentos,
    bloqueios,
  });
}

function criarBloqueio(ctx) {
  const { db, usuario, corpo, res } = ctx;
  auth.exigirPapel(usuario, ['barbeiro', 'admin']);

  const data = exigirData(corpo.data);
  const horaInicio = exigirHora(corpo.horaInicio, 'horaInicio');
  const horaFim = exigirHora(corpo.horaFim, 'horaFim');
  if (horaParaMin(horaInicio) >= horaParaMin(horaFim)) {
    throw new ErroHttp(422, 'validacao', 'horaInicio deve ser antes de horaFim.');
  }
  const motivo = exigirTextoOpcional(corpo.motivo, 'motivo', 200) ?? '';

  let barbeiroId;
  if (usuario.papel === 'barbeiro') {
    barbeiroId = Number(usuario.barbeiroId);
  } else if (corpo.barbeiroId === undefined || corpo.barbeiroId === null || corpo.barbeiroId === '') {
    barbeiroId = null;
  } else {
    barbeiroId = inteiroPositivo(corpo.barbeiroId);
    if (!barbeiroId) throw new ErroHttp(422, 'validacao', 'barbeiroId inválido.');
    const existe = db.prepare('SELECT id FROM barbeiros WHERE id = ?').get(barbeiroId);
    if (!existe) throw new ErroHttp(404, 'nao_encontrado', 'Barbeiro não encontrado.');
  }

  const inicioMin = horaParaMin(horaInicio);
  const fimMin = horaParaMin(horaFim);

  const conflito = db
    .prepare(
      `SELECT a.id, a.hora, a.duracao_min
         FROM agendamentos a
        WHERE a.data = ? AND a.status = 'agendado'
          ${barbeiroId === null ? '' : 'AND a.barbeiro_id = ?'}`
    )
    .all(...(barbeiroId === null ? [data] : [data, barbeiroId]))
    .some((a) => util.minutosSobrepoem(inicioMin, fimMin, horaParaMin(a.hora), horaParaMin(a.hora) + Number(a.duracao_min)));

  // Bloqueios sobrepostos (do barbeiro ou da loja) também são recusados.
  const conflitoBloqueio = db
    .prepare(
      `SELECT id, barbeiro_id, hora_inicio, hora_fim
         FROM bloqueios
        WHERE data = ? ${barbeiroId === null ? '' : 'AND (barbeiro_id = ? OR barbeiro_id IS NULL)'}`
    )
    .all(...(barbeiroId === null ? [data] : [data, barbeiroId]))
    .some((b) => util.minutosSobrepoem(inicioMin, fimMin, horaParaMin(b.hora_inicio), horaParaMin(b.hora_fim)));

  if (conflito || conflitoBloqueio) {
    throw new ErroHttp(
      409,
      'estado_invalido',
      'Há agendamento ou bloqueio nesse período. Nada foi alterado.'
    );
  }

  const agora = agoraLocal();
  const id = Number(
    db
      .prepare(
        `INSERT INTO bloqueios
           (barbeiro_id, data, hora_inicio, hora_fim, motivo, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(barbeiroId, data, horaInicio, horaFim, motivo, agora.texto, agora.texto)
      .lastInsertRowid
  );
  if (usuario.papel === 'admin') {
    auditar(db, usuario, 'criar_bloqueio', `bloqueio #${id}`);
  }
  const linha = db.prepare('SELECT * FROM bloqueios WHERE id = ?').get(id);
  enviarJson(res, 201, { bloqueio: bloqueioObj(linha) });
}

function listarBloqueios(ctx) {
  const { db, usuario, url, res } = ctx;
  auth.exigirPapel(usuario, ['barbeiro', 'admin']);
  const de = url.searchParams.get('de');
  const ate = url.searchParams.get('ate');
  if ((de && !validarData(de)) || (ate && !validarData(ate))) {
    throw new ErroHttp(422, 'validacao', 'Datas de/ate inválidas.');
  }
  const paramBarbeiro = url.searchParams.get('barbeiroId');
  let filtroBarbeiro = null;
  if (paramBarbeiro !== null && paramBarbeiro !== '') {
    filtroBarbeiro = inteiroPositivo(paramBarbeiro);
    if (!filtroBarbeiro) throw new ErroHttp(422, 'validacao', 'barbeiroId inválido.');
  }

  const condicoes = [];
  const params = [];
  if (usuario.papel === 'barbeiro') {
    if (filtroBarbeiro !== null && filtroBarbeiro !== Number(usuario.barbeiroId)) {
      throw new ErroHttp(403, 'sem_permissao', 'Você só pode ver os seus bloqueios.');
    }
    condicoes.push('(barbeiro_id = ? OR barbeiro_id IS NULL)');
    params.push(usuario.barbeiroId);
  } else if (filtroBarbeiro !== null) {
    condicoes.push('barbeiro_id = ?');
    params.push(filtroBarbeiro);
  }
  if (de) {
    condicoes.push('data >= ?');
    params.push(de);
  }
  if (ate) {
    condicoes.push('data <= ?');
    params.push(ate);
  }
  const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  const linhas = db
    .prepare(`SELECT * FROM bloqueios ${where} ORDER BY data ASC, hora_inicio ASC, id ASC`)
    .all(...params);
  enviarJson(res, 200, { bloqueios: linhas.map(bloqueioObj) });
}

function removerBloqueio(ctx) {
  const { db, usuario, res } = ctx;
  auth.exigirPapel(usuario, ['barbeiro', 'admin']);
  const linha = db.prepare('SELECT * FROM bloqueios WHERE id = ?').get(ctx.id);
  if (!linha) throw new ErroHttp(404, 'nao_encontrado', 'Bloqueio não encontrado.');
  if (usuario.papel === 'barbeiro') {
    if (linha.barbeiro_id === null || Number(linha.barbeiro_id) !== Number(usuario.barbeiroId)) {
      throw new ErroHttp(403, 'sem_permissao', 'Você só pode remover os seus bloqueios.');
    }
  }
  db.prepare('DELETE FROM bloqueios WHERE id = ?').run(ctx.id);
  if (usuario.papel === 'admin') auditar(db, usuario, 'remover_bloqueio', `bloqueio #${ctx.id}`);
  enviar204(res);
}

function atualizarStatusAgendamento(ctx) {
  const { db, usuario, corpo, res } = ctx;
  auth.exigirPapel(usuario, ['barbeiro', 'admin']);
  const bruto = buscarAgendamentoBruto(db, ctx.id);
  if (!bruto) throw new ErroHttp(404, 'nao_encontrado', 'Agendamento não encontrado.');
  if (usuario.papel === 'barbeiro' && Number(bruto.barbeiro_id) !== Number(usuario.barbeiroId)) {
    throw new ErroHttp(403, 'sem_permissao', 'Este agendamento não é seu.');
  }
  const status = corpo.status;
  if (!['concluido', 'faltou', 'agendado'].includes(status)) {
    throw new ErroHttp(422, 'validacao', 'status inválido.');
  }

  try {
    transacao(db, () => {
      if (status === 'agendado' && bruto.status !== 'agendado') {
        avail.validarSlot(db, {
          data: bruto.data,
          hora: bruto.hora,
          duracaoMin: Number(bruto.duracao_min),
          barbeiroId: Number(bruto.barbeiro_id),
          ignorarAgendamentoId: bruto.id,
        });
      }
      db.prepare('UPDATE agendamentos SET status = ?, atualizado_em = ? WHERE id = ?').run(
        status,
        agoraLocal().texto,
        bruto.id
      );
      registrarHistorico(db, {
        agendamentoId: bruto.id,
        acao: 'status',
        de: bruto.status,
        para: status,
        usuarioId: usuario.id,
      });
    });
  } catch (erro) {
    const http = comoErroHttp(erro);
    if (http) throw http;
    throw erro;
  }
  enviarJson(res, 200, { agendamento: buscarAgendamento(db, bruto.id) });
}

// --------------------------- Admin -------------------------------------------

function dashboard(ctx) {
  const { db, url, res } = ctx;
  auth.exigirAdmin(ctx.usuario);

  const hoje = agoraLocal().data;
  const dataParam = url.searchParams.get('data');
  const deParam = url.searchParams.get('de');
  const ateParam = url.searchParams.get('ate');
  if ((dataParam && !validarData(dataParam)) ||
      (deParam && !validarData(deParam)) ||
      (ateParam && !validarData(ateParam))) {
    throw new ErroHttp(422, 'validacao', 'Datas inválidas.');
  }
  const dataRef = dataParam || deParam || hoje;
  const de = deParam || dataRef;
  const ate = ateParam || dataRef;
  if (ate < de) throw new ErroHttp(422, 'validacao', 'ate deve ser >= de.');
  if (diferencaDias(de, ate) + 1 > MAX_DIAS_RANGE) {
    throw new ErroHttp(422, 'validacao', `Intervalo máximo de ${MAX_DIAS_RANGE} dias.`);
  }

  let barbeiroId = null;
  const paramBarbeiro = url.searchParams.get('barbeiroId');
  if (paramBarbeiro !== null && paramBarbeiro !== '') {
    barbeiroId = inteiroPositivo(paramBarbeiro);
    if (!barbeiroId) throw new ErroHttp(422, 'validacao', 'barbeiroId inválido.');
  }

  const filtroBarbeiroDia = barbeiroId ? ' AND barbeiro_id = ?' : '';
  const paramsDia = barbeiroId ? [dataRef, barbeiroId] : [dataRef];

  const porStatus = db
    .prepare(
      `SELECT status, COUNT(*) AS qtd FROM agendamentos
        WHERE data = ?${filtroBarbeiroDia} GROUP BY status`
    )
    .all(...paramsDia);
  const contagem = { agendado: 0, concluido: 0, cancelado: 0, faltou: 0 };
  for (const linha of porStatus) contagem[linha.status] = Number(linha.qtd);
  const agendamentosDia = Object.values(contagem).reduce((a, b) => a + b, 0);

  const clientesTotal = Number(
    db.prepare("SELECT COUNT(*) AS qtd FROM usuarios WHERE papel = 'cliente'").get().qtd
  );

  const receita = Number(
    db
      .prepare(
        `SELECT COALESCE(SUM(preco_centavos), 0) AS total FROM agendamentos
          WHERE data = ? AND status IN ('agendado','concluido')${filtroBarbeiroDia}`
      )
      .get(...paramsDia).total
  );

  const minutosOcupados = Number(
    db
      .prepare(
        `SELECT COALESCE(SUM(duracao_min), 0) AS total FROM agendamentos
          WHERE data = ? AND status IN ('agendado','concluido')${filtroBarbeiroDia}`
      )
      .get(...paramsDia).total
  );

  const capacidade = avail.capacidadeMinutosDia(db, { data: dataRef, barbeiroId });
  const ocupacaoPct =
    capacidade > 0
      ? Math.min(100, Math.round((minutosOcupados / capacidade) * 1000) / 10)
      : 0;

  const linhasBarbeiros = barbeiroId
    ? db
        .prepare(
          `SELECT b.id, u.nome, u.sobrenome FROM barbeiros b
             JOIN usuarios u ON u.id = b.usuario_id WHERE b.id = ?`
        )
        .all(barbeiroId)
    : db
        .prepare(
          `SELECT b.id, u.nome, u.sobrenome FROM barbeiros b
             JOIN usuarios u ON u.id = b.usuario_id ORDER BY b.id`
        )
        .all();

  const porBarbeiro = linhasBarbeiros.map((b) => {
    const stats = db
      .prepare(
        `SELECT
           COUNT(*) AS agendamentos,
           COALESCE(SUM(CASE WHEN status = 'concluido' THEN 1 ELSE 0 END), 0) AS concluidos,
           COALESCE(SUM(CASE WHEN status IN ('agendado','concluido') THEN preco_centavos ELSE 0 END), 0) AS receita,
           COALESCE(SUM(CASE WHEN status IN ('agendado','concluido') THEN duracao_min ELSE 0 END), 0) AS minutos
         FROM agendamentos
        WHERE barbeiro_id = ? AND data BETWEEN ? AND ?`
      )
      .get(b.id, de, ate);
    let capacidadePeriodo = 0;
    for (const data of listarDias(de, ate)) {
      capacidadePeriodo += avail.capacidadeMinutosDia(db, { data, barbeiroId: Number(b.id) });
    }
    const minutos = Number(stats.minutos);
    return {
      barbeiroId: Number(b.id),
      nome: nomeCompleto(b.nome, b.sobrenome),
      agendamentos: Number(stats.agendamentos),
      concluidos: Number(stats.concluidos),
      receitaCentavos: Number(stats.receita),
      ocupacaoPct:
        capacidadePeriodo > 0
          ? Math.min(100, Math.round((minutos / capacidadePeriodo) * 1000) / 10)
          : 0,
    };
  });

  const servicosMaisSolicitados = db
    .prepare(
      `SELECT s.id AS servico_id, s.nome, COUNT(a.id) AS quantidade
         FROM agendamentos a
         JOIN servicos s ON s.id = a.servico_id
        WHERE a.data BETWEEN ? AND ? AND a.status IN ('agendado','concluido')
          ${barbeiroId ? 'AND a.barbeiro_id = ?' : ''}
        GROUP BY s.id, s.nome
        ORDER BY quantidade DESC, s.nome ASC`
    )
    .all(...(barbeiroId ? [de, ate, barbeiroId] : [de, ate]))
    .map((linha) => ({
      servicoId: Number(linha.servico_id),
      nome: linha.nome,
      quantidade: Number(linha.quantidade),
    }));

  enviarJson(res, 200, {
    data: dataRef,
    kpis: {
      agendamentosDia,
      concluidos: contagem.concluido,
      cancelados: contagem.cancelado,
      faltas: contagem.faltou,
      clientesTotal,
      receitaEstimadaCentavos: receita,
      ocupacaoPct,
    },
    porBarbeiro,
    servicosMaisSolicitados,
  });
}

function criarBarbeiroAdmin(ctx) {
  const { db, usuario, corpo, res } = ctx;
  auth.exigirAdmin(usuario);
  const dados = validarNovoBarbeiro(corpo, { senhaObrigatoria: true });

  let barbeiroId;
  try {
    barbeiroId = transacao(db, () => {
      const existente = db
        .prepare('SELECT id FROM usuarios WHERE login = ?')
        .get(dados.login);
      if (existente) {
        throw new ErroHttp(409, 'estado_invalido', 'Login já está em uso.');
      }
      const agora = agoraLocal();
      const usuarioId = Number(
        db
          .prepare(
            `INSERT INTO usuarios
               (papel, nome, sobrenome, telefone, login, senha_hash, pin_hash, ativo, criado_em, atualizado_em)
             VALUES ('barbeiro', ?, ?, NULL, ?, ?, NULL, 1, ?, ?)`
          )
          .run(
            dados.nome,
            dados.sobrenome,
            dados.login,
            auth.hashSegredo(dados.senha),
            agora.texto,
            agora.texto
          ).lastInsertRowid
      );
      const id = Number(
        db
          .prepare(
            `INSERT INTO barbeiros
               (usuario_id, apelido, especialidades, bio, foto_url, ativo, criado_em, atualizado_em)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
          )
          .run(
            usuarioId,
            dados.apelido ?? null,
            JSON.stringify(dados.especialidades || []),
            dados.bio ?? null,
            dados.fotoUrl ?? null,
            agora.texto,
            agora.texto
          ).lastInsertRowid
      );
      seed.criarJornadasPadrao(db, id, agora.texto);
      auditar(db, usuario, 'criar_barbeiro', `barbeiro #${id}`);
      return id;
    });
  } catch (erro) {
    const http = comoErroHttp(erro);
    if (http) throw http;
    if (/UNIQUE constraint/i.test(String(erro.message))) {
      throw new ErroHttp(409, 'estado_invalido', 'Login já está em uso.');
    }
    throw erro;
  }

  const linha = db
    .prepare(
      `SELECT b.*, u.nome, u.sobrenome FROM barbeiros b
         JOIN usuarios u ON u.id = b.usuario_id WHERE b.id = ?`
    )
    .get(barbeiroId);
  enviarJson(res, 201, { barbeiro: barbeiroObj(linha) });
}

function atualizarBarbeiroAdmin(ctx) {
  const { db, usuario, corpo, res } = ctx;
  auth.exigirAdmin(usuario);
  const atual = db
    .prepare(
      `SELECT b.*, u.nome, u.sobrenome, u.login, u.ativo AS usuario_ativo
         FROM barbeiros b JOIN usuarios u ON u.id = b.usuario_id WHERE b.id = ?`
    )
    .get(ctx.id);
  if (!atual) throw new ErroHttp(404, 'nao_encontrado', 'Barbeiro não encontrado.');

  const dados = validarNovoBarbeiro(corpo, { senhaObrigatoria: false });
  let ativo = null;
  if (corpo.ativo !== undefined) {
    ativo = booleanoValido(corpo.ativo);
    if (ativo === null) throw new ErroHttp(422, 'validacao', 'ativo inválido.');
  }

  try {
    transacao(db, () => {
      if (dados.login !== atual.login) {
        const outro = db
          .prepare('SELECT id FROM usuarios WHERE login = ? AND id <> ?')
          .get(dados.login, atual.usuario_id);
        if (outro) throw new ErroHttp(409, 'estado_invalido', 'Login já está em uso.');
      }
      const agora = agoraLocal();
      db.prepare(
        `UPDATE usuarios SET nome = ?, sobrenome = ?, login = ?, atualizado_em = ?
          WHERE id = ?`
      ).run(dados.nome, dados.sobrenome, dados.login, agora.texto, atual.usuario_id);
      if (dados.senha) {
        db.prepare('UPDATE usuarios SET senha_hash = ?, atualizado_em = ? WHERE id = ?').run(
          auth.hashSegredo(dados.senha),
          agora.texto,
          atual.usuario_id
        );
      }
      if (ativo !== null) {
        db.prepare('UPDATE usuarios SET ativo = ?, atualizado_em = ? WHERE id = ?').run(
          ativo ? 1 : 0,
          agora.texto,
          atual.usuario_id
        );
        db.prepare('UPDATE barbeiros SET ativo = ?, atualizado_em = ? WHERE id = ?').run(
          ativo ? 1 : 0,
          agora.texto,
          atual.id
        );
        if (!ativo) auth.apagarSessoesDoUsuario(db, atual.usuario_id);
      }
      db.prepare(
        `UPDATE barbeiros SET apelido = ?, especialidades = ?, bio = ?, foto_url = ?, atualizado_em = ?
          WHERE id = ?`
      ).run(
        dados.apelido ?? atual.apelido,
        JSON.stringify(
          dados.especialidades !== undefined
            ? dados.especialidades
            : jsonSeguro(atual.especialidades, [])
        ),
        dados.bio ?? atual.bio,
        dados.fotoUrl ?? atual.foto_url,
        agora.texto,
        atual.id
      );
      auditar(db, usuario, 'atualizar_barbeiro', `barbeiro #${atual.id}`);
    });
  } catch (erro) {
    const http = comoErroHttp(erro);
    if (http) throw http;
    if (/UNIQUE constraint/i.test(String(erro.message))) {
      throw new ErroHttp(409, 'estado_invalido', 'Login já está em uso.');
    }
    throw erro;
  }

  const linha = db
    .prepare(
      `SELECT b.*, u.nome, u.sobrenome FROM barbeiros b
         JOIN usuarios u ON u.id = b.usuario_id WHERE b.id = ?`
    )
    .get(atual.id);
  enviarJson(res, 200, { barbeiro: barbeiroObj(linha) });
}

function criarServicoAdmin(ctx) {
  const { db, usuario, corpo, res } = ctx;
  auth.exigirAdmin(usuario);
  const dados = validarServico(corpo, { parcial: false });
  const agora = agoraLocal();
  const id = Number(
    db
      .prepare(
        `INSERT INTO servicos
           (nome, descricao, preco_centavos, duracao_min, ativo, criado_em, atualizado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        dados.nome,
        dados.descricao,
        dados.precoCentavos,
        dados.duracaoMin,
        dados.ativo === undefined ? 1 : dados.ativo ? 1 : 0,
        agora.texto,
        agora.texto
      ).lastInsertRowid
  );
  auditar(db, usuario, 'criar_servico', `servico #${id}`);
  const linha = db.prepare('SELECT * FROM servicos WHERE id = ?').get(id);
  enviarJson(res, 201, { servico: servicoObj(linha) });
}

function atualizarServicoAdmin(ctx) {
  const { db, usuario, corpo, res } = ctx;
  auth.exigirAdmin(usuario);
  const atual = db.prepare('SELECT * FROM servicos WHERE id = ?').get(ctx.id);
  if (!atual) throw new ErroHttp(404, 'nao_encontrado', 'Serviço não encontrado.');
  const dados = validarServico(corpo, { parcial: true });
  const agora = agoraLocal();
  db.prepare(
    `UPDATE servicos
        SET nome = ?, descricao = ?, preco_centavos = ?, duracao_min = ?, ativo = ?, atualizado_em = ?
      WHERE id = ?`
  ).run(
    dados.nome ?? atual.nome,
    dados.descricao ?? atual.descricao,
    dados.precoCentavos ?? atual.preco_centavos,
    dados.duracaoMin ?? atual.duracao_min,
    dados.ativo === undefined ? atual.ativo : dados.ativo ? 1 : 0,
    agora.texto,
    atual.id
  );
  auditar(db, usuario, 'atualizar_servico', `servico #${atual.id}`);
  const linha = db.prepare('SELECT * FROM servicos WHERE id = ?').get(atual.id);
  enviarJson(res, 200, { servico: servicoObj(linha) });
}

function listarClientesAdmin(ctx) {
  const { db, res } = ctx;
  auth.exigirAdmin(ctx.usuario);
  const linhas = db
    .prepare(
      `SELECT u.id, u.nome, u.sobrenome, u.telefone, u.criado_em,
              (SELECT COUNT(*) FROM agendamentos a WHERE a.cliente_id = u.id) AS agendamentos
         FROM usuarios u WHERE u.papel = 'cliente' ORDER BY u.id`
    )
    .all();
  enviarJson(res, 200, {
    clientes: linhas.map((linha) => ({
      id: Number(linha.id),
      nome: linha.nome,
      sobrenome: linha.sobrenome,
      telefone: linha.telefone,
      criadoEm: linha.criado_em,
      agendamentos: Number(linha.agendamentos),
    })),
  });
}

function redefinirPinAdmin(ctx) {
  const { db, usuario, corpo, res } = ctx;
  auth.exigirAdmin(usuario);
  const cliente = db
    .prepare("SELECT * FROM usuarios WHERE id = ? AND papel = 'cliente'")
    .get(ctx.id);
  if (!cliente) throw new ErroHttp(404, 'nao_encontrado', 'Cliente não encontrado.');
  if (typeof corpo.pin !== 'string' || !/^\d{4,6}$/.test(corpo.pin)) {
    throw new ErroHttp(422, 'validacao', 'PIN deve ter de 4 a 6 dígitos.');
  }
  db.prepare('UPDATE usuarios SET pin_hash = ?, atualizado_em = ? WHERE id = ?').run(
    auth.hashSegredo(corpo.pin),
    agoraLocal().texto,
    cliente.id
  );
  auditar(db, usuario, 'redefinir_pin_cliente', `cliente #${cliente.id}`);
  const atualizado = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(cliente.id);
  enviarJson(res, 200, { usuario: auth.usuarioPublico(atualizado) });
}

function atualizarJornadasAdmin(ctx) {
  const { db, usuario, corpo, res } = ctx;
  auth.exigirAdmin(usuario);
  const barbeiro = db.prepare('SELECT id FROM barbeiros WHERE id = ?').get(ctx.id);
  if (!barbeiro) throw new ErroHttp(404, 'nao_encontrado', 'Barbeiro não encontrado.');
  const jornadas = validarJornadas(corpo);

  transacao(db, () => {
    db.prepare('DELETE FROM jornadas WHERE barbeiro_id = ?').run(barbeiro.id);
    const inserir = db.prepare(
      `INSERT INTO jornadas
         (barbeiro_id, dia_semana, ativo, inicio, fim, intervalo_inicio, intervalo_fim)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const j of jornadas) {
      inserir.run(
        barbeiro.id,
        j.diaSemana,
        j.ativo ? 1 : 0,
        j.inicio,
        j.fim,
        j.intervaloInicio,
        j.intervaloFim
      );
    }
    auditar(db, usuario, 'atualizar_jornadas', `barbeiro #${barbeiro.id}`);
  });

  const linhas = db
    .prepare('SELECT * FROM jornadas WHERE barbeiro_id = ? ORDER BY dia_semana')
    .all(barbeiro.id);
  enviarJson(res, 200, { jornadas: linhas.map(jornadaObj) });
}

function obterConfigAdmin(ctx) {
  auth.exigirAdmin(ctx.usuario);
  enviarJson(ctx.res, 200, configObj(ctx.db));
}

function atualizarConfigAdmin(ctx) {
  const { db, usuario, corpo, res } = ctx;
  auth.exigirAdmin(usuario);
  const atualizacoes = [];

  if (corpo.nomeBarbearia !== undefined) {
    atualizacoes.push(['nomeBarbearia', exigirNome(corpo.nomeBarbearia, 'nomeBarbearia', { min: 2, max: 100 })]);
  }
  if (corpo.endereco !== undefined) {
    const v = exigirTextoOpcional(corpo.endereco, 'endereco', 200);
    if (!v) throw new ErroHttp(422, 'validacao', 'endereco inválido.');
    atualizacoes.push(['endereco', v]);
  }
  if (corpo.telefoneContato !== undefined) {
    const v = exigirTextoOpcional(corpo.telefoneContato, 'telefoneContato', 40);
    if (!v) throw new ErroHttp(422, 'validacao', 'telefoneContato inválido.');
    atualizacoes.push(['telefoneContato', v]);
  }
  if (corpo.horarioFuncionamento !== undefined) {
    const v = exigirTextoOpcional(corpo.horarioFuncionamento, 'horarioFuncionamento', 100);
    if (!v) throw new ErroHttp(422, 'validacao', 'horarioFuncionamento inválido.');
    atualizacoes.push(['horarioFuncionamento', v]);
  }
  if (corpo.antecedenciaMinMin !== undefined) {
    atualizacoes.push([
      'antecedenciaMinMin',
      String(exigirInteiro(corpo.antecedenciaMinMin, 'antecedenciaMinMin', { min: 0, max: 1440 })),
    ]);
  }
  if (corpo.antecedenciaMaxDias !== undefined) {
    atualizacoes.push([
      'antecedenciaMaxDias',
      String(exigirInteiro(corpo.antecedenciaMaxDias, 'antecedenciaMaxDias', { min: 1, max: 3650 })),
    ]);
  }
  if (corpo.fuso !== undefined) {
    if (corpo.fuso !== util.TZ) {
      throw new ErroHttp(422, 'validacao', `O fuso da barbearia é ${util.TZ}.`);
    }
    atualizacoes.push(['fuso', util.TZ]);
  }
  if (atualizacoes.length === 0 && !Array.isArray(corpo.feriados)) {
    throw new ErroHttp(422, 'validacao', 'Nenhum campo de configuração informado.');
  }

  if (atualizacoes.length > 0) {
    const agora = agoraLocal().texto;
    const upsert = db.prepare(
      `INSERT INTO configuracoes (chave, valor, atualizado_em) VALUES (?, ?, ?)
       ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em`
    );
    transacao(db, () => {
      for (const [chave, valor] of atualizacoes) upsert.run(chave, valor, agora);
      auditar(db, usuario, 'atualizar_config', 'configurações da barbearia');
    });
  }

  enviarJson(res, 200, configObj(db));
}

function criarFeriadoAdmin(ctx) {
  const { db, usuario, corpo, res } = ctx;
  auth.exigirAdmin(usuario);
  const data = exigirData(corpo.data);
  const descricao = exigirNome(corpo.descricao, 'descricao', { min: 1, max: 200 });
  const existente = db.prepare('SELECT 1 FROM feriados WHERE data = ?').get(data);
  if (existente) throw new ErroHttp(409, 'estado_invalido', 'Já existe feriado nesta data.');
  db.prepare('INSERT INTO feriados (data, descricao, criado_em) VALUES (?, ?, ?)').run(
    data,
    descricao,
    agoraLocal().texto
  );
  auditar(db, usuario, 'criar_feriado', `feriado ${data}`);
  enviarJson(res, 201, { feriado: { data, descricao } });
}

function removerFeriadoAdmin(ctx) {
  const { db, usuario, res } = ctx;
  auth.exigirAdmin(usuario);
  const data = ctx.parametro;
  if (!validarData(data)) throw new ErroHttp(422, 'validacao', 'Data do feriado inválida.');
  const info = db.prepare('DELETE FROM feriados WHERE data = ?').run(data);
  if (Number(info.changes) === 0) {
    throw new ErroHttp(404, 'nao_encontrado', 'Feriado não encontrado.');
  }
  auditar(db, usuario, 'remover_feriado', `feriado ${data}`);
  enviar204(res);
}

function resetDemo(ctx) {
  const { db, usuario, token, res } = ctx;
  auth.exigirAdmin(usuario);
  let info;
  transacao(db, () => {
    seed.limparDados(db);
    info = seed.semear(db);
    if (token) {
      auth.registrarSessaoExistente(db, info.adminId, token);
    }
    auditar(db, 'admin', 'reset_demo', 'dados de demonstração recriados');
  });
  enviarJson(res, 200, { ok: true, reiniciado: true });
}

function listarAuditoria(ctx) {
  const { db, url, res } = ctx;
  auth.exigirAdmin(ctx.usuario);
  let limite = 50;
  const param = url.searchParams.get('limite');
  if (param !== null && param !== '') {
    const n = inteiroValido(param);
    if (n === null || n < 1 || n > 500) {
      throw new ErroHttp(422, 'validacao', 'limite deve ser um inteiro entre 1 e 500.');
    }
    limite = n;
  }
  const linhas = db
    .prepare(
      `SELECT id, usuario, acao, detalhe, em FROM auditoria
        ORDER BY id DESC LIMIT ?`
    )
    .all(limite);
  enviarJson(res, 200, {
    eventos: linhas.map((linha) => ({
      id: Number(linha.id),
      usuario: linha.usuario,
      acao: linha.acao,
      detalhe: linha.detalhe || '',
      em: linha.em,
    })),
  });
}

// ---------------------------------------------------------------------------
// Roteamento
// ---------------------------------------------------------------------------

function criarManipulador({ db, publicDir, versao = '1.0.0' }) {
  async function manipulador(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
        "script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'self'; " +
        "form-action 'self'; frame-ancestors 'none'"
    );
    const metodo = String(req.method || 'GET').toUpperCase();
    let url;
    try {
      url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    } catch {
      enviarJson(res, 400, { erro: 'requisicao_invalida', mensagem: 'URL inválida.' });
      return;
    }
    const caminho = url.pathname;

    if (!caminho.startsWith('/api')) {
      try {
        servirEstatico(req, res, caminho, publicDir);
      } catch (erro) {
        tratarErro(res, erro);
      }
      return;
    }

    try {
      if (caminho === '/api/health' && metodo === 'GET') {
        enviarJson(res, 200, {
          ok: true,
          versao,
          hora: agoraLocal().texto,
        });
        return;
      }

      const mutacao = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(metodo);
      let chaveLimite = null;
      if (mutacao) {
        checarOrigem(req);
        if (metodo !== 'DELETE') exigirConteudoJson(req);
        if (metodo === 'POST' && caminho === '/api/login') {
          // O limite de login é aplicado no handler (e liberado em caso de sucesso).
        } else if (metodo === 'POST' && caminho === '/api/clientes') {
          // aplicado no handler de cadastro
        } else {
          chaveLimite = verificarLimiteMutacao(req);
          res.once('finish', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              registrarMutacaoSucesso(chaveLimite);
            }
          });
        }
      }

      let corpo = null;
      if (metodo === 'POST' || metodo === 'PUT' || metodo === 'PATCH') {
        corpo = await lerCorpoJson(req);
      }

      const usuario = auth.usuarioDaRequisicao(req, db);
      const token = auth.tokenDaRequisicao(req);
      const ctx = {
        req,
        res,
        url,
        db,
        usuario,
        token,
        corpo: corpo || {},
        metodo,
        caminho,
        id: null,
        parametro: null,
        chaveLimite,
      };

      // Público / cliente
      if (caminho === '/api/login' && metodo === 'POST') return login(ctx);
      if (caminho === '/api/logout' && metodo === 'POST') return logout(ctx);
      if (caminho === '/api/me' && metodo === 'GET') return me(ctx);
      if (caminho === '/api/sessao' && metodo === 'GET') return sessao(ctx);
      if (caminho === '/api/barbeiros' && metodo === 'GET') return listarBarbeiros(ctx);
      if (caminho === '/api/servicos' && metodo === 'GET') return listarServicos(ctx);
      if (caminho === '/api/configuracoes' && metodo === 'GET') return obterConfiguracoes(ctx);
      if (caminho === '/api/clientes' && metodo === 'POST') return criarCliente(ctx);
      if (caminho === '/api/clientes/me' && metodo === 'PATCH') return atualizarClienteMe(ctx);
      if (caminho === '/api/disponibilidade' && metodo === 'GET') return consultarDisponibilidade(ctx);
      if (caminho === '/api/disponibilidade/resumo' && metodo === 'GET') {
        return consultarResumoDisponibilidade(ctx);
      }
      if (caminho === '/api/agendamentos' && metodo === 'POST') return criarAgendamento(ctx);
      if (caminho === '/api/agendamentos' && metodo === 'GET') return listarAgendamentos(ctx);
      if (caminho === '/api/minha-agenda' && metodo === 'GET') return minhaAgenda(ctx);
      if (caminho === '/api/bloqueios' && metodo === 'POST') return criarBloqueio(ctx);
      if (caminho === '/api/bloqueios' && metodo === 'GET') return listarBloqueios(ctx);

      let m = caminho.match(/^\/api\/agendamentos\/(\d+)\/reagendar$/);
      if (m && metodo === 'PATCH') {
        ctx.id = Number(m[1]);
        return reagendar(ctx);
      }
      m = caminho.match(/^\/api\/agendamentos\/(\d+)\/cancelar$/);
      if (m && metodo === 'PATCH') {
        ctx.id = Number(m[1]);
        return cancelar(ctx);
      }
      m = caminho.match(/^\/api\/agendamentos\/(\d+)\/status$/);
      if (m && metodo === 'PATCH') {
        ctx.id = Number(m[1]);
        return atualizarStatusAgendamento(ctx);
      }
      m = caminho.match(/^\/api\/bloqueios\/(\d+)$/);
      if (m && metodo === 'DELETE') {
        ctx.id = Number(m[1]);
        return removerBloqueio(ctx);
      }

      // Admin
      if (caminho === '/api/admin/dashboard' && metodo === 'GET') return dashboard(ctx);
      if (caminho === '/api/admin/barbeiros' && metodo === 'POST') return criarBarbeiroAdmin(ctx);
      if (caminho === '/api/admin/servicos' && metodo === 'POST') return criarServicoAdmin(ctx);
      if (caminho === '/api/admin/clientes' && metodo === 'GET') return listarClientesAdmin(ctx);
      if (caminho === '/api/admin/config' && metodo === 'GET') return obterConfigAdmin(ctx);
      if (caminho === '/api/admin/config' && metodo === 'PUT') return atualizarConfigAdmin(ctx);
      if (caminho === '/api/admin/feriados' && metodo === 'POST') return criarFeriadoAdmin(ctx);
      if (caminho === '/api/admin/reset-demo' && metodo === 'POST') return resetDemo(ctx);
      if (caminho === '/api/auditoria' && metodo === 'GET') return listarAuditoria(ctx);

      m = caminho.match(/^\/api\/admin\/barbeiros\/(\d+)\/jornadas$/);
      if (m && metodo === 'PUT') {
        ctx.id = Number(m[1]);
        return atualizarJornadasAdmin(ctx);
      }
      m = caminho.match(/^\/api\/admin\/barbeiros\/(\d+)$/);
      if (m && metodo === 'PUT') {
        ctx.id = Number(m[1]);
        return atualizarBarbeiroAdmin(ctx);
      }
      m = caminho.match(/^\/api\/admin\/servicos\/(\d+)$/);
      if (m && metodo === 'PUT') {
        ctx.id = Number(m[1]);
        return atualizarServicoAdmin(ctx);
      }
      m = caminho.match(/^\/api\/admin\/clientes\/(\d+)\/pin$/);
      if (m && metodo === 'PATCH') {
        ctx.id = Number(m[1]);
        return redefinirPinAdmin(ctx);
      }
      m = caminho.match(/^\/api\/admin\/feriados\/([^/]+)$/);
      if (m && metodo === 'DELETE') {
        try {
          ctx.parametro = decodeURIComponent(m[1]);
        } catch {
          throw new ErroHttp(422, 'validacao', 'Data do feriado inválida.');
        }
        return removerFeriadoAdmin(ctx);
      }

      enviarJson(res, 404, {
        erro: 'nao_encontrado',
        mensagem: 'Rota não encontrada.',
      });
    } catch (erro) {
      tratarErro(res, erro);
    }
  }

  return manipulador;
}

module.exports = {
  criarManipulador,
  // exportados para testes/inspeção
  _internos: {
    configObj,
    agendamentoObj,
    barbeiroObj,
    servicoObj,
    bloqueioObj,
    limitar,
    liberarLimite,
    BALDES,
  },
};
