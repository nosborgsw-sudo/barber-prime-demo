# Relatório de segurança — Barber Prime

Data: 16/11/2026. Escopo: aplicação local (`server.js`, `src/`, `public/`) e banco SQLite.

## 1. Controles implementados

### Autenticação e sessão
- Senhas e PINs com `scrypt` e salt individual; verificação com `timingSafeEqual`
  (`src/auth.js`).
- Sessões no servidor: token aleatório de 32 bytes; o banco guarda apenas o SHA-256.
- Cookie `bp_sess` com `HttpOnly`, `SameSite=Lax`, `Path=/`, validade de 7 dias; logout
  apaga a sessão no banco.
- Login genérico ("Login ou senha inválidos") para usuário inexistente e senha errada,
  com comparação fictícia para reduzir diferença de tempo.
- Clientes entram por telefone + PIN; não há consulta de reservas apenas pelo número.

### Autorização
- Papéis `cliente`, `barbeiro`, `admin` verificados em cada rota.
- Cliente acessa apenas os próprios agendamentos; barbeiro apenas a própria agenda e
  bloqueios; administrador acessa tudo. Tentativas cruzadas retornam 403.
- Rotas `/api/admin/*` e `/api/auditoria` exigem admin.

### Entrada e saída
- SQL sempre parametrizado; nenhuma concatenação de entrada em consultas.
- Limite de corpo de 100 KB; JSON inválido → 400; mutações exigem
  `Content-Type: application/json`; `Origin`/`Referer` divergente → 403.
- Rate limit em memória por IP: login 10/5 min, cadastro 5/min, mutações 60/min
  (contando apenas escritas bem-sucedidas para não bloquear a revalidação de conflitos).
- Frontend constrói DOM com `textContent`; nenhum dado da API é inserido via `innerHTML`.
- Cabeçalhos de segurança em todas as respostas: `Content-Security-Policy`
  (`default-src 'self'`, `frame-ancestors 'none'`), `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy` restritiva.
- Erros internos retornam mensagem genérica, sem stack trace.
- Auditoria de ações administrativas sem telefone completo, senha, PIN ou token.

### Concorrência e integridade
- Criação, reagendamento e bloqueio rodam em `BEGIN IMMEDIATE` com revalidação da
  disponibilidade dentro da transação.
- FKs habilitadas, índices em barbeiro/data, cliente, sessões e bloqueios.
- Teste de 100 reservas simultâneas: exatamente 1 `201` e 99 `409`; uma única linha
  ativa no banco. Também testado com dois processos no mesmo arquivo.

### LGPD e minimização
- Cadastro solicita apenas nome, sobrenome, telefone e PIN.
- Não há e-mail, CPF, endereço ou geolocalização.
- Telefones não aparecem em logs; auditoria usa identificadores.
- Exclusão/anonimização: o reset de demonstração apaga os dados; para produção, a rotina
  deve ser estendida com anonimização por cliente (pendência documentada).

## 2. Evidências de teste

| Verificação | Resultado |
|---|---|
| Matriz de papéis em rotas admin (anônimo 401, cliente/barbeiro 403) | aprovado |
| SQL injection em login e parâmetros | não autentica, não quebra, não vaza |
| Payload XSS devolvido como string JSON | aprovado |
| Cliente alterando agendamento de outro | 403 |
| Enumeração de login (inexistente vs senha errada) | mesma resposta |
| Rate limit de login na 11ª tentativa | 429 |
| Content-Type inválido / corpo de 110 KB | 415/413, servidor permanece no ar |
| Nenhuma resposta com `senha_hash`, `pin` ou senha do admin | aprovado |
| Cabeçalhos CSP/X-Frame/nosniff/Referrer-Policy | aprovado |
| 100 reservas simultâneas no mesmo slot | 1 confirmada, 99 conflitos |
| Reinício do processo com o mesmo banco | sessão e dados preservados |

Arquivos: `tests/security.test.js`, `tests/concurrency.test.js`,
`tests/persistence.test.js`, `.homologacao/evidencias/round1-testes.txt` e
`.homologacao/evidencias/round2-testes.txt`.

## 3. Defeitos encontrados e corrigidos durante a validação

1. **Login de cliente demo retornava 401.** O seed gravava clientes com `login` nulo e a
   busca usava apenas a coluna `login`. Corrigido para aceitar telefone de cliente como
   identificador, mantendo o PIN como segredo. Regressão coberta em `tests/auth.test.js`.
2. **Rate limit de mutação bloqueava o cenário de 100 reservas simultâneas**
   (retornava 429 em vez de 409). A cota passou a contar somente escritas bem-sucedidas,
   permitindo que todas as tentativas cheguem à revalidação transacional. Coberto por
   `tests/concurrency.test.js`.
3. **Script de testes incompatível com Node 24 no Windows** (`node --test tests/`).
   Ajustado para `node --test "tests/*.test.js"`.
4. **Rótulos de status renderizados em minúsculas na interface servida** e com
   `text-transform` divergente entre DOM e texto visível. Padronizado para
   `Agendado/Cancelado/Concluído/Faltou`.

## 4. Riscos residuais

| Risco | Nível | Situação / mitigação |
|---|---|---|
| PIN de 4–6 dígitos é curto | Médio | Rate limit de login e PIN tratado como segredo; OTP não configurado. Recomenda-se OTP por SMS/WhatsApp em produção. |
| Credenciais de demonstração públicas | Médio | Aceitável apenas em ambiente de demonstração; trocar antes de dados reais (`ADMIN_SENHA`, `BARBEIRO_SENHA`). |
| Rate limit em memória por processo | Baixo | Reinício zera a cota; usar Redis/proxy em produção multi-instância. |
| Sem TLS na aplicação | Médio | Terminar TLS no proxy reverso; nunca expor o Node direto. |
| Enumeração de telefone no cadastro | Baixo | Mensagem genérica no PIN divergente e rate limit de 5/min; ainda é possível inferir existência. |
| SQLite em instância única | Baixo | Adequado ao escopo; migrar para PostgreSQL para múltiplas instâncias. |
| Reset de demonstração apaga dados | Médio | Exige admin + confirmação; remover/desabilitar em base real. |
| Sem OTP / 2FA para equipe | Médio | Senhas de equipe com scrypt; recomendação de 2FA futura. |
| Sem expurgo automático de dados | Médio (LGPD) | Rotina de anonimização é pendência para produção. |
| Sem teste de carga com 500/1.000 clientes | Baixo | Testado até 100 reservas simultâneas; capacidade maior não foi medida. |

## 5. Recomendações antes de produção

1. Definir senhas fortes no primeiro start e remover as contas demo.
2. TLS no proxy, HSTS, limite de requisições em duas camadas.
3. Integrar OTP real e, para a equipe, segundo fator.
4. Backup automático e teste de restauração do banco.
5. Política de privacidade e rotina de anonimização/expurgo (LGPD).
6. Revisão de dependências: hoje não há dependências npm, o que elimina essa classe de
   risco.
