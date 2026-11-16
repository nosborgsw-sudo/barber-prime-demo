'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { agoraLocal, ErroHttp } = require('./util');

const TABELAS_AUTOINCREMENTO = [
  'usuarios',
  'barbeiros',
  'servicos',
  'jornadas',
  'bloqueios',
  'agendamentos',
  'historico_agendamentos',
  'auditoria',
  'sessoes',
];

const MIGRACOES = [
  {
    versao: 1,
    nome: 'esquema_inicial',
    sql: `
      CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        papel TEXT NOT NULL CHECK (papel IN ('cliente','barbeiro','admin')),
        nome TEXT NOT NULL,
        sobrenome TEXT NOT NULL DEFAULT '',
        telefone TEXT,
        login TEXT,
        senha_hash TEXT,
        pin_hash TEXT,
        ativo INTEGER NOT NULL DEFAULT 1,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_login
        ON usuarios(login) WHERE login IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_telefone
        ON usuarios(telefone) WHERE telefone IS NOT NULL;

      CREATE TABLE IF NOT EXISTS barbeiros (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
        apelido TEXT,
        especialidades TEXT NOT NULL DEFAULT '[]',
        bio TEXT,
        foto_url TEXT,
        ativo INTEGER NOT NULL DEFAULT 1,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS servicos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        descricao TEXT NOT NULL DEFAULT '',
        preco_centavos INTEGER NOT NULL DEFAULT 0 CHECK (preco_centavos >= 0),
        duracao_min INTEGER NOT NULL CHECK (duracao_min > 0),
        ativo INTEGER NOT NULL DEFAULT 1,
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jornadas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barbeiro_id INTEGER NOT NULL REFERENCES barbeiros(id) ON DELETE CASCADE,
        dia_semana INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
        ativo INTEGER NOT NULL DEFAULT 1,
        inicio TEXT NOT NULL DEFAULT '09:00',
        fim TEXT NOT NULL DEFAULT '18:00',
        intervalo_inicio TEXT,
        intervalo_fim TEXT,
        UNIQUE (barbeiro_id, dia_semana)
      );
      CREATE INDEX IF NOT EXISTS ix_jornadas_barbeiro ON jornadas(barbeiro_id);

      CREATE TABLE IF NOT EXISTS bloqueios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barbeiro_id INTEGER REFERENCES barbeiros(id) ON DELETE CASCADE,
        data TEXT NOT NULL,
        hora_inicio TEXT NOT NULL,
        hora_fim TEXT NOT NULL,
        motivo TEXT NOT NULL DEFAULT '',
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_bloqueios_data ON bloqueios(data);
      CREATE INDEX IF NOT EXISTS ix_bloqueios_barbeiro ON bloqueios(barbeiro_id, data);

      CREATE TABLE IF NOT EXISTS agendamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER NOT NULL REFERENCES usuarios(id),
        barbeiro_id INTEGER NOT NULL REFERENCES barbeiros(id),
        servico_id INTEGER NOT NULL REFERENCES servicos(id),
        data TEXT NOT NULL,
        hora TEXT NOT NULL,
        duracao_min INTEGER NOT NULL,
        preco_centavos INTEGER NOT NULL,
        inicio TEXT NOT NULL,
        fim TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'agendado'
          CHECK (status IN ('agendado','concluido','cancelado','faltou')),
        criado_em TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_agendamentos_barbeiro_inicio
        ON agendamentos(barbeiro_id, inicio);
      CREATE INDEX IF NOT EXISTS ix_agendamentos_cliente ON agendamentos(cliente_id);
      CREATE INDEX IF NOT EXISTS ix_agendamentos_data ON agendamentos(data);

      CREATE TABLE IF NOT EXISTS historico_agendamentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agendamento_id INTEGER NOT NULL REFERENCES agendamentos(id) ON DELETE CASCADE,
        acao TEXT NOT NULL,
        de_status TEXT,
        para_status TEXT,
        usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        em TEXT NOT NULL,
        detalhe TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_historico_agendamento
        ON historico_agendamentos(agendamento_id);

      CREATE TABLE IF NOT EXISTS configuracoes (
        chave TEXT PRIMARY KEY,
        valor TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS feriados (
        data TEXT PRIMARY KEY,
        descricao TEXT NOT NULL,
        criado_em TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS auditoria (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario TEXT NOT NULL,
        acao TEXT NOT NULL,
        detalhe TEXT,
        em TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_auditoria_em ON auditoria(em);

      CREATE TABLE IF NOT EXISTS sessoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT NOT NULL UNIQUE,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        criado_em TEXT NOT NULL,
        expira_em INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_sessoes_token ON sessoes(token_hash);
      CREATE INDEX IF NOT EXISTS ix_sessoes_usuario ON sessoes(usuario_id);
    `,
  },
];

function caminhoPadrao() {
  return path.join(__dirname, '..', 'data', 'barberprime.db');
}

function aplicarMigracoes(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migracoes (
      versao INTEGER PRIMARY KEY,
      nome TEXT NOT NULL,
      aplicada_em TEXT NOT NULL
    );
  `);
  const aplicadas = new Set(
    db.prepare('SELECT versao FROM schema_migracoes').all().map((r) => Number(r.versao))
  );
  for (const migracao of MIGRACOES) {
    if (aplicadas.has(migracao.versao)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      // Reconfere dentro do lock: outro processo pode ter aplicado a migração
      // enquanto esperávamos o BEGIN IMMEDIATE.
      const jaAplicada = db
        .prepare('SELECT 1 AS ok FROM schema_migracoes WHERE versao = ?')
        .get(migracao.versao);
      if (jaAplicada) {
        db.exec('COMMIT');
        aplicadas.add(migracao.versao);
        continue;
      }
      db.exec(migracao.sql);
      db.prepare(
        'INSERT INTO schema_migracoes (versao, nome, aplicada_em) VALUES (?, ?, ?)'
      ).run(migracao.versao, migracao.nome, agoraLocal().texto);
      db.exec('COMMIT');
      aplicadas.add(migracao.versao);
    } catch (erro) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignora */
      }
      throw erro;
    }
  }
}

/**
 * Abre o banco, habilita FKs/WAL e aplica as migrações versionadas.
 * @param {string} dbPath caminho do arquivo ou ':memory:'
 */
function abrirBanco(dbPath) {
  const caminho = dbPath || process.env.DB_PATH || caminhoPadrao();
  const memoria = caminho === ':memory:';
  if (!memoria) {
    const dir = path.dirname(path.resolve(caminho));
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new DatabaseSync(caminho, { timeout: 5000 });
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (!memoria) {
    try {
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA synchronous = NORMAL');
    } catch {
      /* WAL é melhor esforço; o banco continua utilizável */
    }
  }
  aplicarMigracoes(db);
  return db;
}

/** Executa fn dentro de BEGIN IMMEDIATE/COMMIT, com ROLLBACK em erro. */
function transacao(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (erro) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignora */
    }
    throw erro;
  }
}

/** Limpa resíduos de AUTOINCREMENT (usado pelo reset-demo). */
function zerarSequencias(db) {
  try {
    const marcas = TABELAS_AUTOINCREMENTO.map(() => '?').join(',');
    db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${marcas})`).run(
      ...TABELAS_AUTOINCREMENTO
    );
  } catch {
    /* sqlite_sequence pode não existir em banco nunca escrito */
  }
}

/** Converte erro de lock do SQLite em resposta de conflito. */
function comoErroHttp(erro) {
  if (erro instanceof ErroHttp) return erro;
  const mensagem = String(erro && erro.message ? erro.message : erro);
  if (/database is locked|SQLITE_BUSY/i.test(mensagem)) {
    return new ErroHttp(
      409,
      'horario_indisponivel',
      'O horário não está mais disponível. Tente novamente.'
    );
  }
  return null;
}

module.exports = {
  abrirBanco,
  transacao,
  zerarSequencias,
  comoErroHttp,
  caminhoPadrao,
  TABELAS_AUTOINCREMENTO,
};
