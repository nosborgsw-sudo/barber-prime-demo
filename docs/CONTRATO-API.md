# Contrato técnico — Barber Prime (fonte única da verdade)

Este arquivo é o contrato entre as frentes (backend, frontend, app autônomo, testes).
Não altere nomes de rota, campos ou IDs de UI sem atualizar este documento.

## Stack e restrições

- Node.js 24 (já instalado). **Zero dependências externas** (sem `npm install`).
- Servidor HTTP com `node:http`, banco com `node:sqlite` (`DatabaseSync`), hash com `node:crypto`.
- `npm start` → `node server.js`. Porta `process.env.PORT || 3000`.
- Banco: `process.env.DB_PATH || data/barberprime.db`. `DB_PATH=:memory:` deve funcionar (testes).
- `server.js` exporta `{ createApp, start }`; só sobe sozinho quando `require.main === module`.
  - `createApp({ dbPath })` → `{ server, db, close }` (não escuta ainda).
  - `start({ port, dbPath })` → `Promise<{ server, port, db, close }>` (escuta e resolve com a porta real,
    útil com `port: 0`).
  - `close()` fecha servidor + banco e é idempotente.
- Fuso fixo da barbearia: `America/Sao_Paulo` (UTC-3, sem horário de verão). Datas/horas
  são strings locais `'YYYY-MM-DD'` e `'HH:MM'`; nunca converta para UTC no banco.
- Nada de rota, sessão, senha fixa ou modo especial "de teste". Só dados de demonstração
  (seed) e o endpoint de reset protegido por admin.

## Papéis e seed (determinístico)

| Papel | login | senha |
|---|---|---|
| admin | `admin` | `admin123` (env `ADMIN_SENHA` sobrescreve) |
| barbeiro 1..4 | `barbeiro1` … `barbeiro4` | `barbeiro123` (env `BARBEIRO_SENHA`) |
| cliente demo | telefone `11987650001`…`11987650004` | PIN `1234` |

Clientes demo: (1) Ana Souza, (2) Carlos Lima, (3) Marina Alves, (4) Pedro Santos.
Ids após o seed (ordem de inserção): admin = 1, barbeiros = 2..5, clientes demo = 6..9.
Agendamentos semeados = 1..2; o primeiro agendamento criado depois do seed recebe id 3.

Barbeiros (ids 1..4): Rafael Costa (@rafael), Diego Martins (@diego), Lucas Almeida
(@lucas), Bruno Silva (@bruno). `nome` é o nome profissional (exibido), `apelido` opcional.

Serviços (ids 1..5): (1) Corte R$ 50,00 / 45 min; (2) Barba R$ 35,00 / 30 min;
(3) Corte + Barba R$ 80,00 / 60 min; (4) Sobrancelha R$ 20,00 / 15 min;
(5) Pigmentação R$ 45,00 / 30 min.

Horário da loja: seg–sáb 09:00–19:00, domingo fechado. Jornada de cada barbeiro:
seg–sáb 09:00–18:00 com intervalo 12:00–13:00. Grade de horários: 15 min.
Antecedência mínima: 30 min. Antecedência máxima: 365 dias.

Seed de agendamentos: nenhum no passado; no próximo dia útil, barbeiro 1 às 10:00
(Corte, cliente 1) e às 11:00 (Corte + Barba, cliente 2), status `agendado`.
O reset (`POST /api/admin/reset-demo`) limpa e re-semeia com ids determinísticos
(1..N na ordem de inserção), inclusive `sqlite_sequence`.

## Autenticação

- `POST /api/login` `{login, senha}` → `200 {"usuario":{...}}` + `Set-Cookie: bp_sess=<token>; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`.
  `401 {"erro":"credenciais_invalidas","mensagem":"..."}`. Rate limit: 10 tentativas/5 min por IP → `429`.
- `GET /api/me` → `200 {"usuario":{id,papel,nome,sobrenome,telefone,login}}` ou `401`.
- `GET /api/sessao` → **sempre 200**: `{"usuario":{...}}` quando autenticado ou
  `{"usuario":null}` para visitante. É o bootstrap da tela inicial; evita um 401
  esperado na abertura (que aparecia como erro de console no navegador).
- `POST /api/logout` → `204` (invalida a sessão no banco).
- Sessões ficam na tabela `sessoes` (token guardado como SHA-256); sobrevivem a reinício do processo.
- Cookie é `HttpOnly`; toda mutação exige `Content-Type: application/json` e, se houver
  header `Origin`/`Referer`, host igual ao do servidor (proteção CSRF básica).

`usuario.papel` ∈ `cliente|barbeiro|admin`. Para barbeiro, a resposta inclui `barbeiroId`.

## Erros

Formato `{"erro":"codigo_estavel","mensagem":"texto humano"}`.
Códigos usados: `nao_autenticado` (401), `sem_permissao` (403), `nao_encontrado` (404),
`validacao` (422), `horario_indisponivel` (409), `estado_invalido` (409),
`credenciais_invalidas` (401), `limite_excedido` (429), `erro_interno` (500).

## Endpoints públicos (cliente)

- `GET /api/barbeiros` → `{barbeiros:[{id,nome,apelido,especialidades:[string],bio,fotoUrl,ativo}]}`
- `GET /api/servicos` → `{servicos:[{id,nome,descricao,precoCentavos,duracaoMin,ativo}]}`
- `GET /api/configuracoes` → `{nomeBarbearia,endereco,telefoneContato,horarioFuncionamento,antecedenciaMinMin,antecedenciaMaxDias,fuso,feriados:[{data,descricao}]}`
- `POST /api/clientes` `{nome,sobrenome,telefone,pin}`
  - telefone normalizado para 10–11 dígitos; `pin` 4–6 dígitos; nome/sobrenome 2–60 chars.
  - novo telefone → `201 {usuario}` + cookie de sessão.
  - telefone existente + PIN correto → `200 {usuario, jaExistia:true}` + cookie (idempotente).
  - telefone existente + PIN diferente → `409 {"erro":"cadastro_nao_concluido","mensagem":"Não foi possível concluir o cadastro com esses dados. Se você já tem conta, entre com seu PIN."}`
  - validação → `422`.
- `GET /api/disponibilidade?servicoId=1&data=YYYY-MM-DD[&barbeiroId=2]`
  → `{data, servicoId, duracaoMin, opcoes:[{barbeiroId,barbeiroNome,horarios:["09:00",...]}]}`
  `barbeiroId` ausente = todos os barbeiros ativos (cada um com sua lista).
  422 para data inválida/passada/além da antecedência; 404 serviço inexistente.
- `GET /api/disponibilidade/resumo?servicoId=1&de=YYYY-MM-DD&ate=YYYY-MM-DD`
  → `{dias:[{data,disponivel:boolean,vagas:number}]}` (até 62 dias).
- `POST /api/agendamentos` `{servicoId,barbeiroId|null,data,hora,clienteId?}`
  - cliente: `clienteId` ignorado (usa o próprio). admin: `clienteId` obrigatório.
  - `barbeiroId:null` = "qualquer barbeiro": escolhe o primeiro com o horário livre.
  - `201 {agendamento}`; `409 horario_indisponivel`; `422 validacao` (passado, fora da grade,
    antecedência); `401`.
- `GET /api/agendamentos?escopo=proximos|historico|todos&data=&barbeiroId=&clienteId=`
  → `{agendamentos:[...]}` ordenado por `inicio`. Cliente vê só os seus (403 com filtro alheio).
  Barbeiro vê só os seus. Admin vê tudo.
- `PATCH /api/agendamentos/:id/reagendar` `{data,hora,barbeiroId?}` → `200 {agendamento}`.
  Só cancela o horário antigo depois de gravar o novo, na **mesma transação**. `409` mantém o antigo.
- `PATCH /api/agendamentos/:id/cancelar` → `200 {agendamento}` (status `cancelado`).
  Não cancela `concluido`/`faltou` (`409 estado_invalido`).
- `PATCH /api/clientes/me` `{nome?,sobrenome?,pinAtual,pinNovo?}` → `200 {usuario}`.

Objeto `agendamento`:
`{id,status,inicio,fim,data,hora,duracaoMin,servico:{id,nome,precoCentavos,duracaoMin},
barbeiro:{id,nome},cliente:{id,nome,sobrenome,telefone},criadoEm,atualizadoEm}`
`status` ∈ `agendado|concluido|cancelado|faltou`. `inicio` = `"YYYY-MM-DD HH:MM"`.

## Barbeiro

- `GET /api/minha-agenda?de=YYYY-MM-DD&ate=YYYY-MM-DD&data=YYYY-MM-DD`
  → `{barbeiro:{id,nome}, agendamentos:[...], bloqueios:[...]}` (só os próprios).
- `POST /api/bloqueios` `{data,horaInicio,horaFim,motivo,barbeiroId?}`
  barbeiro: força o próprio id; admin: qualquer barbeiro ou `barbeiroId:null` = loja inteira.
  `201 {bloqueio}`; conflito com agendamento → `409 estado_invalido` (não apaga reserva).
- `GET /api/bloqueios?de=&ate=&barbeiroId=` → `{bloqueios:[{id,barbeiroId,data,horaInicio,horaFim,motivo}]}`
- `DELETE /api/bloqueios/:id` → `204` (barbeiro dono ou admin).
- `PATCH /api/agendamentos/:id/status` `{status:"concluido"|"faltou"|"agendado"}`
  → barbeiro dono do agendamento ou admin; `200 {agendamento}`.

## Admin (todos exigem papel `admin`, senão 403)

- `GET /api/admin/dashboard?data=YYYY-MM-DD&de=&ate=&barbeiroId=`
  → `{data, kpis:{agendamentosDia,concluidos,cancelados,faltas,clientesTotal,receitaEstimadaCentavos,ocupacaoPct}, porBarbeiro:[{barbeiroId,nome,agendamentos,concluidos,receitaCentavos,ocupacaoPct}], servicosMaisSolicitados:[{servicoId,nome,quantidade}]}`
- `POST /api/admin/barbeiros` `{nome,sobrenome,login,senha,apelido,especialidades,bio,fotoUrl}` → 201
- `PUT /api/admin/barbeiros/:id` (mesmos campos; `ativo` booleano) → 200
- `POST /api/admin/servicos` / `PUT /api/admin/servicos/:id` `{nome,descricao,precoCentavos,duracaoMin,ativo}` → 201/200
- `GET /api/admin/clientes` → `{clientes:[{id,nome,sobrenome,telefone,criadoEm,agendamentos}]}`
- `PATCH /api/admin/clientes/:id/pin` `{pin}` → 200 (recuperação de acesso assistida, auditada)
- `PUT /api/admin/barbeiros/:id/jornadas` `{jornadas:[{diaSemana:0-6,ativo,inicio,fim,intervaloInicio,intervaloFim}]}` → 200
- `GET /api/admin/config` / `PUT /api/admin/config` (campos de `/api/configuracoes`) → 200
- `POST /api/admin/feriados` `{data,descricao}` → 201; `DELETE /api/admin/feriados/:data` → 204
- `POST /api/admin/reset-demo` → `200 {ok:true, reiniciado:true}` (limpa e re-semeia; só admin)
- `GET /api/auditoria?limite=50` → `{eventos:[{id,usuario,acao,detalhe,em}]}` (sem dados sensíveis)

## Regras do motor de disponibilidade

1. Domingo e feriados fechados; fora do horário da loja não há vaga.
2. Jornada do barbeiro por dia da semana (`jornadas`), subtraindo o intervalo.
3. Subtrai agendamentos ativos (`agendado`) cujo intervalo se sobreponha ao slot.
   `cancelado` e `faltou` liberam o horário; `concluido` só existe no passado.
4. Subtrai bloqueios do barbeiro e da loja (`barbeiroId:null`).
5. Slot só existe se couber inteiro (`hora + duracao`) dentro da jornada e antes do fechamento.
6. Descarta slot com início < agora + antecedência mínima; data além do máximo é 422.
7. Grade de 15 min, mas o passo pode ser reduzido quando o serviço exige.
8. **Concorrência**: toda escrita de agendamento/reagendamento roda em
   `BEGIN IMMEDIATE ... COMMIT` com revalidação dentro da transação. 100 POSTs no mesmo
   slot → exatamente 1 `201` e 99 `409`. Nunca dois ativos no mesmo barbeiro/horário.

## Banco (SQLite, migração versionada em `src/db.js`)

Tabelas: `usuarios` (login UNIQUE, telefone UNIQUE), `barbeiros`, `servicos`, `jornadas`,
`bloqueios`, `agendamentos`, `historico_agendamentos`, `configuracoes`, `feriados`,
`auditoria`, `sessoes`, `schema_migracoes`. FKs ligadas, índices em
`agendamentos(barbeiro_id, inicio)`, `agendamentos(cliente_id)`, `sessoes(token_hash)`,
`bloqueios(data)`. `PRAGMA journal_mode=WAL` (arquivo) e `foreign_keys=ON`.
Senhas/PIN com `scrypt` + salt individual; comparação com `timingSafeEqual`.
Nunca registre telefone completo, senha ou token em logs/auditoria.

## Contrato de UI (mesmos IDs no app servido e no autônomo)

Navegação (sempre visível): `#nav-inicio`, `#nav-agendar`, `#nav-meus`, `#nav-entrar`,
`#nav-barbeiro`, `#nav-admin`; hero `#btn-agendar`; `#usuario-atual`, `#btn-sair`;
`#titulo-pagina` (h1 da view atual).

Cadastro/login cliente:
`#cadastro-nome`, `#cadastro-sobrenome`, `#cadastro-telefone`, `#cadastro-pin`,
`#btn-cadastrar`, `#cadastro-erro`.
`#login-telefone`, `#login-pin`, `#btn-entrar-cliente`, `#login-erro`.
Equipe: `#login-staff-login`, `#login-staff-senha`, `#btn-entrar-staff`, `#login-staff-erro`.

Agendamento:
`#lista-servicos` com botões `#servico-1` … `#servico-5`; `#resumo-servico`.
`#lista-barbeiros` com botões `#barbeiro-1` … `#barbeiro-4` e `#barbeiro-qualquer`;
`#resumo-barbeiro`.
`#calendario` (dias), `#data-selecionada` (texto), `#btn-proxima-data`
(seleciona a próxima data com vaga), `#horarios` com botões `.slot` e `#btn-proximo-horario`
(seleciona o primeiro horário livre), `#resumo-horario`.
`#btn-confirmar`, `#confirmacao` (contém "Agendamento confirmado"), `#erro-booking`.

Meus agendamentos:
`#filtro-proximos`, `#filtro-historico`, `#meus-agendamentos`.
Cada card: `id="agendamento-<n>"` (n = 1..N na ordem exibida), `.status` (texto do status),
`#btn-reagendar-<n>`, `#btn-cancelar-<n>`. Filtro de reagendamento:
`#reagendar-data`, `#reagendar-hora`, `#btn-salvar-reagendamento`, `#reagendar-erro`.

Painel barbeiro:
`#painel-barbeiro`, `#agenda-hoje`, `#agenda-semana`, `#btn-bloquear`,
`#bloqueio-data`, `#bloqueio-inicio`, `#bloqueio-fim`, `#bloqueio-motivo`,
`#btn-salvar-bloqueio`, `#lista-bloqueios`, e em cada linha de agendamento
`#btn-concluir-<n>` / `#btn-faltou-<n>`.

Painel admin:
`#painel-admin`, `#kpi-dia`, `#kpi-concluidos`, `#kpi-cancelados`, `#kpi-clientes`,
`#kpi-receita`, `#admin-agendas` (4 colunas, uma por barbeiro), `#admin-barbeiros`,
`#admin-servicos`, `#admin-clientes`, `#btn-novo-agendamento`, `#manual-cliente`,
`#manual-servico`, `#manual-barbeiro`, `#manual-data`, `#manual-hora`,
`#btn-manual-salvar`, `#btn-reset-demo`, `#admin-feriados`.

App autônomo (`app-autonomo.html`): banner fixo `#banner-demo` com o texto
**DEMONSTRAÇÃO**, botões `#btn-demo-cliente`, `#btn-demo-barbeiro`, `#btn-demo-admin`
(entram nas contas fictícias). Todos os demais IDs acima devem existir e funcionar com
dados em `localStorage` (chave `barberprime.demo.v1`). Sem `fetch`, sem módulos, sem
recursos externos; abre por duplo clique, inclusive em `file://`.

## Arquivos e donos (não sobrepor)

| Dono | Arquivos |
|---|---|
| backend | `server.js`, `src/db.js`, `src/auth.js`, `src/availability.js`, `src/api.js`, `src/seed.js`, `src/util.js`, `.env.example` |
| frontend | `public/index.html`, `public/styles.css`, `public/app.js`, `public/favicon.svg` |
| autônomo | `app-autonomo.html` |
| qa | `tests/*.test.js`, `tests/helpers.js`, `tests/smoke.js` |
| coordenação | `package.json`, `docs/**`, `.homologacao/**`, `README.md` |

## Verificação

- `npm test` → todos os testes passam.
- `node tests/smoke.js` → sobe o servidor, exercita login/criação/listagem e imprime `SMOKE OK`.
- Teste de concorrência obrigatório, com este nome exato:
  `concorrência: 100 reservas simultâneas resultam em exatamente 1 confirmada`
