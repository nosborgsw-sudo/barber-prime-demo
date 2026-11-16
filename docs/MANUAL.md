# Manual de utilização — Barber Prime

## 1. Cliente

### Criar acesso
1. Abra o aplicativo e toque em **Entrar**.
2. Em **Primeira visita**, informe nome, sobrenome, telefone com DDD e um PIN de 4 a 6
   dígitos. E-mail, CPF e endereço não são solicitados.
3. O telefone é validado no formato brasileiro e não pode ser cadastrado duas vezes.
   Se o telefone já existir com o mesmo PIN, o acesso é feito na hora (idempotente).
   Com PIN diferente, aparece uma mensagem genérica — nunca se confirma se o número
   pertence a outra pessoa.

### Agendar
1. Toque em **Agendar**.
2. Escolha o serviço (preço e duração aparecem no cartão).
3. Escolha um dos quatro barbeiros ou **Qualquer profissional**.
4. Escolha a data no calendário. Domingos, feriados e datas sem vaga ficam
   desabilitados. **Próxima data com vaga** seleciona automaticamente a data mais próxima.
5. Escolha um horário real. **Primeiro horário livre** seleciona a próxima vaga.
6. Toque em **Confirmar agendamento**. O servidor valida a disponibilidade novamente
   dentro de uma transação; se outra pessoa acabou de reservar, aparece o aviso de
   horário ocupado e a lista é atualizada.

### Meus agendamentos
- **Próximos** mostra reservas futuras com serviço, profissional, data, horário,
  duração, valor, código e status.
- **Histórico** mostra concluídos, cancelados e faltas.
- **Reagendar** permite escolher nova data e horário; o horário antigo só é liberado
  depois que o novo é gravado com sucesso.
- **Cancelar** pede confirmação e libera a vaga imediatamente.

### Recuperação de acesso
O PIN pode ser redefinido pelo administrador na área de clientes. A recuperação
automática por OTP (SMS/WhatsApp) depende de integração externa não configurada.

## 2. Barbeiro

1. Entre em **Equipe** com `barbeiro1` … `barbeiro4` e a senha `barbeiro123`.
2. O painel abre na própria agenda; cada profissional vê apenas os próprios dados.
3. **Hoje** e **Próximos 7 dias** alternam a visão. Cada linha mostra cliente, serviço,
   horário, duração e status.
4. **Concluir** registra o atendimento realizado; **Faltou** registra ausência. Ambos
   ficam no histórico.
5. **Bloquear horário** cria uma indisponibilidade pontual (data, início, fim, motivo).
   O bloqueio não apaga reservas existentes e evita novas reservas no intervalo.
   Bloqueios podem ser removidos na lista.
6. O barbeiro não acessa dados administrativos nem a agenda de outros profissionais.

## 3. Administrador

1. Entre em **Equipe** com `admin` / `admin123`. O painel administrativo abre.
2. **Indicadores do dia:** agendamentos, concluídos, cancelados, clientes e receita
   estimada. Os filtros de período/profissional usam o intervalo de datas.
3. **Agendas de hoje:** as quatro colunas, uma por barbeiro, com status de cada horário.
4. **Barbeiros:** editar nome profissional, especialidades, bio e situação.
5. **Serviços:** criar e editar nome, descrição, preço e duração.
6. **Clientes:** consultar cadastros e redefinir PIN de forma assistida (ação auditada).
7. **Novo agendamento:** criar reserva manual escolhendo cliente, serviço, barbeiro,
   data e horário. O mesmo motor de disponibilidade é aplicado.
8. **Feriados:** cadastrar e remover datas de fechamento.
9. **Restaurar demonstração:** apaga os dados operacionais e recria o seed fictício.
   Exige confirmação e é restrito ao administrador.

## 4. Demonstração offline (`app-autonomo.html`)

- Abra o arquivo com dois cliques (computador ou celular). Funciona sem servidor e sem
  internet; a faixa superior indica **DEMONSTRAÇÃO**.
- Os dados ficam no `localStorage` do navegador, na chave `barberprime.demo.v1`.
- Acesso rápido: cliente demo (Ana Souza), barbeiro demo (Rafael Costa) ou admin demo.
- Todos os fluxos estão disponíveis: cadastro, agendamento, reagendamento, cancelamento,
  bloqueios, feriados, indicadores e edição de barbeiros/serviços.
- Para zerar a demonstração, use **Restaurar demonstração** no painel admin.

## 5. Dúvidas frequentes

- **Não aparece horário:** o serviço pode não caber na jornada, o barbeiro pode estar em
  intervalo/bloqueio, a data pode ser domingo/feriado ou o horário já foi reservado.
- **Horário desapareceu ao confirmar:** outra pessoa reservou primeiro. O sistema nunca
  confirma duas reservas no mesmo horário; escolha outro horário.
- **Sessão expirou:** entre novamente. Cookies de sessão duram 7 dias.
