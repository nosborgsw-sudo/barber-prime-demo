'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  startTestApp,
  novoCliente,
  cadastrarCliente,
  entrar,
  telefoneUnico,
  contemCampoSensivel,
  textoDoCorpo,
  CONTAS_DEMO,
} = require('./helpers');

describe('auth: login, sessao, cadastro e validacoes', () => {
  let app;

  beforeEach(async () => {
    app = await startTestApp();
  });

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it('login: admin e barbeiros autenticam com o papel correto e cookie HttpOnly/SameSite=Lax', async () => {
    const casos = [
      { conta: 'admin', papel: 'admin' },
      { conta: 'barbeiro1', papel: 'barbeiro', barbeiroId: 1 },
      { conta: 'barbeiro4', papel: 'barbeiro', barbeiroId: 4 },
    ];

    for (const caso of casos) {
      const cli = novoCliente(app.base, `login-${caso.conta}`);
      const dados = CONTAS_DEMO[caso.conta];
      const resposta = await cli.login(dados.login, dados.senha);

      assert.equal(
        resposta.status,
        200,
        `login ${caso.conta} deveria retornar 200, veio ${resposta.status}: ${textoDoCorpo(resposta)}`,
      );
      assert.ok(resposta.corpo && resposta.corpo.usuario, 'resposta de login deve conter {usuario}');
      assert.equal(resposta.corpo.usuario.papel, caso.papel, `papel de ${caso.conta}`);
      if (caso.barbeiroId !== undefined) {
        assert.equal(resposta.corpo.usuario.barbeiroId, caso.barbeiroId, 'barbeiroId do login');
      }

      const cookie = (resposta.setCookies || [])[0] || '';
      assert.match(cookie, /^bp_sess=[^;]+/, 'login deve definir cookie bp_sess');
      assert.match(cookie, /HttpOnly/i, 'cookie de sessao deve ser HttpOnly');
      assert.match(cookie, /SameSite=Lax/i, 'cookie de sessao deve ser SameSite=Lax');
      assert.match(cookie, /Path=\//i, 'cookie de sessao deve ter Path=/');
      assert.equal(contemCampoSensivel(resposta.corpo), false, 'login nao pode expor pin/senha/senha_hash');
    }
  });

  it('login de cliente demo usa o telefone como login e o PIN como senha', async () => {
    const cli = novoCliente(app.base, 'login-cliente');
    const resposta = await cli.login('11987650001', '1234');

    assert.equal(
      resposta.status,
      200,
      `cliente demo deveria logar com telefone 11987650001 + PIN 1234, veio ${resposta.status}: ${textoDoCorpo(resposta)}`,
    );
    assert.equal(resposta.corpo && resposta.corpo.usuario && resposta.corpo.usuario.papel, 'cliente');
    const cookie = (resposta.setCookies || [])[0] || '';
    assert.match(cookie, /^bp_sess=[^;]+/, 'login de cliente deve definir cookie bp_sess');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);

    const me = await cli.get('/api/me');
    assert.equal(me.status, 200, 'cookie de cliente deve valer em /api/me');
    assert.equal(me.corpo.usuario.telefone, '11987650001');
  });

  it('GET /api/me devolve o usuario autenticado e 401 sem cookie', async () => {
    const { cli, usuario } = await entrar(app.base, 'cliente1');

    const autenticado = await cli.get('/api/me');
    assert.equal(autenticado.status, 200, textoDoCorpo(autenticado));
    assert.ok(autenticado.corpo && autenticado.corpo.usuario, 'resposta deve conter {usuario}');
    assert.equal(autenticado.corpo.usuario.id, usuario.id);
    assert.equal(autenticado.corpo.usuario.papel, 'cliente');
    assert.equal(contemCampoSensivel(autenticado.corpo), false, '/api/me nao pode expor pin/senha');

    const anonimo = novoCliente(app.base, 'anonimo');
    const semCookie = await anonimo.get('/api/me');
    assert.equal(semCookie.status, 401, 'sem cookie /api/me deve ser 401');
    assert.equal(semCookie.corpo && semCookie.corpo.erro, 'nao_autenticado');
  });

  it('GET /api/sessao e o bootstrap publico: 200 com null para visitante e usuario logado', async () => {
    const anonimo = novoCliente(app.base, 'sessao-anonima');
    const visitante = await anonimo.get('/api/sessao');
    assert.equal(visitante.status, 200, 'bootstrap de sessao nunca deve retornar 401');
    assert.equal(visitante.corpo.usuario, null);
    assert.equal(contemCampoSensivel(visitante.corpo), false);

    const { cli, usuario } = await entrar(app.base, 'cliente3');
    const logado = await cli.get('/api/sessao');
    assert.equal(logado.status, 200);
    assert.equal(logado.corpo.usuario.id, usuario.id);
    assert.equal(logado.corpo.usuario.papel, 'cliente');
  });

  it('logout invalida a sessao no servidor (cookie antigo deixa de valer)', async () => {
    const { cli } = await entrar(app.base, 'cliente2');
    const cabecalhoAntigo = cli.cabecalhoCookies();
    assert.ok(cabecalhoAntigo.includes('bp_sess='), 'deveria haver cookie de sessao');

    const logout = await cli.post('/api/logout', {});
    assert.equal(logout.status, 204, `logout deveria ser 204, veio ${logout.status}`);

    // Reutiliza explicitamente o token antigo para provar invalidacao no banco.
    const comCookieAntigo = novoCliente(app.base, 'cookie-antigo');
    comCookieAntigo.aplicarCabecalhoCookies(cabecalhoAntigo);
    const me = await comCookieAntigo.get('/api/me');
    assert.equal(me.status, 401, 'token apos logout deve ser 401');
    assert.equal(me.corpo && me.corpo.erro, 'nao_autenticado');
  });

  it('cadastro novo retorna 201 com cookie; mesmo telefone+PIN retorna 200 idempotente; PIN divergente retorna 409', async () => {
    const telefone = telefoneUnico();
    const dados = { nome: 'Bruna', sobrenome: 'Pereira', telefone, pin: '4321' };

    const criado = await cadastrarCliente(app.base, dados);
    assert.equal(criado.resposta.status, 201);
    assert.ok(criado.usuario && criado.usuario.id, 'cadastro 201 deve devolver usuario.id');
    assert.equal(criado.usuario.papel, 'cliente');
    assert.equal((criado.resposta.setCookies || []).length > 0, true, 'cadastro deve definir cookie de sessao');
    const cookieCadastro = criado.resposta.setCookies[0];
    assert.match(cookieCadastro, /HttpOnly/i);
    assert.match(cookieCadastro, /SameSite=Lax/i);

    const me = await criado.cli.get('/api/me');
    assert.equal(me.status, 200, 'sessao do cadastro deve valer em /api/me');
    assert.equal(me.corpo.usuario.telefone, telefone, 'telefone normalizado deve ser devolvido');

    const repetido = await novoCliente(app.base, 'cadastro-repetido').post('/api/clientes', dados);
    assert.equal(repetido.status, 200, `cadastro idempotente deveria ser 200, veio ${repetido.status}`);
    assert.equal(repetido.corpo && repetido.corpo.jaExistia, true);
    assert.equal(repetido.corpo.usuario.id, criado.usuario.id, 'mesmo telefone+PIN deve devolver o mesmo usuario');

    const divergente = await novoCliente(app.base, 'cadastro-pin-errado').post('/api/clientes', {
      ...dados,
      pin: '9999',
    });
    assert.equal(divergente.status, 409, `PIN divergente deveria ser 409, veio ${divergente.status}`);
    assert.equal(divergente.corpo && divergente.corpo.erro, 'cadastro_nao_concluido');
    assert.ok(divergente.corpo && typeof divergente.corpo.mensagem === 'string', '409 deve ter mensagem humana');
  });

  it('validacoes de cadastro: telefone invalido e PIN curto retornam 422', async () => {
    const casos = [
      { nome: 'Telefone', sobrenome: 'Curto', telefone: '123', pin: '1234' },
      { nome: 'Pin', sobrenome: 'Curto', telefone: telefoneUnico(), pin: '12' },
      { nome: 'Pin', sobrenome: 'Longo', telefone: telefoneUnico(), pin: '1234567' },
      { nome: 'A', sobrenome: 'B', telefone: telefoneUnico(), pin: '1234' },
    ];

    for (const corpo of casos) {
      const cli = novoCliente(app.base, 'cadastro-invalido');
      const resposta = await cli.post('/api/clientes', corpo);
      assert.equal(
        resposta.status,
        422,
        `cadastro invalido ${JSON.stringify(corpo)} deveria ser 422, veio ${resposta.status}: ${textoDoCorpo(resposta)}`,
      );
      assert.equal(resposta.corpo && resposta.corpo.erro, 'validacao');
      assert.equal((resposta.setCookies || []).length, 0, 'cadastro invalido nao pode criar sessao');
    }
  });

  it('senha e PIN nunca aparecem nas respostas de login, cadastro e /api/me', async () => {
    const respostas = [];

    const admin = novoCliente(app.base, 'scan-admin');
    respostas.push(await admin.login('admin', 'admin123'));

    const sessaoCliente = await entrar(app.base, 'cliente1');
    respostas.push(sessaoCliente.resposta);

    const cadastro = await cadastrarCliente(app.base, { nome: 'Scan', sobrenome: 'Segredo', pin: '6789' });
    respostas.push(cadastro.resposta);
    respostas.push(await cadastro.cli.get('/api/me'));

    for (const resposta of respostas) {
      assert.equal(contemCampoSensivel(resposta.corpo), false, 'resposta nao pode conter chaves pin/senha/senha_hash');
      assert.doesNotMatch(resposta.texto, /senha_hash|senhaHash/i, 'resposta nao pode conter senha_hash');
      assert.doesNotMatch(resposta.texto, /"pin"\s*:/i, 'resposta nao pode conter campo pin');
    }

    const textoLoginAdmin = respostas[0].texto;
    assert.equal(textoLoginAdmin.includes('admin123'), false, 'resposta de login nao pode devolver a senha');
    const textoLoginCliente = respostas[1].texto;
    assert.equal(textoLoginCliente.includes('"1234"'), false, 'resposta de login nao pode devolver o PIN');
  });

  it('sem cookie: rotas protegidas respondem 401 nao_autenticado', async () => {
    const anonimo = novoCliente(app.base, 'sem-cookie');
    const rotas = ['/api/me', '/api/agendamentos', '/api/minha-agenda', '/api/admin/dashboard'];

    for (const rota of rotas) {
      const resposta = await anonimo.get(rota);
      assert.equal(resposta.status, 401, `${rota} sem cookie deveria ser 401, veio ${resposta.status}`);
      assert.equal(resposta.corpo && resposta.corpo.erro, 'nao_autenticado', `${rota} deve usar codigo nao_autenticado`);
    }

    const mutacao = await anonimo.post('/api/agendamentos', {
      servicoId: 1,
      barbeiroId: 1,
      data: '2030-01-02',
      hora: '10:00',
    });
    assert.equal(mutacao.status, 401, 'POST /api/agendamentos sem cookie deveria ser 401');
  });
});
