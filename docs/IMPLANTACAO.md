# Implantação — Barber Prime

## 1. Requisitos

- Node.js 24 (ou >= 22.5, quando `node:sqlite` passou a existir).
- Sistema de arquivos persistente para o banco SQLite.
- Nenhuma dependência npm. Não é necessário `npm install`.

## 2. Execução local

```bash
# na raiz do projeto
PORT=3400 npm start
# produção local com banco dedicado:
PORT=3400 DB_PATH=/var/lib/barberprime/barberprime.db ADMIN_SENHA='<senha-forte>' npm start
```

Windows (PowerShell):

```powershell
$env:PORT="3400"; $env:DB_PATH="D:\dados\barberprime.db"; node server.js
```

O servidor cria a pasta do banco, aplica as migrações e semeia os dados de demonstração
somente se o banco estiver vazio. Verifique com `GET /api/health`.

## 3. Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `DB_PATH` | `data/barberprime.db` | Arquivo SQLite; `:memory:` para efêmero |
| `ADMIN_SENHA` | `admin123` | Senha do admin **na primeira semeadura** |
| `BARBEIRO_SENHA` | `barbeiro123` | Senha dos barbeiros **na primeira semeadura** |

Em produção, defina `ADMIN_SENHA` antes da primeira subida e troque as senhas do seed.
As variáveis de senha não alteram contas já criadas.

## 4. Produção de instância única (recomendado para esta versão)

1. Execute o Node atrás de um proxy reverso com TLS (nginx, Caddy ou similar).
2. Encaminhe `X-Forwarded-*` e mantenha o processo com usuário sem privilégios.
3. Persista o diretório do banco (volume/disco), com backup diário.
4. Mantenha apenas **uma** instância escrevendo no mesmo SQLite (WAL). Para várias
   instâncias, migre para PostgreSQL antes de escalar.
5. Restrinja a rede: só o proxy acessa a porta do Node.
6. Configure limite de requisições no proxy como segunda camada (o app já limita login,
   cadastro e mutações por IP).
7. Faça backup consistente com o processo parado ou usando a API de backup do SQLite:
   `sqlite3 barberprime.db ".backup backup.db"`.

## 5. Reverter a demonstração e re-semear

- `POST /api/admin/reset-demo` (somente admin) limpa agendamentos, bloqueios, feriados,
  clientes e contas criadas, recria o seed fictício e preserva a sessão do admin.
- O endpoint exige autenticação de administrador e confirmação na interface.

## 6. Testes e CI

```bash
npm test                 # 47 testes, node:test
node tests/smoke.js      # processo real + reinício + persistência
```

Sugestão de pipeline: `node --version` (>=22.5) → `npm test` → `node tests/smoke.js` →
publicar artefato de evidências. Não há etapa de build.

## 7. Checklist de segurança antes de expor

- [ ] `ADMIN_SENHA` forte definida antes do primeiro start; senhas do seed trocadas.
- [ ] HTTPS terminando no proxy; HSTS habilitado.
- [ ] Banco fora do diretório público, permissões restritas.
- [ ] Backup testado e restore documentado.
- [ ] Logs sem telefone completo, PIN, senha ou token.
- [ ] Reset de demonstração desabilitado/removido em base com dados reais.

## 8. Publicação pública HTTPS

### 8.1 Demonstração estática (publicada)

- **URL:** https://nosborgsw-sudo.github.io/barber-prime-demo/
- **Repositório:** https://github.com/nosborgsw-sudo/barber-prime-demo
- **Origem:** `index.html` na raiz do repositório, gerado de `app-autonomo.html` por
  `npm run build:pages`. O GitHub Pages serve a branch `main` na raiz.
- **Escopo:** interface completa (cliente, barbeiro, admin) com dados fictícios em
  `localStorage`, sem backend. Cada visitante tem uma base isolada no próprio navegador.
- **Republicar:** `npm run build:pages` → commit de `index.html` → push em `main`. O teste
  `tests/pages.test.js` garante que a cópia publicada não divirja da demo autônoma.

### 8.2 Servidor Node/SQLite (ainda exige hospedagem)

O GitHub Pages não executa processos Node. Para expor a API real com persistência:

1. Provisionar um host com Node 24 e disco persistente (Render, Railway, VPS, etc.).
2. Definir `PORT`, `DB_PATH`, `ADMIN_SENHA` e `BARBEIRO_SENHA` no painel do provedor.
3. Subir o repositório e iniciar com `npm start`.
4. Configurar domínio e TLS no provedor/proxy.
5. Executar a verificação externa: abrir a URL em sessão limpa, criar reserva fictícia,
   reagendar, cancelar, recarregar e confirmar persistência, além de testar os acessos
   restritos de barbeiro e admin.

## 9. Migração futura para PostgreSQL

O esquema usa tipos simples (texto para datas/horas locais, inteiros para preços) e
transações `BEGIN IMMEDIATE`. Para PostgreSQL:

1. Recriar as tabelas com migrações versionadas e tipos `date/time/numeric`.
2. Trocar a camada de acesso (`src/db.js`) por um cliente com pool.
3. Substituir a serialização do SQLite por `SERIALIZABLE`/`SELECT ... FOR UPDATE` na
   verificação de sobreposição, mantendo a revalidação dentro da transação.
4. Reexecutar `npm test`, com atenção ao teste de 100 reservas simultâneas.
