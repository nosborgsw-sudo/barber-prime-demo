'use strict';

const {
  ErroHttp,
  agoraLocal,
  validarData,
  validarHora,
  horaParaMin,
  minParaHora,
  diaSemanaDeData,
  somarDias,
  diferencaDias,
  listarDias,
  minutosSobrepoem,
  mdc,
} = require('./util');

const LOJA_ABRE_MIN = 9 * 60; // 09:00
const LOJA_FECHA_MIN = 19 * 60; // 19:00
const GRADE_MIN = 15;
const MAX_DIAS_RESUMO = 62;

const CONFIG_PADRAO = {
  antecedenciaMinMin: 30,
  antecedenciaMaxDias: 365,
};

function lerConfigNumeros(db) {
  const linhas = db
    .prepare(
      `SELECT chave, valor FROM configuracoes
        WHERE chave IN ('antecedenciaMinMin','antecedenciaMaxDias')`
    )
    .all();
  const mapa = {};
  for (const linha of linhas) mapa[linha.chave] = Number(linha.valor);
  const antecedenciaMinMin =
    Number.isFinite(mapa.antecedenciaMinMin) && mapa.antecedenciaMinMin >= 0
      ? mapa.antecedenciaMinMin
      : CONFIG_PADRAO.antecedenciaMinMin;
  const antecedenciaMaxDias =
    Number.isFinite(mapa.antecedenciaMaxDias) && mapa.antecedenciaMaxDias > 0
      ? mapa.antecedenciaMaxDias
      : CONFIG_PADRAO.antecedenciaMaxDias;
  return { antecedenciaMinMin, antecedenciaMaxDias };
}

function feriadoEm(db, data) {
  return db.prepare('SELECT data, descricao FROM feriados WHERE data = ?').get(data) || null;
}

function jornadaDoDia(db, barbeiroId, diaSemana) {
  return (
    db
      .prepare(
        'SELECT * FROM jornadas WHERE barbeiro_id = ? AND dia_semana = ?'
      )
      .get(barbeiroId, diaSemana) || null
  );
}

function barbeirosAtivos(db) {
  return db
    .prepare(
      `SELECT b.id, u.nome, u.sobrenome
         FROM barbeiros b
         JOIN usuarios u ON u.id = b.usuario_id
        WHERE b.ativo = 1 AND u.ativo = 1
        ORDER BY b.id`
    )
    .all();
}

function nomeBarbeiro(linha) {
  return [linha.nome, linha.sobrenome].filter(Boolean).join(' ').trim();
}

function passoGrade(duracaoMin) {
  return Math.max(1, mdc(GRADE_MIN, duracaoMin));
}

function inicioJanela(jornada) {
  return Math.max(horaParaMin(jornada.inicio), LOJA_ABRE_MIN);
}

function fimJanela(jornada) {
  return Math.min(horaParaMin(jornada.fim), LOJA_FECHA_MIN);
}

/** Intervalo efetivo (recortado pela janela), em minutos, ou null. */
function intervaloEfetivo(jornada) {
  if (!jornada.intervalo_inicio || !jornada.intervalo_fim) return null;
  const inicio = horaParaMin(jornada.intervalo_inicio);
  const fim = horaParaMin(jornada.intervalo_fim);
  if (!(inicio < fim)) return null;
  return { inicio, fim };
}

function bloqueiosDoDia(db, data, barbeiroId) {
  return db
    .prepare(
      `SELECT id, barbeiro_id, hora_inicio, hora_fim, motivo
         FROM bloqueios
        WHERE data = ? AND (barbeiro_id = ? OR barbeiro_id IS NULL)`
    )
    .all(data, barbeiroId)
    .map((b) => ({
      ...b,
      inicioMin: horaParaMin(b.hora_inicio),
      fimMin: horaParaMin(b.hora_fim),
    }));
}

function agendamentosDoDia(db, data, barbeiroId, ignorarAgendamentoId) {
  const sql = `SELECT id, hora, duracao_min, status
                 FROM agendamentos
                WHERE data = ? AND barbeiro_id = ? AND status = 'agendado'
                ${ignorarAgendamentoId ? 'AND id <> ?' : ''}`;
  const params = ignorarAgendamentoId
    ? [data, barbeiroId, ignorarAgendamentoId]
    : [data, barbeiroId];
  return db
    .prepare(sql)
    .all(...params)
    .map((a) => ({
      ...a,
      inicioMin: horaParaMin(a.hora),
      fimMin: horaParaMin(a.hora) + Number(a.duracao_min),
    }));
}

/**
 * Lista os horários livres de um barbeiro em uma data (regras 1..7 do contrato).
 * Retorna [] para dia fechado, feriado, jornada inativa ou sem encaixe.
 */
function horariosDoBarbeiro(
  db,
  { data, duracaoMin, barbeiroId, ignorarAgendamentoId = null }
) {
  const duracao = Number(duracaoMin);
  if (!validarData(data) || !Number.isInteger(duracao) || duracao <= 0) return [];
  const diaSemana = diaSemanaDeData(data);
  if (diaSemana === 0) return [];
  if (feriadoEm(db, data)) return [];

  const jornada = jornadaDoDia(db, barbeiroId, diaSemana);
  if (!jornada || !Number(jornada.ativo)) return [];

  const inicio = inicioJanela(jornada);
  const fim = fimJanela(jornada);
  if (fim - inicio < duracao) return [];

  const intervalo = intervaloEfetivo(jornada);
  const bloqueios = bloqueiosDoDia(db, data, barbeiroId);
  const ocupados = agendamentosDoDia(db, data, barbeiroId, ignorarAgendamentoId);

  const agora = agoraLocal();
  const config = lerConfigNumeros(db);
  const minimoInicio =
    data === agora.data
      ? agora.minutos + config.antecedenciaMinMin
      : data < agora.data
        ? Number.POSITIVE_INFINITY
        : 0;

  const passo = passoGrade(duracao);
  const horarios = [];
  let minuto = Math.ceil(inicio / passo) * passo;
  for (; minuto + duracao <= fim; minuto += passo) {
    if (minuto < minimoInicio) continue;
    const fimSlot = minuto + duracao;
    if (intervalo && minutosSobrepoem(minuto, fimSlot, intervalo.inicio, intervalo.fim)) {
      continue;
    }
    if (
      bloqueios.some((b) => minutosSobrepoem(minuto, fimSlot, b.inicioMin, b.fimMin))
    ) {
      continue;
    }
    if (
      ocupados.some((a) => minutosSobrepoem(minuto, fimSlot, a.inicioMin, a.fimMin))
    ) {
      continue;
    }
    horarios.push(minParaHora(minuto));
  }
  return horarios;
}

/**
 * Valida um slot específico para escrita (dentro da transação de reserva).
 * 422 = entrada inválida/passado/fora da grade/antecedência.
 * 409 = horário indisponível (fechado, jornada, intervalo, bloqueio, reserva).
 * Lança ErroHttp; retorna true quando livre.
 */
function validarSlot(
  db,
  { data, hora, duracaoMin, barbeiroId, ignorarAgendamentoId = null }
) {
  if (!validarData(data)) {
    throw new ErroHttp(422, 'validacao', 'Data inválida. Use o formato YYYY-MM-DD.');
  }
  if (!validarHora(hora)) {
    throw new ErroHttp(422, 'validacao', 'Horário inválido. Use o formato HH:MM.');
  }
  const duracao = Number(duracaoMin);
  if (!Number.isInteger(duracao) || duracao <= 0) {
    throw new ErroHttp(422, 'validacao', 'Duração do serviço inválida.');
  }

  const agora = agoraLocal();
  const config = lerConfigNumeros(db);

  if (data < agora.data) {
    throw new ErroHttp(422, 'validacao', 'Não é possível agendar no passado.');
  }
  if (diferencaDias(agora.data, data) > config.antecedenciaMaxDias) {
    throw new ErroHttp(
      422,
      'validacao',
      `A data máxima para agendamento é ${config.antecedenciaMaxDias} dias à frente.`
    );
  }

  const minuto = horaParaMin(hora);
  if (data === agora.data && minuto < agora.minutos + config.antecedenciaMinMin) {
    throw new ErroHttp(
      422,
      'validacao',
      `É necessário agendar com pelo menos ${config.antecedenciaMinMin} minutos de antecedência.`
    );
  }

  const passo = passoGrade(duracao);
  if (minuto % passo !== 0) {
    throw new ErroHttp(422, 'validacao', 'Horário fora da grade de atendimento.');
  }

  const diaSemana = diaSemanaDeData(data);
  if (diaSemana === 0) {
    throw new ErroHttp(409, 'horario_indisponivel', 'A barbearia está fechada neste dia.');
  }
  if (feriadoEm(db, data)) {
    throw new ErroHttp(409, 'horario_indisponivel', 'A barbearia está fechada neste feriado.');
  }

  const jornada = jornadaDoDia(db, barbeiroId, diaSemana);
  if (!jornada || !Number(jornada.ativo)) {
    throw new ErroHttp(
      409,
      'horario_indisponivel',
      'O barbeiro não atende neste dia da semana.'
    );
  }

  const inicio = inicioJanela(jornada);
  const fim = fimJanela(jornada);
  if (minuto < inicio || minuto + duracao > fim) {
    throw new ErroHttp(409, 'horario_indisponivel', 'Horário fora do expediente.');
  }

  const intervalo = intervaloEfetivo(jornada);
  if (intervalo && minutosSobrepoem(minuto, minuto + duracao, intervalo.inicio, intervalo.fim)) {
    throw new ErroHttp(
      409,
      'horario_indisponivel',
      'O horário coincide com o intervalo do barbeiro.'
    );
  }

  const bloqueios = bloqueiosDoDia(db, data, barbeiroId);
  if (
    bloqueios.some((b) => minutosSobrepoem(minuto, minuto + duracao, b.inicioMin, b.fimMin))
  ) {
    throw new ErroHttp(409, 'horario_indisponivel', 'O horário está bloqueado.');
  }

  const ocupados = agendamentosDoDia(db, data, barbeiroId, ignorarAgendamentoId);
  if (
    ocupados.some((a) => minutosSobrepoem(minuto, minuto + duracao, a.inicioMin, a.fimMin))
  ) {
    throw new ErroHttp(409, 'horario_indisponivel', 'O horário já está reservado.');
  }

  return true;
}

function servicoPorId(db, servicoId) {
  if (!Number.isInteger(servicoId) || servicoId <= 0) {
    throw new ErroHttp(422, 'validacao', 'servicoId inválido.');
  }
  const servico = db.prepare('SELECT * FROM servicos WHERE id = ?').get(servicoId);
  if (!servico) {
    throw new ErroHttp(404, 'nao_encontrado', 'Serviço não encontrado.');
  }
  if (!Number(servico.ativo)) {
    throw new ErroHttp(422, 'validacao', 'Este serviço não está disponível.');
  }
  return servico;
}

function validarDataDisponibilidade(data, config, agora) {
  if (!validarData(data)) {
    throw new ErroHttp(422, 'validacao', 'Data inválida. Use o formato YYYY-MM-DD.');
  }
  if (data < agora.data) {
    throw new ErroHttp(422, 'validacao', 'Não é possível consultar datas passadas.');
  }
  if (diferencaDias(agora.data, data) > config.antecedenciaMaxDias) {
    throw new ErroHttp(
      422,
      'validacao',
      `A data máxima para agendamento é ${config.antecedenciaMaxDias} dias à frente.`
    );
  }
}

/**
 * GET /api/disponibilidade.
 */
function disponibilidade(db, { servicoId, data, barbeiroId = null }) {
  const servico = servicoPorId(db, servicoId);
  const agora = agoraLocal();
  const config = lerConfigNumeros(db);
  validarDataDisponibilidade(data, config, agora);

  let alvos;
  if (barbeiroId !== null && barbeiroId !== undefined) {
    const barbeiro = db
      .prepare(
        `SELECT b.id, u.nome, u.sobrenome
           FROM barbeiros b
           JOIN usuarios u ON u.id = b.usuario_id
          WHERE b.id = ? AND b.ativo = 1 AND u.ativo = 1`
      )
      .get(barbeiroId);
    if (!barbeiro) {
      throw new ErroHttp(404, 'nao_encontrado', 'Barbeiro não encontrado.');
    }
    alvos = [barbeiro];
  } else {
    alvos = barbeirosAtivos(db);
  }

  const opcoes = alvos.map((b) => ({
    barbeiroId: Number(b.id),
    barbeiroNome: nomeBarbeiro(b),
    horarios: horariosDoBarbeiro(db, {
      data,
      duracaoMin: servico.duracao_min,
      barbeiroId: b.id,
    }),
  }));

  return {
    data,
    servicoId: Number(servico.id),
    duracaoMin: Number(servico.duracao_min),
    opcoes,
  };
}

/**
 * GET /api/disponibilidade/resumo — até 62 dias.
 */
function resumoDisponibilidade(db, { servicoId, de, ate }) {
  const servico = servicoPorId(db, servicoId);
  if (!validarData(de) || !validarData(ate)) {
    throw new ErroHttp(422, 'validacao', 'Informe de/ate no formato YYYY-MM-DD.');
  }
  if (ate < de) {
    throw new ErroHttp(422, 'validacao', 'A data final deve ser igual ou posterior à inicial.');
  }
  const totalDias = diferencaDias(de, ate) + 1;
  if (totalDias > MAX_DIAS_RESUMO) {
    throw new ErroHttp(
      422,
      'validacao',
      `O resumo aceita no máximo ${MAX_DIAS_RESUMO} dias por consulta.`
    );
  }

  const agora = agoraLocal();
  const config = lerConfigNumeros(db);
  const barbeiros = barbeirosAtivos(db);
  const dias = [];

  for (const data of listarDias(de, ate)) {
    const foraDoPassado = data >= agora.data;
    const dentroDoMaximo = diferencaDias(agora.data, data) <= config.antecedenciaMaxDias;
    if (!foraDoPassado || !dentroDoMaximo) {
      dias.push({ data, disponivel: false, vagas: 0 });
      continue;
    }
    let vagas = 0;
    for (const b of barbeiros) {
      vagas += horariosDoBarbeiro(db, {
        data,
        duracaoMin: servico.duracao_min,
        barbeiroId: b.id,
      }).length;
    }
    dias.push({ data, disponivel: vagas > 0, vagas });
  }

  return { dias };
}

/**
 * Minutos de capacidade efetiva de um barbeiro em uma data.
 * Usado pelo dashboard (jornada recortada pela loja, menos intervalo).
 */
function capacidadeMinutosDia(db, { data, barbeiroId = null }) {
  if (!validarData(data)) return 0;
  const diaSemana = diaSemanaDeData(data);
  if (diaSemana === 0 || feriadoEm(db, data)) return 0;

  let barbeiros;
  if (barbeiroId !== null && barbeiroId !== undefined) {
    barbeiros = [{ id: barbeiroId }];
  } else {
    barbeiros = db.prepare('SELECT id FROM barbeiros WHERE ativo = 1').all();
  }

  let total = 0;
  for (const b of barbeiros) {
    const jornada = jornadaDoDia(db, b.id, diaSemana);
    if (!jornada || !Number(jornada.ativo)) continue;
    const inicio = inicioJanela(jornada);
    const fim = fimJanela(jornada);
    if (fim <= inicio) continue;
    let minutos = fim - inicio;
    const intervalo = intervaloEfetivo(jornada);
    if (intervalo) {
      const ini = Math.max(inicio, intervalo.inicio);
      const f = Math.min(fim, intervalo.fim);
      if (f > ini) minutos -= f - ini;
    }
    total += Math.max(0, minutos);
  }
  return total;
}

module.exports = {
  LOJA_ABRE_MIN,
  LOJA_FECHA_MIN,
  GRADE_MIN,
  MAX_DIAS_RESUMO,
  CONFIG_PADRAO,
  lerConfigNumeros,
  feriadoEm,
  jornadaDoDia,
  barbeirosAtivos,
  nomeBarbeiro,
  horariosDoBarbeiro,
  validarSlot,
  servicoPorId,
  disponibilidade,
  resumoDisponibilidade,
  capacidadeMinutosDia,
};
