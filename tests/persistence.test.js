'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  startTestApp,
  novoCliente,
  cadastrarCliente,
  entrar,
  criarAgendamento,
  listarAgendamentos,
  proximoDiaUtil,
  dataFutura,
  caminhoBancoTemporario,
  removerArquivosBanco,
  textoDoCorpo,
} = require('./helpers');

describe('persistencia: reinicio do processo e reset demonstrativo', () => {
  let app;
  let dbPath;

  beforeEach(async () => {
    dbPath = caminhoBancoTemporario('barberprime-persistencia');
    app = await startTestApp({ dbPath });
  });

  afterEach(async () => {
    if (app) await app.close();
    app = null;
    await removerArquivosBanco(dbPath);
  });

  it('agendamento e sessao (cookie) sobrevivem ao reinicio com o mesmo banco', async () => {
    const data = dataFutura(25);
    const cliente = await cadastrarCliente(app.base, { nome: 'Persistente', sobrenome: 'Sessao' });
    const cookieAntes = cliente.cli.cabecalhoCookies();
    assert.ok(cookieAntes.includes('bp_sess='), 'cliente deveria ter cookie de sessao');

    const criado = await criarAgendamento(cliente.cli, {
      servicoId: 1,
      barbeiroId: 4,
      data,
      hora: '15:00',
    });
    assert.equal(criado.status, 201, textoDoCorpo(criado));
    const agendamentoId = criado.corpo.agendamento.id;

    await app.close();
    app = await startTestApp({ dbPath });

    const clienteRestart = novoCliente(app.base, 'cliente-restart');
    clienteRestart.aplicarCabecalhoCookies(cookieAntes);
    const me = await clienteRestart.get('/api/me');
    assert.equal(me.status, 200, `sessao deveria sobreviver ao reinicio, veio ${me.status}: ${textoDoCorpo(me)}`);
    assert.equal(me.corpo.usuario.id, cliente.usuario.id);

    const { cli: admin } = await entrar(app.base, 'admin');
    const lista = await listarAgendamentos(admin, { escopo: 'todos', data, barbeiroId: 4 });
    assert.equal(lista.status, 200, textoDoCorpo(lista));
    const persistido = (lista.corpo.agendamentos || []).find((a) => a.id === agendamentoId);
    assert.ok(persistido, `agendamento ${agendamentoId} deveria existir apos reinicio`);
    assert.equal(persistido.status, 'agendado');
    assert.equal(persistido.inicio, `${data} 15:00`);
    assert.equal(persistido.cliente.id, cliente.usuario.id);
  });

  it('reset-demo (admin) re-semeia com ids deterministicos; cliente/barbeiro recebem 403', async () => {
    const adminInicial = await entrar(app.base, 'admin');

    // Cria um agendamento extra para provar que o reset limpa o banco.
    const clientes = await adminInicial.cli.get('/api/admin/clientes');
    assert.equal(clientes.status, 200, textoDoCorpo(clientes));
    const clienteSeed = (clientes.corpo.clientes || [])[0];
    assert.ok(clienteSeed, 'seed deve ter clientes');

    const extra = await criarAgendamento(adminInicial.cli, {
      servicoId: 1,
      barbeiroId: 4,
      data: dataFutura(26),
      hora: '15:00',
      clienteId: clienteSeed.id,
    });
    assert.equal(extra.status, 201, textoDoCorpo(extra));

    const reset1 = await adminInicial.cli.post('/api/admin/reset-demo', {});
    assert.equal(reset1.status, 200, `reset-demo deveria ser 200, veio ${reset1.status}: ${textoDoCorpo(reset1)}`);
    assert.equal(reset1.corpo && reset1.corpo.ok, true);
    assert.equal(reset1.corpo && reset1.corpo.reiniciado, true);

    const diaSeed = proximoDiaUtil(1);
    const { cli: admin1 } = await entrar(app.base, 'admin');
    const seed1 = await listarAgendamentos(admin1, { escopo: 'todos', data: diaSeed });
    assert.equal(seed1.status, 200, textoDoCorpo(seed1));
    const agendamentosSeed1 = (seed1.corpo.agendamentos || []).sort((a, b) => a.id - b.id);

    assert.deepEqual(
      agendamentosSeed1.map((a) => a.id),
      [1, 2],
      `seed deve recomecar ids em 1..2, veio: ${agendamentosSeed1.map((a) => a.id).join(',')}`,
    );
    assert.deepEqual(
      agendamentosSeed1.map((a) => a.hora),
      ['10:00', '11:00'],
      'seed deve recriar 10:00 e 11:00 no proximo dia util',
    );
    assert.deepEqual(
      agendamentosSeed1.map((a) => a.barbeiro.id),
      [1, 1],
      'seed deve usar o barbeiro 1',
    );
    assert.match(
      `${agendamentosSeed1[0].cliente.nome} ${agendamentosSeed1[0].cliente.sobrenome || ''}`.trim(),
      /^Ana\b/,
      'seed deve usar a cliente Ana Souza',
    );
    assert.match(
      `${agendamentosSeed1[1].cliente.nome} ${agendamentosSeed1[1].cliente.sobrenome || ''}`.trim(),
      /^Carlos\b/,
      'seed deve usar o cliente Carlos Lima',
    );

    // Cria outro extra e reseta de novo: ids devem voltar a ser [1,2].
    const clientes2 = await admin1.get('/api/admin/clientes');
    assert.equal(clientes2.status, 200);
    const extra2 = await criarAgendamento(admin1, {
      servicoId: 1,
      barbeiroId: 4,
      data: dataFutura(27),
      hora: '15:00',
      clienteId: (clientes2.corpo.clientes || [])[0].id,
    });
    assert.equal(extra2.status, 201, textoDoCorpo(extra2));

    const reset2 = await admin1.post('/api/admin/reset-demo', {});
    assert.equal(reset2.status, 200, textoDoCorpo(reset2));

    const { cli: admin2 } = await entrar(app.base, 'admin');
    const seed2 = await listarAgendamentos(admin2, { escopo: 'todos', data: diaSeed });
    const ids2 = (seed2.corpo.agendamentos || []).map((a) => a.id).sort((a, b) => a - b);
    assert.deepEqual(ids2, [1, 2], `segundo reset deve voltar ids para 1..2, veio ${ids2.join(',')}`);

    // Servicos e barbeiros tambem voltam deterministicos.
    const servicos = await novoCliente(app.base, 'pos-reset').get('/api/servicos');
    assert.equal(servicos.status, 200, textoDoCorpo(servicos));
    assert.deepEqual(
      (servicos.corpo.servicos || []).map((s) => s.id).sort((a, b) => a - b),
      [1, 2, 3, 4, 5],
      'servicos devem ter ids deterministicos 1..5',
    );

    const barbeiros = await novoCliente(app.base, 'pos-reset-b').get('/api/barbeiros');
    assert.equal(barbeiros.status, 200, textoDoCorpo(barbeiros));
    assert.deepEqual(
      (barbeiros.corpo.barbeiros || []).map((b) => b.id).sort((a, b) => a - b),
      [1, 2, 3, 4],
      'barbeiros devem ter ids deterministicos 1..4',
    );

    // Reset e exclusivo de admin.
    const { cli: barbeiro1 } = await entrar(app.base, 'barbeiro1');
    const resetBarbeiro = await barbeiro1.post('/api/admin/reset-demo', {});
    assert.equal(resetBarbeiro.status, 403, `barbeiro no reset-demo deveria ser 403, veio ${resetBarbeiro.status}`);
    assert.equal(resetBarbeiro.corpo && resetBarbeiro.corpo.erro, 'sem_permissao');

    const { cli: cliente1 } = await entrar(app.base, 'cliente1');
    const resetCliente = await cliente1.post('/api/admin/reset-demo', {});
    assert.equal(resetCliente.status, 403, `cliente no reset-demo deveria ser 403, veio ${resetCliente.status}`);

    const anonimo = novoCliente(app.base, 'anonimo-reset');
    const resetAnonimo = await anonimo.post('/api/admin/reset-demo', {});
    assert.equal(resetAnonimo.status, 401, `anonimo no reset-demo deveria ser 401, veio ${resetAnonimo.status}`);
  });
});
