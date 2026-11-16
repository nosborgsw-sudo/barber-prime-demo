'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  startTestApp,
  cadastrarCliente,
  entrar,
  criarAgendamento,
  reagendar,
  cancelar,
  listarAgendamentos,
  dataFutura,
  encontrarSobreposicoes,
  resumoStatus,
  contarAtivosNoSlotBanco,
  agendamentosDoBanco,
  textoDoCorpo,
} = require('./helpers');

const CORTE = 1; // 45 min

async function listarTudo(app, parametros = {}) {
  const { cli } = await entrar(app.base, 'admin');
  const resposta = await listarAgendamentos(cli, { escopo: 'todos', ...parametros });
  assert.equal(resposta.status, 200, `GET admin agendamentos: ${textoDoCorpo(resposta)}`);
  return resposta.corpo.agendamentos || [];
}

describe('concorrencia: invariantes de escrita simultanea', () => {
  let app;

  beforeEach(async () => {
    app = await startTestApp();
  });

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it('concorrência: 100 reservas simultâneas resultam em exatamente 1 confirmada', async () => {
    const { cli } = await cadastrarCliente(app.base, { nome: 'Cem', sobrenome: 'Reservas' });
    const data = dataFutura(30);
    const barbeiroId = 4;
    const hora = '15:00';
    const corpo = { servicoId: CORTE, barbeiroId, data, hora };

    const respostas = await Promise.all(
      Array.from({ length: 100 }, () => cli.post('/api/agendamentos', corpo)),
    );
    const statuses = respostas.map((resposta) => resposta.status);
    const confirmadas = statuses.filter((status) => status === 201).length;
    const conflitos = statuses.filter((status) => status === 409).length;

    assert.equal(
      confirmadas,
      1,
      `esperava exatamente 1x201, obtive ${confirmadas}. Distribuicao: ${resumoStatus(statuses)}`,
    );
    assert.equal(
      conflitos,
      99,
      `esperava exatamente 99x409, obtive ${conflitos}. Distribuicao: ${resumoStatus(statuses)}${
        statuses.includes(429)
          ? ' (429 = rate limit de mutacao por IP bloqueando o cenario exigido pelo contrato)'
          : ''
      }`,
    );
    assert.equal(
      statuses.filter((status) => status !== 201 && status !== 409).length,
      0,
      `todas as respostas deveriam ser 201 ou 409: ${resumoStatus(statuses)}`,
    );

    const agendamentos = await listarTudo(app, { data, barbeiroId });
    const ativosNoSlot = agendamentos.filter(
      (a) => a.status === 'agendado' && a.inicio === `${data} ${hora}`,
    );
    assert.equal(
      ativosNoSlot.length,
      1,
      `API deveria mostrar 1 agendamento ativo no slot, mostrou ${ativosNoSlot.length}`,
    );

    const noBanco = contarAtivosNoSlotBanco(app.dbPath, barbeiroId, `${data} ${hora}`);
    assert.equal(noBanco, 1, `banco deveria ter 1 agendamento ativo no slot, tem ${noBanco}`);
    assert.ok(agendamentosDoBanco(app.dbPath).length >= 1, 'banco deveria conter o agendamento gravado');

    assert.deepEqual(
      encontrarSobreposicoes(agendamentos),
      [],
      'nao pode existir sobreposicao de agendamentos ativos',
    );
  });

  it('cancelamento concorrente com nova reserva no mesmo slot nao deixa sobreposicao', async () => {
    const data = dataFutura(31);
    const barbeiroId = 4;
    const hora = '15:00';

    const dono = await cadastrarCliente(app.base, { nome: 'Dono', sobrenome: 'Slot' });
    const concorrente = await cadastrarCliente(app.base, { nome: 'Concorrente', sobrenome: 'Slot' });

    const reserva = await criarAgendamento(dono.cli, {
      servicoId: CORTE,
      barbeiroId,
      data,
      hora,
    });
    assert.equal(reserva.status, 201, textoDoCorpo(reserva));
    const id = reserva.corpo.agendamento.id;

    const [cancelamento, novaReserva] = await Promise.all([
      cancelar(dono.cli, id),
      criarAgendamento(concorrente.cli, { servicoId: CORTE, barbeiroId, data, hora }),
    ]);

    assert.equal(
      cancelamento.status,
      200,
      `cancelamento deveria concluir (200), veio ${cancelamento.status}: ${textoDoCorpo(cancelamento)}`,
    );
    assert.ok(
      novaReserva.status === 201 || novaReserva.status === 409,
      `nova reserva concorrente deveria ser 201 ou 409, veio ${novaReserva.status}: ${textoDoCorpo(novaReserva)}`,
    );

    const agendamentos = await listarTudo(app, { data, barbeiroId });
    const ativosNoSlot = agendamentos.filter(
      (a) => a.status === 'agendado' && a.inicio === `${data} ${hora}`,
    );

    if (novaReserva.status === 201) {
      assert.equal(ativosNoSlot.length, 1, 'nova reserva confirmada deve ser o unico ativo no slot');
      assert.equal(ativosNoSlot[0].id, novaReserva.corpo.agendamento.id, 'ativo deve ser a nova reserva');
    } else {
      assert.equal(ativosNoSlot.length, 0, 'sem nova reserva confirmada, o slot deve ficar vazio');
    }

    assert.deepEqual(
      encontrarSobreposicoes(agendamentos),
      [],
      'cancelamento concorrente nao pode deixar sobreposicao',
    );
    const noBanco = contarAtivosNoSlotBanco(app.dbPath, barbeiroId, `${data} ${hora}`);
    assert.equal(
      noBanco,
      novaReserva.status === 201 ? 1 : 0,
      'contagem ativa no banco deve refletir a corrida',
    );
  });

  it('reagendamento simultaneo de dois agendamentos para o mesmo horario: apenas um vence', async () => {
    const data = dataFutura(32);
    const barbeiroId = 4;
    const cliente = await cadastrarCliente(app.base, { nome: 'Reagenda', sobrenome: 'Simultaneo' });

    const primeiro = await criarAgendamento(cliente.cli, {
      servicoId: CORTE,
      barbeiroId,
      data,
      hora: '15:00',
    });
    const segundo = await criarAgendamento(cliente.cli, {
      servicoId: CORTE,
      barbeiroId,
      data,
      hora: '16:30',
    });
    assert.equal(primeiro.status, 201, textoDoCorpo(primeiro));
    assert.equal(segundo.status, 201, textoDoCorpo(segundo));

    const id1 = primeiro.corpo.agendamento.id;
    const id2 = segundo.corpo.agendamento.id;

    const [res1, res2] = await Promise.all([
      reagendar(cliente.cli, id1, { data, hora: '17:00', barbeiroId }),
      reagendar(cliente.cli, id2, { data, hora: '17:00', barbeiroId }),
    ]);

    const statuses = [res1.status, res2.status];
    const vitorias = statuses.filter((status) => status === 200).length;
    const derrotas = statuses.filter((status) => status === 409).length;

    assert.equal(
      vitorias,
      1,
      `exatamente 1 reagendamento deveria vencer (200). Status: ${statuses.join(',')}`,
    );
    assert.equal(
      derrotas,
      1,
      `exatamente 1 reagendamento deveria falhar (409). Status: ${statuses.join(',')}`,
    );

    const vencedor = res1.status === 200 ? res1 : res2;
    const perdedor = res1.status === 409 ? res1 : res2;
    const vencedorId = vencedor === res1 ? id1 : id2;
    const perdedorId = perdedor === res1 ? id1 : id2;
    assert.equal(vencedor.corpo.agendamento.hora, '17:00');

    const agendamentos = await listarTudo(app, { data, barbeiroId });
    const vencedorNoBanco = agendamentos.find((a) => a.id === vencedorId);
    const perdedorNoBanco = agendamentos.find((a) => a.id === perdedorId);
    assert.ok(vencedorNoBanco && perdedorNoBanco, 'ambos os agendamentos devem existir');

    const horarioOriginalPerdedor = perdedor === res1 ? '15:00' : '16:30';
    assert.equal(
      perdedorNoBanco.hora,
      horarioOriginalPerdedor,
      'o reagendamento que falhou deve manter o horario original',
    );
    assert.equal(vencedorNoBanco.hora, '17:00', 'o vencedor deve ter ocupado o novo horario');

    const ativosNoAlvo = agendamentos.filter(
      (a) => a.status === 'agendado' && a.inicio === `${data} 17:00`,
    );
    assert.equal(ativosNoAlvo.length, 1, 'deve haver exatamente 1 ativo no horario alvo');
    assert.equal(
      contarAtivosNoSlotBanco(app.dbPath, barbeiroId, `${data} 17:00`),
      1,
      'banco deve ter exatamente 1 ativo no horario alvo',
    );

    assert.deepEqual(
      encontrarSobreposicoes(agendamentos),
      [],
      'reagendamentos simultaneos nao podem deixar sobreposicao',
    );
  });
});
