'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  startTestApp,
  novoCliente,
  cadastrarCliente,
  criarAgendamento,
  cancelar,
  consultarDisponibilidade,
  entrar,
  dataSaoPaulo,
  dataFutura,
  proximoDomingo,
  somarDias,
  horaParaMinutos,
  limiteAntecedenciaMinima,
  textoDoCorpo,
} = require('./helpers');

// Servicos do seed (docs/CONTRATO-API.md)
const SOBRANCELHA = 4; // 15 min
const CORTE_BARBA = 3; // 60 min
const CORTE = 1; // 45 min

const JORNADA_INICIO = '09:00';
const JORNADA_FIM = '18:00';
const INTERVALO_INICIO = '12:00';
const INTERVALO_FIM = '13:00';

function opcoesDe(resposta) {
  assert.ok(resposta.corpo && Array.isArray(resposta.corpo.opcoes), 'resposta deve conter {opcoes: []}');
  return resposta.corpo.opcoes;
}

function todosOsHorarios(resposta) {
  return opcoesDe(resposta).flatMap((opcao) => opcao.horarios || []);
}

function horariosDoBarbeiro(resposta, barbeiroId) {
  const opcao = opcoesDe(resposta).find((item) => item.barbeiroId === barbeiroId);
  assert.ok(opcao, `resposta deveria conter o barbeiro ${barbeiroId}`);
  return opcao.horarios || [];
}

function assertSlotsRespeitamIntervalo(horarios, duracaoMin) {
  for (const hora of horarios) {
    const inicio = horaParaMinutos(hora);
    const fim = inicio + duracaoMin;
    const sobrepoeIntervalo = inicio < horaParaMinutos(INTERVALO_FIM)
      && fim > horaParaMinutos(INTERVALO_INICIO);
    assert.equal(
      sobrepoeIntervalo,
      false,
      `slot ${hora} (${duracaoMin} min) invade o intervalo ${INTERVALO_INICIO}-${INTERVALO_FIM}`,
    );
  }
}

function assertSlotsDentroDaJornada(horarios, duracaoMin) {
  for (const hora of horarios) {
    const inicio = horaParaMinutos(hora);
    assert.ok(inicio >= horaParaMinutos(JORNADA_INICIO), `slot ${hora} antes da jornada`);
    assert.ok(
      inicio + duracaoMin <= horaParaMinutos(JORNADA_FIM),
      `slot ${hora} (${duracaoMin} min) termina depois do fim da jornada`,
    );
  }
}

describe('disponibilidade: regras do motor de agenda', () => {
  let app;
  let publico;

  beforeEach(async () => {
    app = await startTestApp();
    publico = novoCliente(app.base, 'publico');
  });

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it('domingo nao tem horarios (200 sem opcoes/horarios ou 422)', async () => {
    const domingo = proximoDomingo();
    const resposta = await consultarDisponibilidade(publico, {
      servicoId: CORTE,
      data: domingo,
    });

    assert.ok(
      resposta.status === 200 || resposta.status === 422,
      `domingo deveria ser 200 vazio ou 422, veio ${resposta.status}: ${textoDoCorpo(resposta)}`,
    );

    if (resposta.status === 200) {
      const horarios = todosOsHorarios(resposta);
      assert.equal(horarios.length, 0, `domingo ${domingo} nao pode ter horarios: ${horarios.join(', ')}`);
    } else {
      assert.equal(resposta.corpo && resposta.corpo.erro, 'validacao');
    }
  });

  it('intervalo 12:00-13:00 nao oferece nenhuma vaga (15 min e 60 min)', async () => {
    const data = dataFutura(12);

    for (const [servicoId, duracaoMin] of [[SOBRANCELHA, 15], [CORTE_BARBA, 60]]) {
      const resposta = await consultarDisponibilidade(publico, {
        servicoId,
        data,
        barbeiroId: 4,
      });
      assert.equal(resposta.status, 200, textoDoCorpo(resposta));
      assert.equal(resposta.corpo.duracaoMin, duracaoMin, `duracaoMin do servico ${servicoId}`);

      const horarios = horariosDoBarbeiro(resposta, 4);
      assert.ok(horarios.length > 0, `deveria haver vagas fora do intervalo em ${data}`);
      assertSlotsRespeitamIntervalo(horarios, duracaoMin);
      assert.equal(horarios.includes('12:00'), false, '12:00 nao pode ser oferecido');
      assert.equal(horarios.includes('12:45'), false, '12:45 nao pode ser oferecido');
      assert.equal(horarios.includes('13:00'), true, '13:00 deveria ser oferecido');
    }
  });

  it('nenhum horario fora da jornada (09:00-18:00) e oferecido', async () => {
    const data = dataFutura(13);

    for (const [servicoId, duracaoMin] of [[CORTE, 45], [CORTE_BARBA, 60], [SOBRANCELHA, 15]]) {
      const resposta = await consultarDisponibilidade(publico, {
        servicoId,
        data,
        barbeiroId: 4,
      });
      assert.equal(resposta.status, 200, textoDoCorpo(resposta));
      const horarios = horariosDoBarbeiro(resposta, 4);
      assert.ok(horarios.length > 0, `deveria haver vagas em ${data}`);
      assertSlotsDentroDaJornada(horarios, duracaoMin);
      assert.equal(horarios.includes('08:45'), false, '08:45 esta fora da jornada');
      assert.equal(horarios.includes('18:00'), false, '18:00 esta fora da jornada');
      assert.equal(horarios.includes('19:00'), false, '19:00 esta fora da jornada');
    }
  });

  it('duracao do servico e respeitada: Sobrancelha 15 min vs Corte+Barba 60 min', async () => {
    const data = dataFutura(14);

    const sobrancelha = await consultarDisponibilidade(publico, {
      servicoId: SOBRANCELHA,
      data,
      barbeiroId: 4,
    });
    const combo = await consultarDisponibilidade(publico, {
      servicoId: CORTE_BARBA,
      data,
      barbeiroId: 4,
    });

    assert.equal(sobrancelha.status, 200, textoDoCorpo(sobrancelha));
    assert.equal(combo.status, 200, textoDoCorpo(combo));
    assert.equal(sobrancelha.corpo.duracaoMin, 15);
    assert.equal(combo.corpo.duracaoMin, 60);

    const horarios15 = horariosDoBarbeiro(sobrancelha, 4);
    const horarios60 = horariosDoBarbeiro(combo, 4);

    // O servico de 15 min cabe ate 17:45; o de 60 min so ate 17:00.
    assert.ok(horarios15.includes('17:45'), 'Sobrancelha deveria oferecer 17:45');
    assert.equal(horarios15.includes('18:00'), false, 'Sobrancelha nao cabe as 18:00');
    assert.ok(horarios60.includes('17:00'), 'Corte+Barba deveria oferecer 17:00');
    assert.equal(horarios60.includes('17:15'), false, 'Corte+Barba nao cabe as 17:15');
    assert.equal(horarios60.includes('17:45'), false, 'Corte+Barba nao cabe as 17:45');

    assertSlotsDentroDaJornada(horarios60, 60);
    assertSlotsDentroDaJornada(horarios15, 15);
  });

  it('antecedencia: data passada ou acima de 365 dias retorna 422; hoje respeita agora+30min', async () => {
    const hoje = dataSaoPaulo();

    const passado = await consultarDisponibilidade(publico, {
      servicoId: CORTE,
      data: somarDias(hoje, -1),
    });
    assert.equal(passado.status, 422, `data passada deveria ser 422, veio ${passado.status}`);
    assert.equal(passado.corpo && passado.corpo.erro, 'validacao');

    const distante = await consultarDisponibilidade(publico, {
      servicoId: CORTE,
      data: somarDias(hoje, 366),
    });
    assert.equal(distante.status, 422, `data > 365 dias deveria ser 422, veio ${distante.status}`);

    const invalida = await consultarDisponibilidade(publico, {
      servicoId: CORTE,
      data: '2026-99-99',
    });
    assert.equal(invalida.status, 422, `data invalida deveria ser 422, veio ${invalida.status}`);

    const hojeResposta = await consultarDisponibilidade(publico, {
      servicoId: SOBRANCELHA,
      data: hoje,
    });
    assert.ok(
      hojeResposta.status === 200 || hojeResposta.status === 422,
      `hoje deveria ser 200 ou 422, veio ${hojeResposta.status}`,
    );
    if (hojeResposta.status === 200) {
      const limite = limiteAntecedenciaMinima();
      for (const hora of todosOsHorarios(hojeResposta)) {
        assert.ok(
          hora >= limite,
          `hoje: slot ${hora} viola antecedencia minima (agora+30min = ${limite})`,
        );
      }
    }
  });

  it('servico inexistente retorna 404', async () => {
    const resposta = await consultarDisponibilidade(publico, {
      servicoId: 999,
      data: dataFutura(12),
    });
    assert.equal(resposta.status, 404, `servico inexistente deveria ser 404, veio ${resposta.status}`);
    assert.equal(resposta.corpo && resposta.corpo.erro, 'nao_encontrado');
  });

  it('agendamento existente remove o slot; cancelamento devolve o slot', async () => {
    const data = dataFutura(16);
    const barbeiroId = 3;
    const hora = '15:00';

    const filtro = { servicoId: SOBRANCELHA, data, barbeiroId };

    const antes = await consultarDisponibilidade(publico, filtro);
    assert.equal(antes.status, 200, textoDoCorpo(antes));
    assert.ok(horariosDoBarbeiro(antes, barbeiroId).includes(hora), 'slot deveria estar livre antes da reserva');

    const { cli } = await cadastrarCliente(app.base);
    const reserva = await criarAgendamento(cli, {
      servicoId: SOBRANCELHA,
      barbeiroId,
      data,
      hora,
    });
    assert.equal(reserva.status, 201, `reserva deveria ser 201, veio ${reserva.status}: ${textoDoCorpo(reserva)}`);

    const ocupado = await consultarDisponibilidade(publico, filtro);
    assert.equal(ocupado.status, 200, textoDoCorpo(ocupado));
    const ocupados = horariosDoBarbeiro(ocupado, barbeiroId);
    assert.equal(ocupados.includes(hora), false, `slot ${hora} deveria sumir apos a reserva`);
    assert.ok(ocupados.includes('14:45'), 'slot anterior (14:45) nao deveria ser afetado');
    assert.ok(ocupados.includes('15:15'), 'slot posterior (15:15) nao deveria ser afetado');

    const cancelada = await cancelar(cli, reserva.corpo.agendamento.id);
    assert.equal(cancelada.status, 200, `cancelamento deveria ser 200, veio ${cancelada.status}`);

    const liberado = await consultarDisponibilidade(publico, filtro);
    assert.equal(liberado.status, 200, textoDoCorpo(liberado));
    assert.ok(
      horariosDoBarbeiro(liberado, barbeiroId).includes(hora),
      `slot ${hora} deveria voltar apos o cancelamento`,
    );
  });

  it('bloqueio do barbeiro remove os slots e DELETE devolve', async () => {
    const data = dataFutura(17);
    const barbeiroId = 3;
    const { cli: barbeiro } = await entrar(app.base, 'barbeiro3');

    const filtro = { servicoId: SOBRANCELHA, data, barbeiroId };

    const antes = await consultarDisponibilidade(publico, filtro);
    assert.equal(antes.status, 200, textoDoCorpo(antes));
    assert.ok(horariosDoBarbeiro(antes, barbeiroId).includes('14:00'), '14:00 deveria estar livre');

    const bloqueio = await barbeiro.post('/api/bloqueios', {
      data,
      horaInicio: '14:00',
      horaFim: '16:00',
      motivo: 'Treinamento',
    });
    assert.equal(bloqueio.status, 201, `bloqueio deveria ser 201, veio ${bloqueio.status}: ${textoDoCorpo(bloqueio)}`);
    const bloqueioId = bloqueio.corpo && bloqueio.corpo.bloqueio && bloqueio.corpo.bloqueio.id;
    assert.ok(bloqueioId, 'bloqueio deve devolver id');

    const bloqueado = await consultarDisponibilidade(publico, filtro);
    assert.equal(bloqueado.status, 200, textoDoCorpo(bloqueado));
    const horarios = horariosDoBarbeiro(bloqueado, barbeiroId);
    for (let minuto = horaParaMinutos('14:00'); minuto < horaParaMinutos('16:00'); minuto += 15) {
      const slot = `${String(Math.floor(minuto / 60)).padStart(2, '0')}:${String(minuto % 60).padStart(2, '0')}`;
      assert.equal(horarios.includes(slot), false, `slot ${slot} deveria estar bloqueado`);
    }
    assert.ok(horarios.includes('13:45'), '13:45 termina antes do bloqueio e deve continuar livre');
    assert.ok(horarios.includes('16:00'), '16:00 inicia no fim do bloqueio e deve continuar livre');

    const removido = await barbeiro.del(`/api/bloqueios/${bloqueioId}`);
    assert.equal(removido.status, 204, `DELETE bloqueio deveria ser 204, veio ${removido.status}`);

    const liberado = await consultarDisponibilidade(publico, filtro);
    assert.equal(liberado.status, 200, textoDoCorpo(liberado));
    assert.ok(
      horariosDoBarbeiro(liberado, barbeiroId).includes('14:00'),
      '14:00 deveria voltar apos remover o bloqueio',
    );
  });

  it('feriado remove o dia inteiro', async () => {
    const data = dataFutura(18);
    const { cli: admin } = await entrar(app.base, 'admin');

    const criado = await admin.post('/api/admin/feriados', {
      data,
      descricao: 'Feriado QA',
    });
    assert.equal(criado.status, 201, `feriado deveria ser 201, veio ${criado.status}: ${textoDoCorpo(criado)}`);

    const resposta = await consultarDisponibilidade(publico, {
      servicoId: CORTE,
      data,
    });
    assert.ok(
      resposta.status === 200 || resposta.status === 422,
      `feriado deveria ser 200 vazio ou 422, veio ${resposta.status}`,
    );
    if (resposta.status === 200) {
      const horarios = todosOsHorarios(resposta);
      assert.equal(horarios.length, 0, `feriado ${data} nao pode ter horarios: ${horarios.join(', ')}`);
    }

    const config = await publico.get('/api/configuracoes');
    assert.equal(config.status, 200, textoDoCorpo(config));
    const feriados = (config.corpo && config.corpo.feriados) || [];
    assert.ok(
      feriados.some((feriado) => feriado.data === data),
      `configuracoes devem listar o feriado ${data}`,
    );
  });

  it('"qualquer barbeiro" retorna opcoes dos 4 barbeiros ativos', async () => {
    const resposta = await consultarDisponibilidade(publico, {
      servicoId: CORTE,
      data: dataFutura(19),
    });

    assert.equal(resposta.status, 200, textoDoCorpo(resposta));
    const opcoes = opcoesDe(resposta);
    assert.equal(opcoes.length, 4, `deveria haver 4 opcoes de barbeiro, veio ${opcoes.length}`);
    assert.deepEqual(
      opcoes.map((opcao) => opcao.barbeiroId).sort((a, b) => a - b),
      [1, 2, 3, 4],
      'opcoes devem cobrir os barbeiros 1..4',
    );
    for (const opcao of opcoes) {
      assert.equal(typeof opcao.barbeiroNome, 'string');
      assert.ok(opcao.barbeiroNome.length > 0, 'opcao deve ter barbeiroNome');
      assert.ok(Array.isArray(opcao.horarios), 'opcao deve ter lista de horarios');
    }
  });
});
