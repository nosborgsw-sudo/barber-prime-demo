'use strict';

const http = require('node:http');
const path = require('node:path');

const { abrirBanco, transacao, caminhoPadrao } = require('./src/db');
const seed = require('./src/seed');
const { criarManipulador } = require('./src/api');

let VERSAO = '1.0.0';
try {
  VERSAO = require('./package.json').version || VERSAO;
} catch {
  /* mantém a versão padrão */
}

/**
 * Cria a aplicação (banco + servidor HTTP) sem escutar porta.
 * @param {{dbPath?: string}} opcoes
 * @returns {{server: import('node:http').Server, db: object, close: () => Promise<void>}}
 */
function createApp({ dbPath } = {}) {
  const caminhoBanco = dbPath || process.env.DB_PATH || caminhoPadrao();
  const db = abrirBanco(caminhoBanco);

  // Seed determinístico apenas em banco vazio. A checagem é refeita dentro do
  // BEGIN IMMEDIATE para dois processos não semearem em duplicidade.
  transacao(db, () => {
    if (seed.bancoVazio(db)) seed.semear(db);
  });

  const publicDir = path.join(__dirname, 'public');
  const manipulador = criarManipulador({ db, publicDir, versao: VERSAO });

  const server = http.createServer((req, res) => {
    Promise.resolve(manipulador(req, res)).catch((erro) => {
      if (res.writableEnded) return;
      console.error(
        '[barber-prime] erro não tratado:',
        erro && erro.message ? erro.message : String(erro)
      );
      if (!res.headersSent) {
        const corpo = JSON.stringify({
          erro: 'erro_interno',
          mensagem: 'Erro interno. Tente novamente.',
        });
        res.writeHead(500, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(corpo),
          'Cache-Control': 'no-store',
        });
        res.end(corpo);
      } else {
        res.end();
      }
    });
  });

  let fechamento = null;
  function close() {
    if (fechamento) return fechamento;
    fechamento = new Promise((resolve) => {
      let finalizado = false;
      const concluir = () => {
        if (finalizado) return;
        finalizado = true;
        try {
          db.close();
        } catch {
          /* já fechado */
        }
        resolve();
      };

      if (!server.listening) {
        concluir();
        return;
      }

      server.close(() => concluir());
      if (typeof server.closeIdleConnections === 'function') {
        server.closeIdleConnections();
      }
      const timer = setTimeout(() => {
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
      }, 50);
      if (typeof timer.unref === 'function') timer.unref();
    });
    return fechamento;
  }

  return { server, db, close };
}

/**
 * Cria a aplicação e começa a escutar.
 * @param {{port?: number, dbPath?: string}} opcoes
 * @returns {Promise<{server: object, port: number, db: object, close: () => Promise<void>}>}
 */
function start({ port, dbPath } = {}) {
  const app = createApp({ dbPath });
  const porta =
    port === undefined || port === null ? Number(process.env.PORT || 3000) : Number(port);

  return new Promise((resolve, reject) => {
    const aoFalhar = (erro) => {
      app.server.removeListener('error', aoFalhar);
      app.close();
      reject(erro);
    };
    app.server.once('error', aoFalhar);
    app.server.listen(porta, () => {
      app.server.removeListener('error', aoFalhar);
      const portaReal = app.server.address().port;
      resolve({ server: app.server, port: portaReal, db: app.db, close: app.close });
    });
  });
}

if (require.main === module) {
  start()
    .then(({ port, close }) => {
      console.log(`Barber Prime ouvindo em http://localhost:${port}`);
      let encerrando = false;
      const encerrar = () => {
        if (encerrando) return;
        encerrando = true;
        close().finally(() => process.exit(0));
      };
      process.on('SIGINT', encerrar);
      process.on('SIGTERM', encerrar);
    })
    .catch((erro) => {
      console.error('Falha ao iniciar o servidor:', erro && erro.message ? erro.message : erro);
      process.exit(1);
    });
}

module.exports = { createApp, start };
