# Registro de incidentes — Barber Prime

Formato: sintoma → causa verificada → camada → reprodução → correção → teste de regressão →
resultado do replay. Todos os incidentes abaixo são do produto (aplicativo), não da
plataforma do Studio. Nenhum patch foi aplicado na instalação do Studio.

## INC-001 — Login de cliente demo retornava 401

- **Sintoma:** `POST /api/login {"login":"11987650001","senha":"1234"}` → 401.
- **Causa:** o seed criava clientes com `login` nulo e a autenticação consultava apenas a
  coluna `login`.
- **Camada:** backend / autenticação.
- **Reprodução:** teste `login de cliente demo usa o telefone como login e o PIN como senha`.
- **Correção:** fallback por `telefone` quando o papel é `cliente`, mantendo o PIN como
  segredo e a mensagem genérica de erro.
- **Regressão:** `tests/auth.test.js`.
- **Replay:** teste aprovado; login de cliente por telefone + PIN → 200 com cookie.

## INC-002 — Rate limit impedia o cenário de 100 reservas simultâneas

- **Sintoma:** 100 `POST /api/agendamentos` no mesmo slot → `{"201":1,"409":59,"429":40}`.
- **Causa:** o limite de mutação contava tentativas, incluindo as que terminariam em 409.
- **Camada:** backend / proteção de abuso.
- **Reprodução:** `tests/concurrency.test.js`.
- **Correção:** a cota de mutação passou a contar apenas escritas bem-sucedidas; as
  tentativas concorrentes chegam à revalidação transacional.
- **Regressão:** teste `concorrência: 100 reservas simultâneas resultam em exatamente 1 confirmada`.
- **Replay:** `1×201`, `99×409`, uma única linha ativa no banco.

## INC-003 — `npm test` falhava no Node 24 / Windows

- **Sintoma:** `Cannot find module '...\tests'` ao rodar `node --test tests/`.
- **Causa:** o runner tratava o diretório como módulo, sem expansão de glob.
- **Camada:** ferramenta de teste / configuração.
- **Correção:** script `node --test "tests/*.test.js"`.
- **Replay:** 47 testes executados, 47 aprovados.

## INC-004 — Status divergia entre DOM e texto visível

- **Sintoma:** interface servida exibia `agendado` em minúsculas; o app autônomo aplicava
  `text-transform: uppercase`, fazendo `innerText` divergir do conteúdo do DOM.
- **Causa:** uso do status bruto na interface servida e transformação apenas visual no CSS.
- **Camada:** frontend / acessibilidade e automação.
- **Correção:** rótulos capitalizados via `statusLabel(status)` e remoção do
  `text-transform` em status e rótulos de KPI.
- **Regressão:** verificação de navegador F4/F5 (`Agendado`, `Cancelado`).
- **Replay:** 25/25 verificações de navegador aprovadas.

## INC-005 — Ausência de cabeçalhos de segurança

- **Sintoma:** respostas sem CSP, `X-Frame-Options` ou `Referrer-Policy`.
- **Causa:** nenhum cabeçalho global configurado.
- **Camada:** backend / HTTP.
- **Correção:** cabeçalhos globais no manipulador (CSP restritiva, `frame-ancestors 'none'`,
  `nosniff`, `no-referrer`, `Permissions-Policy`).
- **Regressão:** `respostas incluem cabecalhos de seguranca` em `tests/security.test.js`.
- **Replay:** teste aprovado; páginas e API continuam funcionando em navegador real.

## INC-006 — Abertura da tela gerava 401 esperado no console

- **Sintoma:** ao abrir `/`, o navegador registrava
  `Failed to load resource: 401 (Unauthorized) ... /api/me`; o executor reprovou o
  critério "abre sem erro de console".
- **Causa:** o bootstrap da interface chamava um endpoint autenticado para descobrir se
  havia sessão. Para visitante, o 401 era esperado, mas o navegador o registra como erro.
- **Camada:** frontend / bootstrap de sessão e contrato da API.
- **Reprodução:** abrir `/` em sessão anônima com o console aberto.
- **Correção:** novo `GET /api/sessao`, sempre `200`, devolvendo `{usuario}` ou
  `{usuario:null}`; a interface passou a usar esse endpoint. `GET /api/me` continua
  devolvendo 401 para anônimos, preservando o contrato e os testes.
- **Regressão:** teste `GET /api/sessao e o bootstrap publico` em `tests/auth.test.js` e
  verificação de navegador "sem erros de console na abertura" (app servido e autônomo).
- **Replay:** 47/47 testes, 25/25 verificações de navegador, pacote limpo OK.

## Incidentes de verificação (não são defeitos do produto)

- O harness usava `#btn-concluir-1`, mas o sufixo numérico depende da ordem das listas do
  dia/semana. O seletor do harness passou a buscar o primeiro botão `btn-concluir-*`.
- O harness preenchia campos de um formulário oculto (login da equipe dentro da view do
  barbeiro). O teste passou a exigir visibilidade real e o fluxo passou a usar o botão
  visível "Entrar como equipe" (`#btn-equipe`), adicionado à interface.
