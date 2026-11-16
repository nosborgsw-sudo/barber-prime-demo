# Barber Prime

Sistema de agendamento para uma barbearia com quatro barbeiros, com área do cliente,
painel individual dos profissionais e painel administrativo. Interface premium em
preto/grafite/dourado, mobile-first, em português do Brasil.

- **Aplicação servida:** `public/` (HTML + CSS + JS puros) consumindo a API REST.
- **Backend:** Node.js 24, sem dependências externas, banco SQLite (`node:sqlite`) com
  transações, sessões no servidor e motor de disponibilidade.
- **Demonstração offline:** `app-autonomo.html`, arquivo único com CSS/JS embutidos e
  dados em `localStorage`; abre com duplo clique, sem servidor e sem internet.

## Requisitos

- Node.js **24** (testado em 24.21.0). `node:sqlite` é nativo a partir do Node 22.5.
- Nenhum `npm install` é necessário: o projeto não tem dependências de terceiros.

## Executar

```bash
npm start
# padrão: http://localhost:3000
# nesta máquina a porta 3000 é usada pelo painel do IA; use:
PORT=3400 npm start
```

Variáveis (todas opcionais, veja `.env.example`): `PORT`, `DB_PATH`, `ADMIN_SENHA`,
`BARBEIRO_SENHA`. O banco é criado e semeado automaticamente na primeira subida em
`data/barberprime.db`.

## Demonstração pública

- **Abrir:** https://nosborgsw-sudo.github.io/barber-prime-demo/
- **Código:** https://github.com/nosborgsw-sudo/barber-prime-demo
- **O que é:** o `index.html` publicado no GitHub Pages é gerado a partir de
  `app-autonomo.html` (`npm run build:pages`). Roda 100% no navegador, sem servidor, com
  dados fictícios em `localStorage` — cada visitante tem sua própria base e pode testar os
  três perfis (cliente, barbeiro e admin).
- **Limite:** o GitHub Pages só entrega arquivos estáticos. A API Node/SQLite **não** roda
  lá; para testar o backend real é preciso hospedar em um provedor com Node 24 e disco
  persistente (passo a passo na seção 8 de `docs/IMPLANTACAO.md`).
- **Republicar:** `npm run build:pages`, commite `index.html` e envie para `main`; o Pages
  reconstrói sozinho. O teste `tests/pages.test.js` falha se `index.html` divergir da demo.

## Contas de demonstração

| Perfil | Acesso | Senha |
|---|---|---|
| Administrador | `admin` | `admin123` |
| Barbeiros | `barbeiro1` … `barbeiro4` | `barbeiro123` |
| Clientes | telefone `11987650001` … `11987650004` | PIN `1234` |

São contas fictícias de demonstração. O administrador pode redefinir todos os dados com
**Restaurar demonstração** no painel (`POST /api/admin/reset-demo`).

## Testes

```bash
npm test                 # 49 testes (node:test) — auth, disponibilidade, agendamento,
                         # segurança, concorrência (100 reservas), persistência e Pages
node tests/smoke.js      # sobe o processo real, reserva, reinicia e prova persistência
```

Resultado das rodadas finais: **49/49 aprovados** e `SMOKE OK` — localmente e no CI do
GitHub Actions (`.github/workflows/ci.yml`). A rodada anterior também tinha 10/10 passos
HTTP e 25/25 verificações em navegador real (Chrome headless, 375 px e 1280 px, incluindo
zero erros de console na abertura). Evidências em `.homologacao/evidencias/`.

## Estrutura

```
server.js              HTTP, estáticos, sessão, rate limit, roteamento
src/db.js              migrações e esquema SQLite
src/seed.js            dados determinísticos de demonstração
src/auth.js            scrypt, sessões, cookies, comparação em tempo constante
src/availability.js    motor de horários disponíveis
src/api.js             regras de negócio e endpoints REST
public/                interface servida (index.html, styles.css, app.js)
app-autonomo.html      demonstração offline em arquivo único
tests/                 suíte node:test + smoke
docs/                  contrato, manual, arquitetura, segurança, validação
.homologacao/          fluxos executáveis e evidências
```

## Escopo entregue

- **Operacional local:** agendamento real com persistência, concorrência protegida por
  transação, três perfis de acesso, painéis completos, testes automatizados.
- **Integrações externas:** OTP por SMS/WhatsApp está **simulado** (o acesso usa telefone
  + PIN). Depende de credencial de provedor (Meta/Twilio) para ser validado no provedor.
- **Publicação pública HTTPS:** **demonstração estática publicada** no GitHub Pages
  (link na seção *Demonstração pública*). O servidor Node/SQLite ainda exige hospedagem
  com processo Node e disco persistente; instruções reproduzíveis em `docs/IMPLANTACAO.md`.
- **PostgreSQL/Prisma:** não utilizados nesta entrega. O banco é SQLite com transações e
  integridade referencial, adequado a uma instância única; a migração para PostgreSQL é
  o próximo passo para escala horizontal (ver `docs/IMPLANTACAO.md`).

## Documentação

- `docs/CONTRATO-API.md` — contrato técnico (rotas, campos, regras, IDs de UI)
- `docs/MANUAL.md` — manual de utilização
- `docs/IMPLANTACAO.md` — implantação, backup e produção
- `docs/RELATORIO-PESQUISA.md` — pesquisa pública e licenças
- `docs/RELATORIO-SEGURANCA.md` — controles, testes e riscos residuais
- `docs/RELATORIO-VALIDACAO.md` — duas rodadas de validação e matriz requisito/evidência
- `docs/INCIDENTES.md` — sintoma, causa, correção e teste de regressão de cada defeito
