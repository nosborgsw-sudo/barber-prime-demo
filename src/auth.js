'use strict';

const crypto = require('node:crypto');
const { agoraLocal, ErroHttp } = require('./util');

const COOKIE_SESSAO = 'bp_sess';
const DURACAO_SESSAO_MS = 7 * 24 * 60 * 60 * 1000;
const TAMANHO_TOKEN = 32;
const CHAVE_SCRYPT = 64;

/**
 * scrypt com salt individual.
 * Formato armazenado: scrypt$1$<salt-hex>$<hash-hex>
 */
function hashSegredo(segredo) {
  const salt = crypto.randomBytes(16);
  const derivado = crypto.scryptSync(String(segredo), salt, CHAVE_SCRYPT);
  return `scrypt$1$${salt.toString('hex')}$${derivado.toString('hex')}`;
}

function verificarSegredo(segredo, armazenado) {
  if (typeof armazenado !== 'string') return false;
  const partes = armazenado.split('$');
  if (partes.length !== 4 || partes[0] !== 'scrypt') return false;
  let salt;
  let esperado;
  try {
    salt = Buffer.from(partes[2], 'hex');
    esperado = Buffer.from(partes[3], 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || esperado.length === 0) return false;
  let calculado;
  try {
    calculado = crypto.scryptSync(String(segredo), salt, esperado.length);
  } catch {
    return false;
  }
  if (calculado.length !== esperado.length) return false;
  return crypto.timingSafeEqual(calculado, esperado);
}

// Usado para gastar tempo mesmo quando o login não existe (evita enumeração).
const HASH_FICTICIO = hashSegredo('tempo-constante-barber-prime');

function compararComFicticio(segredo) {
  verificarSegredo(segredo, HASH_FICTICIO);
  return false;
}

function tokenAleatorio() {
  return crypto.randomBytes(TAMANHO_TOKEN).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function lerCookie(req, nome = COOKIE_SESSAO) {
  const cabecalho = req.headers && req.headers.cookie;
  if (!cabecalho) return null;
  for (const parte of String(cabecalho).split(';')) {
    const indice = parte.indexOf('=');
    if (indice < 0) continue;
    const chave = parte.slice(0, indice).trim();
    if (chave !== nome) continue;
    const valor = parte.slice(indice + 1).trim();
    try {
      return decodeURIComponent(valor);
    } catch {
      return valor;
    }
  }
  return null;
}

function tokenDaRequisicao(req) {
  const token = lerCookie(req);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return token;
}

function cookieSessao(token) {
  return `${COOKIE_SESSAO}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`;
}

function cookieLimparSessao() {
  return `${COOKIE_SESSAO}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

/** Cria sessão no banco; o token só existe em claro no cookie. */
function criarSessao(db, usuarioId) {
  const token = tokenAleatorio();
  const agora = agoraLocal();
  const expiraEm = Date.now() + DURACAO_SESSAO_MS;
  db.prepare(
    'INSERT INTO sessoes (token_hash, usuario_id, criado_em, expira_em) VALUES (?, ?, ?, ?)'
  ).run(hashToken(token), usuarioId, agora.texto, expiraEm);
  return { token, expiraEm };
}

function registrarSessaoExistente(db, usuarioId, token, expiraEm = Date.now() + DURACAO_SESSAO_MS) {
  if (!token) return false;
  db.prepare(
    'INSERT OR REPLACE INTO sessoes (token_hash, usuario_id, criado_em, expira_em) VALUES (?, ?, ?, ?)'
  ).run(hashToken(token), usuarioId, agoraLocal().texto, expiraEm);
  return true;
}

function apagarSessao(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(hashToken(token));
}

function apagarSessoesDoUsuario(db, usuarioId) {
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(usuarioId);
}

/**
 * Retorna a linha completa do usuário autenticado (com barbeiro_id quando aplicável)
 * ou null. Sessões expiradas são removidas oportunisticamente.
 */
function usuarioDaRequisicao(req, db) {
  const token = tokenDaRequisicao(req);
  if (!token) return null;
  const agoraMs = Date.now();
  db.prepare('DELETE FROM sessoes WHERE expira_em <= ?').run(agoraMs);
  const linha = db
    .prepare(
      `SELECT u.*, b.id AS barbeiro_id
         FROM sessoes s
         JOIN usuarios u ON u.id = s.usuario_id
         LEFT JOIN barbeiros b ON b.usuario_id = u.id
        WHERE s.token_hash = ? AND s.expira_em > ? AND u.ativo = 1`
    )
    .get(hashToken(token), agoraMs);
  if (!linha) return null;
  // Normaliza o apelido da coluna para uso direto nos handlers.
  if (linha.barbeiro_id !== null && linha.barbeiro_id !== undefined) {
    linha.barbeiroId = Number(linha.barbeiro_id);
  }
  return linha;
}

function exigirUsuario(usuario) {
  if (!usuario) {
    throw new ErroHttp(401, 'nao_autenticado', 'Faça login para continuar.');
  }
  return usuario;
}

function exigirPapel(usuario, papeis) {
  exigirUsuario(usuario);
  const permitidos = Array.isArray(papeis) ? papeis : [papeis];
  if (!permitidos.includes(usuario.papel)) {
    throw new ErroHttp(403, 'sem_permissao', 'Você não tem permissão para esta ação.');
  }
  return usuario;
}

function exigirAdmin(usuario) {
  return exigirPapel(usuario, 'admin');
}

function usuarioPublico(usuario) {
  if (!usuario) return null;
  const saida = {
    id: Number(usuario.id),
    papel: usuario.papel,
    nome: usuario.nome,
    sobrenome: usuario.sobrenome || '',
    telefone: usuario.telefone || null,
    login: usuario.login || null,
  };
  if (usuario.papel === 'barbeiro' && usuario.barbeiro_id) {
    saida.barbeiroId = Number(usuario.barbeiro_id);
  }
  return saida;
}

module.exports = {
  COOKIE_SESSAO,
  DURACAO_SESSAO_MS,
  hashSegredo,
  verificarSegredo,
  compararComFicticio,
  tokenAleatorio,
  hashToken,
  lerCookie,
  tokenDaRequisicao,
  cookieSessao,
  cookieLimparSessao,
  criarSessao,
  registrarSessaoExistente,
  apagarSessao,
  apagarSessoesDoUsuario,
  usuarioDaRequisicao,
  exigirUsuario,
  exigirPapel,
  exigirAdmin,
  usuarioPublico,
};
