'use strict';

const {
  agoraLocal,
  diaSemanaDeData,
  somarDias,
  minParaHora,
  horaParaMin,
  TZ,
} = require('./util');
const { hashSegredo } = require('./auth');
const { zerarSequencias } = require('./db');

const CONFIG_INICIAL = {
  nomeBarbearia: 'Barber Prime',
  endereco: 'Rua das Tesouras, 123 - São Paulo/SP',
  telefoneContato: '(11) 4000-1234',
  horarioFuncionamento: 'Seg a Sáb, 09:00 às 19:00',
  antecedenciaMinMin: '30',
  antecedenciaMaxDias: '365',
  fuso: TZ,
};

const BARBEIROS = [
  {
    nome: 'Rafael',
    sobrenome: 'Costa',
    login: 'barbeiro1',
    apelido: '@rafael',
    especialidades: ['Corte', 'Barba'],
    bio: 'Especialista em cortes clássicos e barba desenhada.',
  },
  {
    nome: 'Diego',
    sobrenome: 'Martins',
    login: 'barbeiro2',
    apelido: '@diego',
    especialidades: ['Corte', 'Infantil'],
    bio: 'Atendimento leve e preciso para todos os estilos.',
  },
  {
    nome: 'Lucas',
    sobrenome: 'Almeida',
    login: 'barbeiro3',
    apelido: '@lucas',
    especialidades: ['Barba', 'Sobrancelha'],
    bio: 'Cuidado detalhista com barba e acabamento.',
  },
  {
    nome: 'Bruno',
    sobrenome: 'Silva',
    login: 'barbeiro4',
    apelido: '@bruno',
    especialidades: ['Corte', 'Pigmentação'],
    bio: 'Cortes modernos e pigmentação com resultado natural.',
  },
];

const CLIENTES = [
  { nome: 'Ana', sobrenome: 'Souza', telefone: '11987650001' },
  { nome: 'Carlos', sobrenome: 'Lima', telefone: '11987650002' },
  { nome: 'Marina', sobrenome: 'Alves', telefone: '11987650003' },
  { nome: 'Pedro', sobrenome: 'Santos', telefone: '11987650004' },
];

const SERVICOS = [
  { nome: 'Corte', descricao: 'Corte de cabelo na tesoura e máquina.', precoCentavos: 5000, duracaoMin: 45 },
  { nome: 'Barba', descricao: 'Barba aparada e desenhada com toalha quente.', precoCentavos: 3500, duracaoMin: 30 },
  { nome: 'Corte + Barba', descricao: 'Combo completo de corte e barba.', precoCentavos: 8000, duracaoMin: 60 },
  { nome: 'Sobrancelha', descricao: 'Design de sobrancelha no acabamento.', precoCentavos: 2000, duracaoMin: 15 },
  { nome: 'Pigmentação', descricao: 'Pigmentação capilar para disfarce de falhas.', precoCentavos: 4500, duracaoMin: 30 },
];

function bancoVazio(db) {
  const linha = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM usuarios) +
         (SELECT COUNT(*) FROM barbeiros) +
         (SELECT COUNT(*) FROM servicos) AS total`
    )
    .get();
  return Number(linha.total) === 0;
}

/** Insere as jornadas padrão (seg–sáb 09:00–18:00, intervalo 12:00–13:00). */
function criarJornadasPadrao(db, barbeiroId, agoraTexto) {
  const inserir = db.prepare(
    `INSERT INTO jornadas
       (barbeiro_id, dia_semana, ativo, inicio, fim, intervalo_inicio, intervalo_fim)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (let dia = 0; dia <= 6; dia += 1) {
    if (dia === 0) {
      inserir.run(barbeiroId, dia, 0, '09:00', '18:00', null, null);
    } else {
      inserir.run(barbeiroId, dia, 1, '09:00', '18:00', '12:00', '13:00');
    }
  }
  return agoraTexto;
}

/** Primeiro dia útil (seg–sáb, sem feriado) estritamente após `dataBase`. */
function proximoDiaUtil(db, dataBase) {
  let data = somarDias(dataBase, 1);
  for (let i = 0; i < 370; i += 1) {
    const dia = diaSemanaDeData(data);
    const feriado = db.prepare('SELECT 1 FROM feriados WHERE data = ?').get(data);
    if (dia !== 0 && !feriado) return data;
    data = somarDias(data, 1);
  }
  return data;
}

/**
 * Semeia todos os dados determinísticos. O chamador deve abrir a transação.
 * Retorna ids fixos para o reset preservar a sessão do admin.
 */
function semear(db) {
  const agora = agoraLocal();
  const texto = agora.texto;
  const senhaAdmin = process.env.ADMIN_SENHA || 'admin123';
  const senhaBarbeiro = process.env.BARBEIRO_SENHA || 'barbeiro123';

  const inserirUsuario = db.prepare(
    `INSERT INTO usuarios
       (papel, nome, sobrenome, telefone, login, senha_hash, pin_hash, ativo, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  );

  const adminId = Number(
    inserirUsuario.run(
      'admin',
      'Administrador',
      'Barber Prime',
      null,
      'admin',
      hashSegredo(senhaAdmin),
      null,
      texto,
      texto
    ).lastInsertRowid
  );

  const inserirBarbeiro = db.prepare(
    `INSERT INTO barbeiros
       (usuario_id, apelido, especialidades, bio, foto_url, ativo, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
  );

  const barbeiroIds = [];
  for (const b of BARBEIROS) {
    const usuarioId = Number(
      inserirUsuario.run(
        'barbeiro',
        b.nome,
        b.sobrenome,
        null,
        b.login,
        hashSegredo(senhaBarbeiro),
        null,
        texto,
        texto
      ).lastInsertRowid
    );
    const barbeiroId = Number(
      inserirBarbeiro.run(
        usuarioId,
        b.apelido,
        JSON.stringify(b.especialidades),
        b.bio,
        null,
        texto,
        texto
      ).lastInsertRowid
    );
    barbeiroIds.push(barbeiroId);
    criarJornadasPadrao(db, barbeiroId, texto);
  }

  const clienteIds = [];
  for (const c of CLIENTES) {
    const id = Number(
      inserirUsuario.run(
        'cliente',
        c.nome,
        c.sobrenome,
        c.telefone,
        null,
        null,
        hashSegredo('1234'),
        texto,
        texto
      ).lastInsertRowid
    );
    clienteIds.push(id);
  }

  const inserirServico = db.prepare(
    `INSERT INTO servicos
       (nome, descricao, preco_centavos, duracao_min, ativo, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, 1, ?, ?)`
  );
  const servicoIds = [];
  for (const s of SERVICOS) {
    servicoIds.push(
      Number(
        inserirServico.run(
          s.nome,
          s.descricao,
          s.precoCentavos,
          s.duracaoMin,
          texto,
          texto
        ).lastInsertRowid
      )
    );
  }

  const inserirConfig = db.prepare(
    'INSERT INTO configuracoes (chave, valor, atualizado_em) VALUES (?, ?, ?)'
  );
  for (const [chave, valor] of Object.entries(CONFIG_INICIAL)) {
    inserirConfig.run(chave, valor, texto);
  }

  // Dois agendamentos no próximo dia útil, barbeiro 1, às 10:00 e 11:00.
  const dataSeed = proximoDiaUtil(db, agora.data);
  const inserirAgendamento = db.prepare(
    `INSERT INTO agendamentos
       (cliente_id, barbeiro_id, servico_id, data, hora, duracao_min, preco_centavos,
        inicio, fim, status, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'agendado', ?, ?)`
  );
  const inserirHistorico = db.prepare(
    `INSERT INTO historico_agendamentos
       (agendamento_id, acao, de_status, para_status, usuario_id, em, detalhe)
     VALUES (?, 'criado', NULL, 'agendado', ?, ?, 'seed')`
  );

  const seedAgendamentos = [
    { clienteId: clienteIds[0], servicoId: servicoIds[0], hora: '10:00' },
    { clienteId: clienteIds[1], servicoId: servicoIds[2], hora: '11:00' },
  ];
  for (const a of seedAgendamentos) {
    const servico = SERVICOS[servicoIds.indexOf(a.servicoId)] || SERVICOS[0];
    const duracao = servico.duracaoMin;
    const inicio = `${dataSeed} ${a.hora}`;
    const fim = `${dataSeed} ${minParaHora(horaParaMin(a.hora) + duracao)}`;
    const id = Number(
      inserirAgendamento.run(
        a.clienteId,
        barbeiroIds[0],
        a.servicoId,
        dataSeed,
        a.hora,
        duracao,
        servico.precoCentavos,
        inicio,
        fim,
        texto,
        texto
      ).lastInsertRowid
    );
    inserirHistorico.run(id, adminId, texto);
  }

  return {
    adminId,
    barbeiroIds,
    clienteIds,
    servicoIds,
    dataSeed,
  };
}

/** Remove todos os dados operacionais e zera sequências. */
function limparDados(db) {
  db.exec(`
    DELETE FROM historico_agendamentos;
    DELETE FROM agendamentos;
    DELETE FROM bloqueios;
    DELETE FROM jornadas;
    DELETE FROM sessoes;
    DELETE FROM barbeiros;
    DELETE FROM servicos;
    DELETE FROM usuarios;
    DELETE FROM feriados;
    DELETE FROM configuracoes;
    DELETE FROM auditoria;
  `);
  zerarSequencias(db);
}

module.exports = {
  CONFIG_INICIAL,
  BARBEIROS,
  CLIENTES,
  SERVICOS,
  bancoVazio,
  criarJornadasPadrao,
  proximoDiaUtil,
  semear,
  limparDados,
};
