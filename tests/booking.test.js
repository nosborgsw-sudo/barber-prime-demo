'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  startTestApp,
  novoCliente,
  cadastrarCliente,
  entrar,
  criarAgendamento,
  reagendar,
  cancelar,
  mudarStatus,
  listarAgendamentos,
  consultarDisponibilidade,
  dataFutura,
  encontrarSobreposicoes,
  textoDoCorpo,
} = require('./helpers');

const CORTE = 1; // 45 min
const CORTE_BARBA = 3; // 60 min
const SOBRANCELHA = 4; // 15 min

async function agendamentosDoAdmin(app, parametros) {
  const { cli } = await entrar(app.base, 'admin');
  const resposta = await listarAgendamentos(cli, { escopo: 'todos', ...parametros });
  assert.equal(resposta.status, 200, `GET agendamentos admin: ${textoDoCorpo(resposta)}`);
  return resposta.corpo.agendamentos;
}

function horariosDe(resposta, barbeiroId) {
  const opcao = (resposta.corpo.opcoes || []).find((item) => item.barbeiroId === barbeiroId);
  assert.ok(opcao, `barbeiro ${barbeiroId} ausente na disponibilidade`);
  return opcao.horarios || [];
}

describe('agendamentos: criacao, conflitos, reagendamento, cancelamento e papeis', () => {
  let app;

  beforeEach(async () => {
    app = await startTestApp();
  });

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it('cria agendamento (201) com todos os campos do contrato', async () => {
    const data = dataFutura(20);
    const { cli, usuario } = await cadastrarCliente(app.base);

    const resposta = await criarAgendamento(cli, {
      servicoId: CORTE,
      barbeiroId: 3,
      data,
      hora: '15:00',
    });

    assert.equal(resposta.status, 201, `criacao deveria ser 201, veio ${resposta.status}: ${textoDoCorpo(resposta)}`);
    const agendamento = resposta.corpo && resposta.corpo.agendamento;
    assert.ok(agendamento, 'resposta deve conter {agendamento}');
    assert.equal(agendamento.status, 'agendado');
    assert.equal(agendamento.data, data);
    assert.equal(agendamento.hora, '15:00');
    assert.equal(agendamento.inicio, `${data} 15:00`);
    assert.equal(agendamento.duracaoMin, 45);
    assert.equal(agendamento.servico.id, CORTE);
    assert.equal(agendamento.servico.duracaoMin, 45);
    assert.equal(agendamento.barbeiro.id, 3);
    assert.equal(agendamento.cliente.id, usuario.id);
    assert.equal(typeof agendamento.fim, 'string');
    assert.ok(agendamento.criadoEm, 'agendamento deve ter criadoEm');
    assert.ok(agendamento.atualizadoEm, 'agendamento deve ter atualizadoEm');
  });

  it('conflito no mesmo barbeiro/slot retorna 409 horario_indisponivel', async () => {
    const data = dataFutura(20);
    const clienteA = await cadastrarCliente(app.base);
    const clienteB = await cadastrarCliente(app.base);
    const corpo = { servicoId: CORTE, barbeiroId: 3, data, hora: '15:00' };

    const primeira = await criarAgendamento(clienteA.cli, corpo);
    assert.equal(primeira.status, 201, textoDoCorpo(primeira));

    const segunda = await criarAgendamento(clienteB.cli, corpo);
    assert.equal(segunda.status, 409, `segunda reserva deveria ser 409, veio ${segunda.status}: ${textoDoCorpo(segunda)}`);
    assert.equal(segunda.corpo && segunda.corpo.erro, 'horario_indisponivel');

    const agendamentos = await agendamentosDoAdmin(app, { data, barbeiroId: 3 });
    const ativosNoSlot = agendamentos.filter(
      (a) => a.status === 'agendado' && a.inicio === `${data} 15:00`,
    );
    assert.equal(ativosNoSlot.length, 1, 'deve existir exatamente 1 agendamento ativo no slot');
  });

  it('cliente diferente no mesmo slot retorna 409', async () => {
    const data = dataFutura(21);
    const clienteA = await cadastrarCliente(app.base, { nome: 'Ana', sobrenome: 'QA' });
    const clienteB = await cadastrarCliente(app.base, { nome: 'Bia', sobrenome: 'QA' });
    const corpo = { servicoId: SOBRANCELHA, barbeiroId: 2, data, hora: '10:00' };

    const primeira = await criarAgendamento(clienteA.cli, corpo);
    assert.equal(primeira.status, 201, textoDoCorpo(primeira));

    const segunda = await criarAgendamento(clienteB.cli, corpo);
    assert.equal(segunda.status, 409, `cliente diferente no mesmo slot deveria ser 409, veio ${segunda.status}`);
    assert.equal(segunda.corpo && segunda.corpo.erro, 'horario_indisponivel');
  });

  it('dois servicos que se sobrepoem no mesmo barbeiro retornam 409', async () => {
    const data = dataFutura(22);
    const clienteA = await cadastrarCliente(app.base);
    const clienteB = await cadastrarCliente(app.base);

    const corte = await criarAgendamento(clienteA.cli, {
      servicoId: CORTE,
      barbeiroId: 4,
      data,
      hora: '15:00', // 15:00-15:45
    });
    assert.equal(corte.status, 201, textoDoCorpo(corte));

    const combo = await criarAgendamento(clienteB.cli, {
      servicoId: CORTE_BARBA,
      barbeiroId: 4,
      data,
      hora: '15:30', // 15:30-16:30 sobrepoe 15:00-15:45
    });
    assert.equal(combo.status, 409, `servico sobreposto deveria ser 409, veio ${combo.status}: ${textoDoCorpo(combo)}`);
    assert.equal(combo.corpo && combo.corpo.erro, 'horario_indisponivel');

    const agendamentos = await agendamentosDoAdmin(app, { data, barbeiroId: 4 });
    assert.equal(encontrarSobreposicoes(agendamentos).length, 0, 'nao pode haver sobreposicao ativa');
  });

  it('reagendar libera o horario antigo e ocupa o novo (verificado via API)', async () => {
    const data = dataFutura(23);
    const cliente = await cadastrarCliente(app.base);
    const publico = novoCliente(app.base);
    const filtro = { servicoId: CORTE, data, barbeiroId: 3 };

    const criado = await criarAgendamento(cliente.cli, {
      servicoId: CORTE,
      barbeiroId: 3,
      data,
      hora: '15:00',
    });
    assert.equal(criado.status, 201, textoDoCorpo(criado));
    const id = criado.corpo.agendamento.id;

    const resposta = await reagendar(cliente.cli, id, { data, hora: '16:00', barbeiroId: 3 });
    assert.equal(resposta.status, 200, `reagendar deveria ser 200, veio ${resposta.status}: ${textoDoCorpo(resposta)}`);
    assert.equal(resposta.corpo.agendamento.hora, '16:00');
    assert.equal(resposta.corpo.agendamento.inicio, `${data} 16:00`);
    assert.equal(resposta.corpo.agendamento.id, id, 'reagendar deve manter o mesmo id');

    const disponibilidade = await consultarDisponibilidade(publico, filtro);
    assert.equal(disponibilidade.status, 200, textoDoCorpo(disponibilidade));
    const horarios = horariosDe(disponibilidade, 3);
    assert.ok(horarios.includes('15:00'), 'horario antigo (15:00) deveria ser liberado');
    assert.equal(horarios.includes('16:00'), false, 'horario novo (16:00) deveria estar ocupado');
  });

  it('reagendar para slot ocupado retorna 409 e mantem o horario antigo', async () => {
    const data = dataFutura(24);
    const cliente = await cadastrarCliente(app.base);

    const primeiro = await criarAgendamento(cliente.cli, {
      servicoId: CORTE,
      barbeiroId: 3,
      data,
      hora: '15:00',
    });
    assert.equal(primeiro.status, 201, textoDoCorpo(primeiro));
    const idPrimeiro = primeiro.corpo.agendamento.id;

    const segundo = await criarAgendamento(cliente.cli, {
      servicoId: CORTE,
      barbeiroId: 3,
      data,
      hora: '16:00',
    });
    assert.equal(segundo.status, 201, textoDoCorpo(segundo));

    const reagendado = await reagendar(cliente.cli, idPrimeiro, { data, hora: '16:00' });
    assert.equal(reagendado.status, 409, `reagendar para slot ocupado deveria ser 409, veio ${reagendado.status}`);
    assert.equal(reagendado.corpo && reagendado.corpo.erro, 'horario_indisponivel');

    const agendamentos = await agendamentosDoAdmin(app, { data, barbeiroId: 3 });
    const primeiroDepois = agendamentos.find((a) => a.id === idPrimeiro);
    assert.ok(primeiroDepois, 'agendamento original deve continuar existindo');
    assert.equal(primeiroDepois.status, 'agendado');
    assert.equal(primeiroDepois.hora, '15:00', 'horario antigo deve permanecer apos 409');
  });

  it('cancelar libera o slot e nao permite cancelar duas vezes', async () => {
    const data = dataFutura(25);
    const cliente = await cadastrarCliente(app.base);
    const publico = novoCliente(app.base);
    const filtro = { servicoId: SOBRANCELHA, data, barbeiroId: 3 };

    const criado = await criarAgendamento(cliente.cli, {
      servicoId: SOBRANCELHA,
      barbeiroId: 3,
      data,
      hora: '15:00',
    });
    assert.equal(criado.status, 201, textoDoCorpo(criado));
    const id = criado.corpo.agendamento.id;

    const primeiroCancelamento = await cancelar(cliente.cli, id);
    assert.equal(primeiroCancelamento.status, 200, `cancelar deveria ser 200, veio ${primeiroCancelamento.status}`);
    assert.equal(primeiroCancelamento.corpo.agendamento.status, 'cancelado');

    const disponibilidade = await consultarDisponibilidade(publico, filtro);
    assert.equal(disponibilidade.status, 200, textoDoCorpo(disponibilidade));
    assert.ok(horariosDe(disponibilidade, 3).includes('15:00'), 'slot deve voltar apos cancelar');

    const segundoCancelamento = await cancelar(cliente.cli, id);
    assert.equal(segundoCancelamento.status, 409, `segundo cancelamento deveria ser 409, veio ${segundoCancelamento.status}`);
    assert.equal(segundoCancelamento.corpo && segundoCancelamento.corpo.erro, 'estado_invalido');
  });

  it('agendamento concluido nao pode ser cancelado', async () => {
    const data = dataFutura(26);
    const cliente = await cadastrarCliente(app.base);

    const criado = await criarAgendamento(cliente.cli, {
      servicoId: CORTE,
      barbeiroId: 2,
      data,
      hora: '10:00',
    });
    assert.equal(criado.status, 201, textoDoCorpo(criado));
    const id = criado.corpo.agendamento.id;

    const { cli: barbeiro2 } = await entrar(app.base, 'barbeiro2');
    const concluido = await mudarStatus(barbeiro2, id, 'concluido');
    assert.equal(concluido.status, 200, `barbeiro dono deveria concluir, veio ${concluido.status}: ${textoDoCorpo(concluido)}`);
    assert.equal(concluido.corpo.agendamento.status, 'concluido');

    const cancelamento = await cancelar(cliente.cli, id);
    assert.equal(
      cancelamento.status,
      409,
      `concluido nao pode ser cancelado (esperado 409), veio ${cancelamento.status}: ${textoDoCorpo(cancelamento)}`,
    );
    assert.equal(cancelamento.corpo && cancelamento.corpo.erro, 'estado_invalido');
  });

  it('barbeiro marca concluido/faltou apenas no proprio agendamento', async () => {
    const data = dataFutura(27);
    const cliente = await cadastrarCliente(app.base);

    const doBarbeiro2A = await criarAgendamento(cliente.cli, {
      servicoId: CORTE,
      barbeiroId: 2,
      data,
      hora: '10:00',
    });
    const doBarbeiro2B = await criarAgendamento(cliente.cli, {
      servicoId: CORTE,
      barbeiroId: 2,
      data,
      hora: '11:00',
    });
    const doBarbeiro3 = await criarAgendamento(cliente.cli, {
      servicoId: CORTE,
      barbeiroId: 3,
      data,
      hora: '10:00',
    });
    for (const [rotulo, resposta] of [
      ['barbeiro2 10:00', doBarbeiro2A],
      ['barbeiro2 11:00', doBarbeiro2B],
      ['barbeiro3 10:00', doBarbeiro3],
    ]) {
      assert.equal(resposta.status, 201, `${rotulo} deveria ser 201: ${textoDoCorpo(resposta)}`);
    }

    const { cli: barbeiro2 } = await entrar(app.base, 'barbeiro2');

    const concluido = await mudarStatus(barbeiro2, doBarbeiro2A.corpo.agendamento.id, 'concluido');
    assert.equal(concluido.status, 200, `proprio agendamento (concluido) deveria ser 200, veio ${concluido.status}`);
    assert.equal(concluido.corpo.agendamento.status, 'concluido');

    const faltou = await mudarStatus(barbeiro2, doBarbeiro2B.corpo.agendamento.id, 'faltou');
    assert.equal(faltou.status, 200, `proprio agendamento (faltou) deveria ser 200, veio ${faltou.status}`);
    assert.equal(faltou.corpo.agendamento.status, 'faltou');

    const alheio = await mudarStatus(barbeiro2, doBarbeiro3.corpo.agendamento.id, 'concluido');
    assert.equal(
      alheio.status,
      403,
      `barbeiro nao pode alterar agendamento alheio (esperado 403), veio ${alheio.status}: ${textoDoCorpo(alheio)}`,
    );
    assert.equal(alheio.corpo && alheio.corpo.erro, 'sem_permissao');
  });

  it('admin cria agendamento para cliente; clienteId e obrigatorio para admin', async () => {
    const data = dataFutura(28);
    const cliente = await cadastrarCliente(app.base);
    const { cli: admin } = await entrar(app.base, 'admin');

    const criado = await criarAgendamento(admin, {
      servicoId: CORTE,
      barbeiroId: 3,
      data,
      hora: '15:00',
      clienteId: cliente.usuario.id,
    });
    assert.equal(criado.status, 201, `admin deveria criar para cliente, veio ${criado.status}: ${textoDoCorpo(criado)}`);
    assert.equal(criado.corpo.agendamento.cliente.id, cliente.usuario.id);

    const semCliente = await criarAgendamento(admin, {
      servicoId: CORTE,
      barbeiroId: 3,
      data,
      hora: '16:00',
    });
    assert.equal(
      semCliente.status,
      422,
      `admin sem clienteId deveria ser 422, veio ${semCliente.status}: ${textoDoCorpo(semCliente)}`,
    );
    assert.equal(semCliente.corpo && semCliente.corpo.erro, 'validacao');
  });

  it('cliente nao ve agendamento de outro (filtro alheio 403 e lista apenas propria)', async () => {
    const data = dataFutura(29);
    const clienteA = await cadastrarCliente(app.base, { nome: 'Alice', sobrenome: 'QA' });
    const clienteB = await cadastrarCliente(app.base, { nome: 'Bruno', sobrenome: 'QA' });

    const reservaA = await criarAgendamento(clienteA.cli, {
      servicoId: CORTE,
      barbeiroId: 3,
      data,
      hora: '15:00',
    });
    assert.equal(reservaA.status, 201, textoDoCorpo(reservaA));

    const filtroAlheio = await listarAgendamentos(clienteB.cli, {
      clienteId: clienteA.usuario.id,
    });
    assert.equal(
      filtroAlheio.status,
      403,
      `cliente filtrando agendamentos de outro deveria ser 403, veio ${filtroAlheio.status}`,
    );
    assert.equal(filtroAlheio.corpo && filtroAlheio.corpo.erro, 'sem_permissao');

    const listaB = await listarAgendamentos(clienteB.cli, { escopo: 'todos' });
    assert.equal(listaB.status, 200, textoDoCorpo(listaB));
    const ids = (listaB.corpo.agendamentos || []).map((a) => a.id);
    assert.equal(
      ids.includes(reservaA.corpo.agendamento.id),
      false,
      'cliente B nao pode ver o agendamento do cliente A',
    );

    const cancelarAlheio = await cancelar(clienteB.cli, reservaA.corpo.agendamento.id);
    assert.equal(
      cancelarAlheio.status,
      403,
      `cliente nao pode cancelar agendamento alheio (esperado 403), veio ${cancelarAlheio.status}`,
    );
  });
});
