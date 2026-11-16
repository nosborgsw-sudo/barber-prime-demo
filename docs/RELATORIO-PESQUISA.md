# Relatório de pesquisa pública — Barber Prime

Data da pesquisa: 16/11/2026. Fontes consultadas por leitura direta (WebFetch) e busca
pública. Nenhum código foi copiado de terceiros; todos os arquivos deste projeto foram
escritos para esta entrega.

## 1. Repositórios analisados

| Repositório | Stack declarada | Licença observada | Aproveitamento |
|---|---|---|---|
| [BridgeLine-Services/Main-Barber-Template-](https://github.com/BridgeLine-Services/Main-Barber-Template-) | Next.js 16 (App Router), TypeScript, Tailwind, shadcn/ui, PostgreSQL + Prisma, NextAuth | **Proprietária** — "This software is PROPRIETARY. Copyright (c) 2026 BridgeLine Services. All rights reserved." | Nenhum código. Serviu apenas como referência de fluxo em 6 etapas e de checagem transacional de sobreposição. |
| [morgadothiago/barbershop-scheduling-app](https://github.com/morgadothiago/barbershop-scheduling-app) | NestJS, Prisma, PostgreSQL, JWT, React 19/Vite, React Native/Expo | **Nenhuma licença documentada** na página | Nenhum código. Referência de separação de papéis e motor de disponibilidade. |
| [77mdias/barbershop-next](https://github.com/77mdias/barbershop-next) | Next.js 15, TypeScript, Prisma, NextAuth | **Nenhuma licença visível** na página | Nenhum código. Referência de painéis por papel. |
| [calcom/cal.diy](https://github.com/calcom/cal.diy) | Plataforma de agendamento auto-hospedada (fork do Cal.com) | **MIT** — "Cal.diy is fully open source, licensed under the MIT License." | Nenhum código. Referência conceitual de regras de disponibilidade e auto-hospedagem. |
| [Documentação Node.js v24 — SQLite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) | API nativa `node:sqlite` | — | Base técnica da camada de banco (`DatabaseSync`, `prepare`, `run/get/all`, transações via `exec`, WAL). |

### Observações de licença

- BridgeLine: uso, redistribuição ou revenda exigem contrato assinado. **Não reutilizado.**
- morgadothiago e 77mdias: sem licença explícita, o padrão legal é "todos os direitos
  reservados". **Não reutilizados.**
- cal.diy: MIT permitiria reutilização com preservação de copyright, mas o projeto é uma
  plataforma completa e pesada para o escopo. **Não reutilizado**; apenas conceitos
  (regras de disponibilidade, buffers, fuso, auto-hospedagem) inspiraram o desenho.

## 2. O que foi aproveitado como referência (sem código)

- Fluxo de agendamento em etapas: serviço → profissional → data → horário → confirmação.
- Disponibilidade calculada a partir de jornada semanal, intervalos, bloqueios e reservas.
- Checagem de sobreposição dentro de transação no momento da confirmação — requisito
  central para impedir reserva dupla sob concorrência.
- Separação de papéis (cliente, barbeiro, administrador) com painéis distintos.
- Auto-hospedagem e controle dos dados (LGPD) como critério de arquitetura.

## 3. Decisões técnicas e justificativa

| Decisão | Motivo |
|---|---|
| Node.js 24 + `node:http` + `node:sqlite`, zero dependências | Executa sem `npm install` e sem rede; reduz superfície de supply chain; `node:sqlite` oferece transações reais e FKs. |
| SQLite em vez de PostgreSQL nesta entrega | Instância única, operação simples e persistência em arquivo. PostgreSQL/Prisma ficam como evolução para escala horizontal (documentado em `IMPLANTACAO.md`). |
| HTML/CSS/JS puros no frontend | Sem build, sem CDN, carregamento rápido e compatível com o HTML autônomo offline. |
| Motor de disponibilidade próprio | Regras explícitas de jornada, intervalo, feriados, bloqueios, duração e antecedência, testáveis de ponta a ponta. |
| Sessão no servidor com cookie `HttpOnly` | Permite revogação e sobrevive a reinício; não usa `localStorage` como banco principal. |

## 4. Fontes que não foram consultadas nesta execução

Os repositórios `haivlee/barber-book`, `clawnify/OpenSalon`, `Ekwugha/barberShop`,
`henry-hai/barber-booking` e `EliNaduyev/Barbershop` não foram abertos nesta sessão, nem
as plataformas Booksy, Fresha e Square Appointments. Não há, portanto, avaliação de
licença ou de recursos desses projetos neste relatório. A pesquisa foi limitada por
tempo e pela prioridade de entregar e validar o sistema funcional.

## 5. Referências bibliográficas consultadas

- https://github.com/BridgeLine-Services/Main-Barber-Template-
- https://github.com/morgadothiago/barbershop-scheduling-app
- https://github.com/77mdias/barbershop-next
- https://github.com/calcom/cal.diy
- https://nodejs.org/docs/latest-v24.x/api/sqlite.html
