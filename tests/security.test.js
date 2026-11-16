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
  contemCampoSensivel,
  textoDoCorpo,
} = require('./helpers');

const CORTE = 1;

describe('seguranca: autorizacao, injecao, XSS, rate limit e limites de payload', () => {
  let app;

  beforeEach(async () => {
    app = await startTestApp();
  });

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it('rotas /api/admin/*: anonimo 401; cliente e barbeiro 403', async () => {
    const rotas = [
      { metodo: 'get', caminho: '/api/admin/dashboard' },
      { metodo: 'get', caminho: '/api/admin/clientes' },
      { metodo: 'get', caminho: '/api/admin/config' },
      { metodo: 'get', caminho: '/api/auditoria?limite=50' },
      { metodo: 'post', caminho: '/api/admin/reset-demo', corpo: {} },
      { metodo: 'post', caminho: '/api/admin/servicos', corpo: { nome: 'X', descricao: 'Y', precoCentavos: 1, duracaoMin: 15 } },
    ];

    const anonimo = novoCliente(app.base, 'anonimo-admin');
    for (const rota of rotas) {
      const resposta = rota.metodo === 'post'
        ? await anonimo.post(rota.caminho, rota.corpo)
        : await anonimo.get(rota.caminho);
      assert.equal(
        resposta.status,
        401,
        `${rota.metodo.toUpperCase()} ${rota.caminho} anonimo deveria ser 401, veio ${resposta.status}`,
      );
      assert.equal(resposta.corpo && resposta.corpo.erro, 'nao_autenticado');
    }

    const atores = [
      { conta: 'cliente1', rotulo: 'cliente' },
      { conta: 'barbeiro1', rotulo: 'barbeiro' },
    ];
    for (const ator of atores) {
      const { cli } = await entrar(app.base, ator.conta);
      for (const rota of rotas) {
        const resposta = rota.metodo === 'post'
          ? await cli.post(rota.caminho, rota.corpo)
          : await cli.get(rota.caminho);
        assert.equal(
          resposta.status,
          403,
          `${ator.rotulo} em ${rota.metodo.toUpperCase()} ${rota.caminho} deveria ser 403, veio ${resposta.status}`,
        );
        assert.equal(resposta.corpo && resposta.corpo.erro, 'sem_permissao');
      }
    }
  });

  it('SQL injection no login nao autentica e nao derruba o servidor', async () => {
    const payloads = ["' OR 1=1 --", "admin' --", "' OR '1'='1"];
    const cli = novoCliente(app.base, 'sql-injection-login');

    for (const payload of payloads) {
      const resposta = await cli.login(payload, 'qualquer');
      assert.equal(
        resposta.status,
        401,
        `payload ${payload} nao pode autenticar (veio ${resposta.status})`,
      );
      assert.equal(resposta.corpo && resposta.corpo.erro, 'credenciais_invalidas');
      assert.equal((resposta.setCookies || []).length, 0, 'injection nao pode criar sessao');
    }

    const barbeiros = await cli.get('/api/barbeiros');
    assert.equal(barbeiros.status, 200, 'servidor deve continuar respondendo apos tentativas de injection');
  });

  it('SQL injection em parametros nao quebra a API e nao vaza dados', async () => {
    const publico = novoCliente(app.base, 'sql-injection-param');
    const data = dataFutura(12);

    const resposta = await consultarDisponibilidade(publico, {
      servicoId: "1' OR '1'='1",
      data,
    });
    assert.ok(
      resposta.status === 404 || resposta.status === 422,
      `servicoId injetado deveria ser 404/422, veio ${resposta.status}: ${textoDoCorpo(resposta)}`,
    );
    assert.equal(resposta.status >= 500, false, 'injection nao pode causar 500');

    const normal = await consultarDisponibilidade(publico, { servicoId: CORTE, data });
    assert.equal(normal.status, 200, 'API deve continuar funcional depois da tentativa');

    const { cli: admin } = await entrar(app.base, 'admin');
    const listaInjetada = await listarAgendamentos(admin, {
      escopo: 'todos',
      data: "2026-01-01' OR '1'='1",
    });
    assert.ok(
      listaInjetada.status === 200 || listaInjetada.status === 422 || listaInjetada.status === 400,
      `data injetada em /api/agendamentos deveria ser 200/400/422, veio ${listaInjetada.status}`,
    );
    assert.equal(listaInjetada.status >= 500, false, 'injection em filtro nao pode causar 500');

    const listaNormal = await listarAgendamentos(admin, { escopo: 'todos' });
    assert.equal(listaNormal.status, 200, 'admin deve continuar listando apos tentativa de injection');
  });

  it('payload XSS e devolvido como string JSON e nao executa/alterara o banco', async () => {
    const publico = novoCliente(app.base, 'xss');
    const xss = '<script>alert(1)</script>';
    const telefoneXss = '11988887777';

    const cadastro = await publico.post('/api/clientes', {
      nome: xss,
      sobrenome: 'Seguro',
      telefone: telefoneXss,
      pin: '1234',
    });
    assert.equal(cadastro.status, 201, `cadastro com XSS deveria ser 201, veio ${cadastro.status}: ${textoDoCorpo(cadastro)}`);
    assert.equal(typeof cadastro.corpo.usuario.nome, 'string', 'nome deve ser string JSON');
    assert.ok(
      cadastro.corpo.usuario.nome.includes('alert(1)'),
      `payload XSS deve ser preservado como texto, veio: ${cadastro.corpo.usuario.nome}`,
    );
    assert.match(
      cadastro.headers.get('content-type') || '',
      /application\/json/i,
      'resposta deve ser application/json (navegador nao executa como HTML)',
    );

    const me = await publico.get('/api/me');
    assert.equal(me.status, 200);
    assert.equal(typeof me.corpo.usuario.nome, 'string');
    assert.ok(me.corpo.usuario.nome.includes('alert(1)'));

    const { cli: admin } = await entrar(app.base, 'admin');
    const clientes = await admin.get('/api/admin/clientes');
    assert.equal(clientes.status, 200, textoDoCorpo(clientes));
    const salvo = (clientes.corpo.clientes || []).find((c) => c.telefone === telefoneXss);
    assert.ok(salvo, 'cliente com payload deve existir no banco');
    assert.equal(typeof salvo.nome, 'string');
    assert.ok(salvo.nome.includes('alert(1)'), 'banco deve guardar o texto, sem executar instrucoes');

    // Payload com cara de SQL tambem nao pode alterar tabelas.
    const telefoneSql = '11988887788';
    const cadastroSql = await novoCliente(app.base, 'sqli-nome').post('/api/clientes', {
      nome: "Robert'); DROP TABLE usuarios;--",
      sobrenome: 'Santos',
      telefone: telefoneSql,
      pin: '1234',
    });
    assert.equal(cadastroSql.status, 201, `cadastro com payload SQL deveria ser 201, veio ${cadastroSql.status}`);

    const barbeiros = await publico.get('/api/barbeiros');
    assert.equal(barbeiros.status, 200, 'tabela usuarios/barbeiros deve continuar intacta');
    const adminDepois = await novoCliente(app.base, 'admin-depois').login('admin', 'admin123');
    assert.equal(adminDepois.status, 200, 'login admin deve continuar funcionando');
  });

  it('cliente nao altera agendamento de outro (403 em cancelar, reagendar e status)', async () => {
    const data = dataFutura(20);
    const clienteA = await cadastrarCliente(app.base, { nome: 'Dono', sobrenome: 'QA' });
    const clienteB = await cadastrarCliente(app.base, { nome: 'Intruso', sobrenome: 'QA' });

    const reserva = await criarAgendamento(clienteA.cli, {
      servicoId: CORTE,
      barbeiroId: 3,
      data,
      hora: '15:00',
    });
    assert.equal(reserva.status, 201, textoDoCorpo(reserva));
    const id = reserva.corpo.agendamento.id;

    const tentativas = [
      ['cancelar', await cancelar(clienteB.cli, id)],
      ['reagendar', await reagendar(clienteB.cli, id, { data, hora: '16:00' })],
      ['status', await mudarStatus(clienteB.cli, id, 'concluido')],
    ];
    for (const [acao, resposta] of tentativas) {
      assert.equal(
        resposta.status,
        403,
        `cliente nao pode ${acao} agendamento alheio (esperado 403), veio ${resposta.status}: ${textoDoCorpo(resposta)}`,
      );
      assert.equal(resposta.corpo && resposta.corpo.erro, 'sem_permissao');
    }

    const lista = await listarAgendamentos(clienteA.cli, { escopo: 'todos' });
    assert.equal(lista.status, 200);
    const aindaAtivo = (lista.corpo.agendamentos || []).find((a) => a.id === id);
    assert.ok(aindaAtivo, 'agendamento deve continuar existindo');
    assert.equal(aindaAtivo.status, 'agendado', 'agendamento alheio nao pode ter sido alterado');
    assert.equal(aindaAtivo.hora, '15:00');
  });

  it('login nao enumera usuarios: inexistente e senha errada tem a mesma resposta', async () => {
    const cli = novoCliente(app.base, 'enumeracao');

    const inexistente = await cli.login('usuario_que_nao_existe_qa', 'qualquer');
    const senhaErrada = await cli.login('admin', 'senha_errada_qa');

    assert.equal(inexistente.status, 401);
    assert.equal(senhaErrada.status, 401);
    assert.equal(inexistente.corpo && inexistente.corpo.erro, 'credenciais_invalidas');
    assert.equal(senhaErrada.corpo && senhaErrada.corpo.erro, 'credenciais_invalidas');
    assert.equal(
      inexistente.corpo && inexistente.corpo.mensagem,
      senhaErrada.corpo && senhaErrada.corpo.mensagem,
      'mensagem deve ser generica e identica para login inexistente e senha errada',
    );
    assert.equal((inexistente.setCookies || []).length, 0);
    assert.equal((senhaErrada.setCookies || []).length, 0);
  });

  it('rate limit de login: 11 tentativas retorna 429', async () => {
    const cli = novoCliente(app.base, 'rate-limit');
    const statuses = [];

    for (let tentativa = 1; tentativa <= 11; tentativa += 1) {
      const resposta = await cli.login('admin', 'senha_errada_qa');
      statuses.push(resposta.status);
      if (tentativa === 11) {
        assert.equal(
          resposta.status,
          429,
          `11a tentativa deveria ser 429, veio ${resposta.status}. Status anteriores: ${statuses.join(',')}`,
        );
        assert.equal(resposta.corpo && resposta.corpo.erro, 'limite_excedido');
      }
    }

    assert.equal(statuses.slice(0, 10).includes(429), false, `primeiras 10 tentativas nao podem ser 429: ${statuses.join(',')}`);
    assert.equal(statuses.filter((status) => status === 401).length, 10, `esperava 10x401, veio: ${statuses.join(',')}`);
  });

  it('metodo errado retorna 405 ou 404', async () => {
    const cli = novoCliente(app.base, 'metodo-errado');

    const casos = [
      ['DELETE /api/login', await cli.del('/api/login')],
      ['PUT /api/servicos', await cli.put('/api/servicos', {})],
    ];

    for (const [rotulo, resposta] of casos) {
      assert.ok(
        resposta.status === 405 || resposta.status === 404,
        `${rotulo} deveria ser 405/404, veio ${resposta.status}: ${textoDoCorpo(resposta)}`,
      );
    }
  });

  it('Content-Type invalido em mutacao retorna 415 ou 400', async () => {
    const { cli: admin } = await entrar(app.base, 'admin');
    const data = dataFutura(21);

    const agendamento = await admin.post(
      '/api/agendamentos',
      undefined,
      {
        bruto: JSON.stringify({ servicoId: CORTE, barbeiroId: 3, data, hora: '15:00', clienteId: 1 }),
        contentType: 'text/plain',
      },
    );
    assert.ok(
      agendamento.status === 415 || agendamento.status === 400,
      `POST agendamento com text/plain deveria ser 415/400, veio ${agendamento.status}: ${textoDoCorpo(agendamento)}`,
    );

    const login = await novoCliente(app.base, 'login-texto').post(
      '/api/login',
      undefined,
      {
        bruto: JSON.stringify({ login: 'admin', senha: 'admin123' }),
        contentType: 'text/plain',
      },
    );
    assert.ok(
      login.status === 415 || login.status === 400,
      `POST /api/login com text/plain deveria ser 415/400, veio ${login.status}: ${textoDoCorpo(login)}`,
    );
    assert.equal((login.setCookies || []).length, 0, 'Content-Type invalido nao pode autenticar');
  });

  it('body gigante e rejeitado com 413 ou 400 sem derrubar o servidor', async () => {
    const cli = novoCliente(app.base, 'body-gigante');
    const gigante = `{"login":"${'a'.repeat(2 * 1024 * 1024)}","senha":"x"}`;

    let resposta;
    try {
      resposta = await cli.post('/api/login', undefined, { bruto: gigante });
    } catch (erro) {
      assert.fail(`servidor deveria responder 413/400 ao body gigante, mas a conexao falhou: ${erro.message}`);
    }

    assert.ok(
      resposta.status === 413 || resposta.status === 400,
      `body gigante deveria ser 413/400, veio ${resposta.status}: ${textoDoCorpo(resposta).slice(0, 200)}`,
    );

    const vivo = await cli.get('/api/barbeiros');
    assert.equal(vivo.status, 200, 'servidor deve continuar respondendo apos body gigante');
  });

  it('nenhuma resposta contem senha_hash ou pin', async () => {
    const adminLogin = novoCliente(app.base, 'scan-login-admin');
    const adminResposta = await adminLogin.login('admin', 'admin123');
    assert.equal(adminResposta.status, 200);

    const sessaoCliente = await entrar(app.base, 'cliente1');
    const clienteResposta = sessaoCliente.resposta;
    const clienteLogin = sessaoCliente.cli;

    const cadastro = await cadastrarCliente(app.base, { nome: 'Sem', sobrenome: 'Segredo', pin: '9876' });

    const respostas = [
      adminResposta,
      clienteResposta,
      cadastro.resposta,
      await adminLogin.get('/api/me'),
      await adminLogin.get('/api/admin/clientes'),
      await adminLogin.get('/api/auditoria?limite=50'),
      await adminLogin.get('/api/agendamentos?escopo=todos'),
      await clienteLogin.get('/api/me'),
    ];

    for (const resposta of respostas) {
      assert.equal(
        contemCampoSensivel(resposta.corpo),
        false,
        `resposta ${resposta.status} contem chave pin/senha/senha_hash`,
      );
      assert.doesNotMatch(resposta.texto, /senha_hash|senhaHash/i, 'resposta nao pode citar senha_hash');
      assert.doesNotMatch(resposta.texto, /"pin"\s*:/i, 'resposta nao pode ter campo pin');
      assert.equal(resposta.texto.includes('admin123'), false, 'resposta nao pode devolver a senha do admin');
    }
  });

  it('respostas incluem cabecalhos de seguranca (CSP, frames, nosniff)', async () => {
    const api = await fetch(app.base + '/api/health');
    assert.equal(api.status, 200);
    assert.match(api.headers.get('content-security-policy') || '', /default-src 'self'/);
    assert.match(api.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
    assert.equal(api.headers.get('x-frame-options'), 'DENY');
    assert.equal(api.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(api.headers.get('referrer-policy'), 'no-referrer');

    const home = await fetch(app.base + '/');
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('x-frame-options'), 'DENY');
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  });
});
