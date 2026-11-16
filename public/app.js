'use strict';

/* ============================================================
   BARBER PRIME — interface web servida
   HTML + CSS + JS puros. Consome /api/... com caminhos relativos.
   Todos os dados vindos da API são inseridos com textContent.
   ============================================================ */

/* ------------------------------ utilidades DOM ------------------------------ */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.class) node.className = options.class;
  if (options.id) node.id = options.id;
  if (options.text !== undefined && options.text !== null) node.textContent = String(options.text);
  if (options.type) node.type = options.type;
  if (options.value !== undefined && options.value !== null) node.value = String(options.value);
  if (options.attrs) {
    Object.keys(options.attrs).forEach(key => {
      const value = options.attrs[key];
      if (value === false || value === null || value === undefined) return;
      node.setAttribute(key, value === true ? '' : String(value));
    });
  }
  if (options.on) {
    Object.keys(options.on).forEach(key => node.addEventListener(key, options.on[key]));
  }
  const list = Array.isArray(children) ? children : [children];
  list.forEach(child => {
    if (child === null || child === undefined) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

/* ------------------------------ formatos ------------------------------ */

const WEEK_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const WEEK_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTH_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function pad2(number) {
  return String(number).padStart(2, '0');
}

function isoDate(date) {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

function parseISO(value) {
  if (!DATE_RE.test(String(value || ''))) return null;
  const parts = String(value).slice(0, 10).split('-').map(Number);
  if (!parts[0] || !parts[1] || !parts[2]) return null;
  return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
}

function todayISO() {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const map = {};
    parts.forEach(part => { map[part.type] = part.value; });
    if (map.year && map.month && map.day) return map.year + '-' + map.month + '-' + map.day;
  } catch (_) {
    /* ambiente sem suporte a fuso; usa o horário local */
  }
  return isoDate(new Date());
}

function addDaysISO(value, days) {
  const date = parseISO(value) || new Date();
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

function formatDateLong(value) {
  const date = parseISO(value);
  if (!date) return String(value || '—');
  const weekday = WEEK_LONG[date.getDay()];
  return weekday.charAt(0).toUpperCase() + weekday.slice(1) + ', ' + date.getDate() + ' de ' + MONTH_LONG[date.getMonth()];
}

function formatDateShort(value) {
  const date = parseISO(value);
  if (!date) return String(value || '—');
  return pad2(date.getDate()) + '/' + pad2(date.getMonth() + 1);
}

function formatDateFull(value) {
  const date = parseISO(value);
  if (!date) return String(value || '—');
  return pad2(date.getDate()) + '/' + pad2(date.getMonth() + 1) + '/' + date.getFullYear();
}

function formatDateTimeShort(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!match) return String(value || '—');
  return match[3] + '/' + match[2] + '/' + match[1];
}

function weekdayShort(value) {
  const date = parseISO(value);
  return date ? WEEK_SHORT[date.getDay()] : '';
}

function monthShort(value) {
  const date = parseISO(value);
  return date ? MONTH_SHORT[date.getMonth()] : '';
}

function formatBRL(centavos) {
  const number = Number(centavos);
  return BRL.format(Number.isFinite(number) ? number / 100 : 0);
}

function digits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function maskPhone(value) {
  const d = digits(value).slice(0, 11);
  if (!d) return '';
  if (d.length < 3) return '(' + d;
  if (d.length < 7) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
  if (d.length < 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
  return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
}

function formatPhoneDisplay(value) {
  const d = digits(value);
  if (d.length === 10 || d.length === 11) return maskPhone(d);
  return String(value || '—');
}

function listText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(' · ');
  if (typeof value === 'string') return value;
  return '';
}

function fullName(person) {
  if (!person) return '—';
  const name = [person.nome, person.sobrenome].filter(Boolean).join(' ').trim();
  return name || person.nome || '—';
}

function roleLabel(role) {
  if (role === 'admin') return 'Administrador';
  if (role === 'barbeiro') return 'Barbeiro';
  if (role === 'cliente') return 'Cliente';
  return 'Visitante';
}

function statusLabel(status) {
  if (status === 'agendado') return 'Agendado';
  if (status === 'concluido') return 'Concluído';
  if (status === 'cancelado') return 'Cancelado';
  if (status === 'faltou') return 'Faltou';
  return status || 'Status';
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function byStart(a, b) {
  const left = String((a && a.inicio) || ((a && a.data) || '') + ' ' + ((a && a.hora) || ''));
  const right = String((b && b.inicio) || ((b && b.data) || '') + ' ' + ((b && b.hora) || ''));
  return left.localeCompare(right);
}

function formatHours(value) {
  if (value === null || value === undefined || value === '') return 'Horário não informado.';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const parts = value.map(item => {
      if (item === null || item === undefined) return '';
      if (typeof item === 'string') return item;
      const day = item.dia || item.diaSemana || item.dia_semana || '';
      const start = item.inicio || item.abertura || '';
      const end = item.fim || item.fechamento || '';
      if (start || end) return (day ? day + ': ' : '') + start + '–' + end;
      return String(item.descricao || '');
    }).filter(Boolean);
    return parts.length ? parts.join(' · ') : 'Horário não informado.';
  }
  if (typeof value === 'object') {
    const parts = Object.keys(value).map(key => key + ': ' + value[key]).filter(Boolean);
    return parts.length ? parts.join(' · ') : 'Horário não informado.';
  }
  return String(value);
}

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/* ------------------------------ estado e cache ------------------------------ */

const VIEWS = ['inicio', 'agendar', 'meus', 'entrar', 'barbeiro', 'admin'];
const VIEW_TITLES = {
  inicio: 'Início',
  agendar: 'Agendar horário',
  meus: 'Meus agendamentos',
  entrar: 'Entrar',
  barbeiro: 'Painel do barbeiro',
  admin: 'Painel administrativo'
};

const state = {
  user: null,
  view: 'inicio',
  booking: {
    servico: null,
    servicoId: null,
    barbeiroId: null,
    data: null,
    hora: null,
    resumoDias: [],
    horas: [],
    pendingAfterLogin: false
  },
  meus: { filtro: 'proximos', map: {} },
  admin: { barbeiros: [], servicos: [], clientes: [] },
  barbeiro: { bloqueios: [] },
  reagendando: null
};

const cache = {
  barbeiros: null,
  servicos: null,
  config: null,
  pBarbeiros: null,
  pServicos: null,
  pConfig: null
};

let appReady = false;
let modalResolve = null;
let modalPreviousFocus = null;
let rowSequence = 0;
let dateRequestToken = 0;
let meusRequestToken = 0;
let barbeiroRequestToken = 0;
let adminRequestToken = 0;
let manualRequestToken = 0;
let reagendarRequestToken = 0;

/* ------------------------------ API ------------------------------ */

async function api(path, options = {}) {
  const method = options.method || 'GET';
  const init = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') {
    init.headers['Content-Type'] = 'application/json';
    init.body = options.body === undefined ? '{}' : JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch(path, init);
  } catch (_) {
    const error = new Error('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.');
    error.code = 'rede';
    throw error;
  }

  let data = null;
  if (response.status !== 204) {
    const text = await response.text();
    if (text) {
      try { data = JSON.parse(text); } catch (_) { data = null; }
    }
  }

  if (!response.ok) {
    const message = (data && (data.mensagem || data.erro)) || ('O servidor respondeu com erro ' + response.status + '.');
    const error = new Error(message);
    error.status = response.status;
    error.code = data && data.erro ? data.erro : 'erro';
    error.data = data;
    throw error;
  }

  return data;
}

function errorMessage(error, fallback) {
  if (!error) return fallback || 'Algo deu errado. Tente novamente.';
  if (error.code === 'rede') return error.message || 'Falha de conexão. Tente novamente.';
  if (error.status === 401) return 'Sua sessão expirou. Entre novamente.';
  if (error.status === 403) return 'Você não tem permissão para esta ação.';
  if (error.status === 404) return 'Não encontramos o que você procura.';
  if (error.status === 409) {
    if (error.code === 'horario_indisponivel') return 'Esse horário acabou de ser ocupado. Escolha outro.';
    if (error.code === 'estado_invalido') return 'Não é possível alterar este agendamento no estado atual.';
    return error.message || 'Não foi possível concluir a ação.';
  }
  if (error.status === 422) return error.message || 'Confira os dados informados.';
  if (error.status === 429) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  if (error.status >= 500) return 'O servidor encontrou um problema. Tente novamente em instantes.';
  return error.message || fallback || 'Algo deu errado. Tente novamente.';
}

/* ------------------------------ carregamentos ------------------------------ */

function getBarbeiros(force) {
  if (force) {
    cache.barbeiros = null;
    cache.pBarbeiros = null;
  }
  if (cache.barbeiros) return Promise.resolve(cache.barbeiros);
  if (cache.pBarbeiros) return cache.pBarbeiros;
  cache.pBarbeiros = api('/api/barbeiros')
    .then(data => {
      cache.barbeiros = Array.isArray(data && data.barbeiros) ? data.barbeiros : [];
      return cache.barbeiros;
    })
    .finally(() => { cache.pBarbeiros = null; });
  return cache.pBarbeiros;
}

function getServicos(force) {
  if (force) {
    cache.servicos = null;
    cache.pServicos = null;
  }
  if (cache.servicos) return Promise.resolve(cache.servicos);
  if (cache.pServicos) return cache.pServicos;
  cache.pServicos = api('/api/servicos')
    .then(data => {
      cache.servicos = Array.isArray(data && data.servicos) ? data.servicos : [];
      return cache.servicos;
    })
    .finally(() => { cache.pServicos = null; });
  return cache.pServicos;
}

function getConfig(force) {
  if (force) {
    cache.config = null;
    cache.pConfig = null;
  }
  if (cache.config) return Promise.resolve(cache.config);
  if (cache.pConfig) return cache.pConfig;
  cache.pConfig = api('/api/configuracoes')
    .then(data => {
      cache.config = data || {};
      return cache.config;
    })
    .finally(() => { cache.pConfig = null; });
  return cache.pConfig;
}

function clearCatalogCache() {
  cache.barbeiros = null;
  cache.servicos = null;
  cache.config = null;
  cache.pBarbeiros = null;
  cache.pServicos = null;
  cache.pConfig = null;
}

/* ------------------------------ estados visuais ------------------------------ */

function setLoading(node, label) {
  if (!node) return;
  node.replaceChildren();
  const paragraph = el('p', { class: 'state state-loading' });
  paragraph.append(el('span', { class: 'spinner', attrs: { 'aria-hidden': 'true' } }));
  paragraph.append(el('span', { text: label || 'Carregando…' }));
  node.append(paragraph);
}

function setEmpty(node, label) {
  if (!node) return;
  node.replaceChildren();
  node.append(el('p', { class: 'state', text: label || 'Nada por aqui.' }));
}

function setError(node, message, retry) {
  if (!node) return;
  node.replaceChildren();
  const box = el('div', { class: 'state state-erro' });
  box.append(el('span', { text: message || 'Não foi possível carregar.' }));
  if (retry) {
    const button = el('button', { type: 'button', class: 'btn btn-mini btn-ghost', text: 'Tentar novamente' });
    button.addEventListener('click', retry);
    box.append(button);
  }
  node.append(box);
}

function showMsg(node, message, type) {
  if (!node) return;
  node.hidden = false;
  node.className = 'msg msg-' + (type || 'erro');
  node.replaceChildren(el('span', { text: message }));
}

function showRetryMsg(node, message, retry, type) {
  if (!node) return;
  node.hidden = false;
  node.className = 'msg msg-' + (type || 'erro');
  node.replaceChildren(el('span', { text: message }));
  const button = el('button', { type: 'button', class: 'btn btn-mini btn-ghost', text: 'Tentar novamente' });
  button.addEventListener('click', retry);
  node.append(button);
}

function hideMsg(node) {
  if (!node) return;
  node.hidden = true;
  node.replaceChildren();
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    if (!button.dataset.idleText) button.dataset.idleText = button.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (label) button.textContent = label;
  } else {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (button.dataset.idleText) {
      button.textContent = button.dataset.idleText;
      delete button.dataset.idleText;
    }
  }
}

function markInvalid(selector, message, box) {
  const input = $(selector);
  if (input) {
    input.setAttribute('aria-invalid', 'true');
    try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); }
  }
  showMsg(box, message);
}

/* ------------------------------ toasts ------------------------------ */

function showToast(message, type) {
  const region = $('#toast-region');
  if (!region) return;
  const toast = el('div', { class: 'toast toast-' + (type || 'info') });
  toast.append(el('span', { class: 'toast-text', text: message }));
  const close = el('button', {
    type: 'button',
    class: 'toast-close',
    text: '×',
    attrs: { 'aria-label': 'Fechar mensagem' }
  });
  close.addEventListener('click', () => toast.remove());
  toast.append(close);
  region.append(toast);
  window.setTimeout(() => {
    if (!toast.isConnected) return;
    toast.classList.add('toast-out');
    window.setTimeout(() => toast.remove(), 260);
  }, 5200);
}

/* ------------------------------ modal ------------------------------ */

function confirmDialog(config) {
  return new Promise(resolve => {
    if (modalResolve) {
      const previous = modalResolve;
      modalResolve = null;
      previous(false);
    }
    modalResolve = resolve;
    modalPreviousFocus = document.activeElement;
    const title = $('#modal-titulo');
    const text = $('#modal-texto');
    const confirm = $('#modal-confirmar');
    const overlay = $('#modal-overlay');
    if (!title || !text || !confirm || !overlay) {
      resolve(false);
      return;
    }
    title.textContent = config.title || 'Confirmar';
    text.textContent = config.text || '';
    confirm.textContent = config.confirmLabel || 'Confirmar';
    confirm.className = 'btn ' + (config.danger ? 'btn-danger' : 'btn-gold');
    overlay.hidden = false;
    try { confirm.focus({ preventScroll: true }); } catch (_) { confirm.focus(); }
  });
}

function closeModal(result) {
  const overlay = $('#modal-overlay');
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  const resolve = modalResolve;
  modalResolve = null;
  const previous = modalPreviousFocus;
  modalPreviousFocus = null;
  if (previous && typeof previous.focus === 'function') {
    try { previous.focus({ preventScroll: true }); } catch (_) { previous.focus(); }
  }
  if (resolve) resolve(result);
}

/* ------------------------------ sessão / autenticação ------------------------------ */

function updateHeader() {
  const userNode = $('#usuario-atual');
  const logoutButton = $('#btn-sair');
  if (!userNode || !logoutButton) return;
  if (state.user) {
    const name = [state.user.nome, state.user.sobrenome].filter(Boolean).join(' ') || state.user.login || 'Conta';
    userNode.textContent = name + ' · ' + roleLabel(state.user.papel);
    logoutButton.hidden = false;
  } else {
    userNode.textContent = 'Visitante';
    logoutButton.hidden = true;
  }
}

async function bootstrapSession() {
  try {
    const response = await api('/api/sessao');
    state.user = response && response.usuario ? response.usuario : null;
  } catch (_) {
    state.user = null;
  }
  updateHeader();
}

function clearAuthSecrets() {
  ['#login-pin', '#cadastro-pin', '#login-staff-senha'].forEach(selector => {
    const input = $(selector);
    if (input) input.value = '';
  });
}

function sessionExpired(message) {
  state.user = null;
  updateHeader();
  showToast(message || 'Sua sessão expirou. Entre novamente.', 'erro');
  go('entrar');
}

async function logout() {
  const button = $('#btn-sair');
  setBusy(button, true, 'Saindo…');
  try {
    await api('/api/logout', { method: 'POST' });
  } catch (error) {
    if (error.status !== 401) {
      showToast(errorMessage(error, 'Não foi possível sair agora. Tente novamente.'), 'erro');
      setBusy(button, false);
      return;
    }
  }
  state.user = null;
  state.booking.pendingAfterLogin = false;
  state.meus.map = {};
  updateHeader();
  go('inicio');
  showToast('Você saiu da sua conta.', 'info');
  setBusy(button, false);
}

function afterAuth(usuario) {
  if (!usuario) return;
  state.user = usuario;
  updateHeader();
  clearAuthSecrets();
  const pending = state.booking.pendingAfterLogin;

  if (usuario.papel === 'cliente') {
    state.booking.pendingAfterLogin = false;
    if (pending) {
      go('agendar');
      showToast('Sessão iniciada. Confirme seu agendamento.', 'sucesso');
    } else {
      go('meus');
      showToast('Bem-vindo(a), ' + (usuario.nome || 'cliente') + '!', 'sucesso');
    }
    return;
  }

  state.booking.pendingAfterLogin = false;
  if (usuario.papel === 'barbeiro') {
    if (pending) showToast('Conta de barbeiro não agenda pela tela do cliente. Use o painel da equipe.', 'info');
    go('barbeiro');
    return;
  }
  if (usuario.papel === 'admin') {
    if (pending) showToast('Conta de administrador: use o agendamento manual no painel administrativo.', 'info');
    go('admin');
    return;
  }
  go('inicio');
}

function validateCadastro(nome, sobrenome, telefone, pin) {
  if (nome.length < 2 || nome.length > 60) {
    return { field: '#cadastro-nome', message: 'Informe seu nome (2 a 60 caracteres).' };
  }
  if (sobrenome.length < 2 || sobrenome.length > 60) {
    return { field: '#cadastro-sobrenome', message: 'Informe seu sobrenome (2 a 60 caracteres).' };
  }
  if (telefone.length < 10 || telefone.length > 11) {
    return { field: '#cadastro-telefone', message: 'Informe um telefone com DDD, com 10 ou 11 dígitos.' };
  }
  if (!/^\d{4,6}$/.test(pin)) {
    return { field: '#cadastro-pin', message: 'O PIN deve ter de 4 a 6 dígitos.' };
  }
  return null;
}

async function submitCadastro() {
  const box = $('#cadastro-erro');
  hideMsg(box);
  const nome = ($('#cadastro-nome').value || '').trim();
  const sobrenome = ($('#cadastro-sobrenome').value || '').trim();
  const telefone = digits(($('#cadastro-telefone').value || ''));
  const pin = digits(($('#cadastro-pin').value || ''));

  const invalid = validateCadastro(nome, sobrenome, telefone, pin);
  if (invalid) {
    markInvalid(invalid.field, invalid.message, box);
    return;
  }

  const button = $('#btn-cadastrar');
  setBusy(button, true, 'Criando conta…');
  try {
    const response = await api('/api/clientes', {
      method: 'POST',
      body: { nome, sobrenome, telefone, pin }
    });
    if (!response || !response.usuario) throw new Error('O servidor não retornou a conta criada.');
    afterAuth(response.usuario);
  } catch (error) {
    if (error.status === 409) {
      showMsg(box, error.message || 'Não foi possível concluir o cadastro com esses dados. Se você já tem conta, entre com seu PIN.');
    } else if (error.status === 422) {
      showMsg(box, error.message || 'Confira os dados informados.');
    } else if (error.status === 401) {
      showMsg(box, 'Não foi possível concluir o cadastro. Se você já tem conta, entre com seu PIN.');
    } else if (error.status === 429) {
      showMsg(box, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    } else if (error.code === 'rede') {
      showRetryMsg(box, errorMessage(error, 'Falha de conexão.'), () => submitCadastro());
    } else {
      showMsg(box, errorMessage(error, 'Não foi possível criar sua conta.'));
    }
  } finally {
    setBusy(button, false);
  }
}

async function submitLoginCliente() {
  const box = $('#login-erro');
  hideMsg(box);
  const telefone = digits(($('#login-telefone').value || ''));
  const pin = digits(($('#login-pin').value || ''));

  if (telefone.length < 10 || telefone.length > 11) {
    markInvalid('#login-telefone', 'Informe um telefone com DDD, com 10 ou 11 dígitos.', box);
    return;
  }
  if (!/^\d{4,6}$/.test(pin)) {
    markInvalid('#login-pin', 'Informe seu PIN de 4 a 6 dígitos.', box);
    return;
  }

  const button = $('#btn-entrar-cliente');
  setBusy(button, true, 'Entrando…');
  try {
    const response = await api('/api/login', {
      method: 'POST',
      body: { login: telefone, senha: pin }
    });
    if (!response || !response.usuario) throw new Error('O servidor não retornou a conta.');
    afterAuth(response.usuario);
  } catch (error) {
    if (error.status === 401) {
      showMsg(box, 'Telefone ou PIN inválidos. Confira os dados e tente novamente.');
    } else if (error.status === 429) {
      showMsg(box, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    } else if (error.code === 'rede') {
      showRetryMsg(box, errorMessage(error, 'Falha de conexão.'), () => submitLoginCliente());
    } else {
      showMsg(box, errorMessage(error, 'Não foi possível entrar.'));
    }
  } finally {
    setBusy(button, false);
  }
}

async function submitLoginStaff() {
  const box = $('#login-staff-erro');
  hideMsg(box);
  const login = ($('#login-staff-login').value || '').trim();
  const senha = $('#login-staff-senha').value || '';

  if (!login) {
    markInvalid('#login-staff-login', 'Informe seu login da equipe.', box);
    return;
  }
  if (!senha) {
    markInvalid('#login-staff-senha', 'Informe sua senha.', box);
    return;
  }

  const button = $('#btn-entrar-staff');
  setBusy(button, true, 'Entrando…');
  try {
    const response = await api('/api/login', { method: 'POST', body: { login, senha } });
    if (!response || !response.usuario) throw new Error('O servidor não retornou a conta.');
    const usuario = response.usuario;
    if (usuario.papel === 'cliente') {
      state.user = usuario;
      updateHeader();
      clearAuthSecrets();
      showMsg(box, 'Esta conta é de cliente. Use a área de login de cliente.');
      return;
    }
    state.user = usuario;
    updateHeader();
    afterAuth(usuario);
  } catch (error) {
    if (error.status === 401) {
      showMsg(box, 'Login ou senha inválidos. Confira e tente novamente.');
    } else if (error.status === 429) {
      showMsg(box, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    } else if (error.code === 'rede') {
      showRetryMsg(box, errorMessage(error, 'Falha de conexão.'), () => submitLoginStaff());
    } else {
      showMsg(box, errorMessage(error, 'Não foi possível entrar na equipe.'));
    }
  } finally {
    setBusy(button, false);
  }
}

/* ------------------------------ navegação ------------------------------ */

function parseHash() {
  const match = /^#\/([a-z]+)/.exec(location.hash || '');
  if (match && VIEWS.indexOf(match[1]) !== -1) return match[1];
  return 'inicio';
}

function go(view) {
  const target = VIEWS.indexOf(view) !== -1 ? view : 'inicio';
  const hash = '#/' + target;
  if (location.hash === hash) {
    renderRoute(target);
  } else {
    location.hash = hash;
  }
}

function renderRoute(view) {
  const active = VIEWS.indexOf(view) !== -1 ? view : 'inicio';
  state.view = active;
  VIEWS.forEach(name => {
    const section = $('#view-' + name);
    if (section) section.hidden = name !== active;
  });
  const title = $('#titulo-pagina');
  if (title) title.textContent = VIEW_TITLES[active];
  document.title = VIEW_TITLES[active] + ' · Barber Prime';
  $$('#nav-principal .nav-btn').forEach(button => {
    if (button.dataset.view === active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  try {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  } catch (_) {
    window.scrollTo(0, 0);
  }
  handleView(active);
}

function handleView(view) {
  if (view === 'inicio') renderHome();
  else if (view === 'agendar') enterBooking();
  else if (view === 'meus') renderMeusView();
  else if (view === 'entrar') renderEntrar();
  else if (view === 'barbeiro') renderBarbeiroView();
  else if (view === 'admin') renderAdminView();
}

/* ------------------------------ início ------------------------------ */

function renderHome() {
  renderHomeBarbeiros();
  renderHomeServicos();
  renderHomeInfo();
}

function avatarFor(person, small) {
  const source = (person && person.nome) || 'Barber Prime';
  const initials = source.trim().split(/\s+/).map(part => part.charAt(0)).slice(0, 2).join('').toUpperCase();
  const id = Number(person && person.id);
  const variant = ((((Number.isFinite(id) ? id : 0) - 1) % 4) + 4) % 4 + 1;
  const node = el('span', {
    class: 'avatar avatar-' + variant + (small ? ' avatar-sm' : ''),
    attrs: { 'aria-hidden': 'true' }
  });
  node.textContent = initials || 'BP';
  return node;
}

function barberCard(barber) {
  const card = el('article', { class: 'barber-card' });
  const top = el('div', { class: 'barber-top' });
  top.append(avatarFor(barber, false));
  const names = el('div');
  names.append(el('h3', { class: 'barber-name', text: barber.nome || 'Barbeiro' }));
  if (barber.apelido) {
    names.append(el('p', { class: 'barber-apelido', text: '@' + String(barber.apelido).replace(/^@/, '') }));
  }
  top.append(names);
  card.append(top);
  const specialties = listText(barber.especialidades);
  card.append(el('p', { class: 'barber-specialties', text: specialties || 'Cortes e barba' }));
  if (barber.bio) card.append(el('p', { class: 'barber-bio', text: barber.bio }));
  return card;
}

function renderHomeBarbeiros(force) {
  const box = $('#home-barbeiros');
  if (!box) return;
  if (cache.barbeiros && !force) {
    paintHomeBarbeiros(cache.barbeiros);
    return;
  }
  setLoading(box, 'Carregando barbeiros…');
  getBarbeiros(force)
    .then(list => { if (state.view === 'inicio') paintHomeBarbeiros(list); })
    .catch(error => {
      if (state.view === 'inicio') {
        setError(box, errorMessage(error, 'Não foi possível carregar os barbeiros.'), () => renderHomeBarbeiros(true));
      }
    });
}

function paintHomeBarbeiros(list) {
  const box = $('#home-barbeiros');
  if (!box) return;
  const active = list.filter(barber => barber && barber.ativo !== false);
  if (!active.length) {
    setEmpty(box, 'Nenhum barbeiro cadastrado no momento.');
    return;
  }
  box.replaceChildren();
  active.forEach(barber => box.append(barberCard(barber)));
}

function serviceCard(service) {
  const card = el('article', { class: 'service-card' });
  const head = el('div', { class: 'service-head' });
  head.append(el('h3', { class: 'service-name', text: service.nome || 'Serviço' }));
  head.append(el('span', { class: 'service-price', text: formatBRL(service.precoCentavos) }));
  card.append(head);
  if (service.descricao) card.append(el('p', { class: 'service-desc', text: service.descricao }));
  card.append(el('p', { class: 'service-meta', text: 'Duração: ' + (Number(service.duracaoMin) || 0) + ' min' }));
  return card;
}

function renderHomeServicos(force) {
  const box = $('#home-servicos');
  if (!box) return;
  if (cache.servicos && !force) {
    paintHomeServicos(cache.servicos);
    return;
  }
  setLoading(box, 'Carregando serviços…');
  getServicos(force)
    .then(list => { if (state.view === 'inicio') paintHomeServicos(list); })
    .catch(error => {
      if (state.view === 'inicio') {
        setError(box, errorMessage(error, 'Não foi possível carregar os serviços.'), () => renderHomeServicos(true));
      }
    });
}

function paintHomeServicos(list) {
  const box = $('#home-servicos');
  if (!box) return;
  const active = list.filter(service => service && service.ativo !== false);
  if (!active.length) {
    setEmpty(box, 'Nenhum serviço cadastrado no momento.');
    return;
  }
  box.replaceChildren();
  active.forEach(service => box.append(serviceCard(service)));
}

function renderHomeInfo(force) {
  const nodes = [$('#home-horarios'), $('#home-contato'), $('#home-feriados')].filter(Boolean);
  if (!nodes.length) return;
  if (cache.config && !force) {
    paintHomeInfo(cache.config);
    return;
  }
  nodes.forEach(node => setLoading(node, 'Carregando…'));
  getConfig(force)
    .then(config => { if (state.view === 'inicio') paintHomeInfo(config); })
    .catch(error => {
      if (state.view !== 'inicio') return;
      nodes.forEach(node => {
        setError(node, errorMessage(error, 'Não foi possível carregar as informações.'), () => renderHomeInfo(true));
      });
    });
}

function paintHomeInfo(config) {
  paintHomeHorarios(config);
  paintHomeContato(config);
  paintHomeFeriados(config);
}

function infoBlock(label, value) {
  const paragraph = el('p', { class: 'info-line' });
  paragraph.append(el('span', { class: 'info-label', text: label }));
  paragraph.append(el('span', { text: value }));
  return paragraph;
}

function paintHomeHorarios(config) {
  const box = $('#home-horarios');
  if (!box) return;
  box.replaceChildren();
  const value = config ? config.horarioFuncionamento : null;
  box.append(el('p', { class: 'info-line', text: formatHours(value) }));
}

function paintHomeContato(config) {
  const box = $('#home-contato');
  if (!box) return;
  box.replaceChildren();
  box.append(infoBlock('Endereço', (config && config.endereco) || 'Endereço não informado.'));
  const phone = config && config.telefoneContato;
  if (phone) {
    const paragraph = el('p', { class: 'info-line' });
    paragraph.append(el('span', { class: 'info-label', text: 'Telefone' }));
    const link = el('a', { class: 'info-link', attrs: { href: 'tel:' + digits(phone) } });
    link.textContent = formatPhoneDisplay(phone);
    paragraph.append(link);
    box.append(paragraph);
  } else {
    box.append(infoBlock('Telefone', 'Não informado.'));
  }
}

function paintHomeFeriados(config) {
  const box = $('#home-feriados');
  if (!box) return;
  box.replaceChildren();
  const holidays = config && Array.isArray(config.feriados) ? config.feriados.slice() : [];
  if (!holidays.length) {
    box.append(el('p', { class: 'info-line', text: 'Sem feriados cadastrados.' }));
    return;
  }
  holidays.sort((a, b) => {
    const left = typeof a === 'string' ? a : (a && a.data) || '';
    const right = typeof b === 'string' ? b : (b && b.data) || '';
    return String(left).localeCompare(String(right));
  });
  const list = el('ul', { class: 'plain-list' });
  holidays.forEach(holiday => {
    const raw = typeof holiday === 'string' ? holiday : holiday && holiday.data;
    const description = holiday && typeof holiday === 'object' ? holiday.descricao : '';
    list.append(el('li', { text: formatDateFull(raw) + (description ? ' — ' + description : '') }));
  });
  box.append(list);
}

/* ------------------------------ agendamento ------------------------------ */

function serviceSummary(service) {
  return (service.nome || 'Serviço') + ' — ' + formatBRL(service.precoCentavos) + ' · ' + (Number(service.duracaoMin) || 0) + ' min';
}

function enterBooking() {
  hideBookingError();
  loadBookingServices();
  loadBookingBarbers();
  renderBookingRestore();
}

function loadBookingServices(force) {
  const box = $('#lista-servicos');
  if (!box) return;
  if (cache.servicos && !force) {
    paintBookingServices(cache.servicos);
    return;
  }
  setLoading(box, 'Carregando serviços…');
  getServicos(force)
    .then(list => { if (state.view === 'agendar') paintBookingServices(list); })
    .catch(error => {
      if (state.view === 'agendar') {
        setError(box, errorMessage(error, 'Não foi possível carregar os serviços.'), () => loadBookingServices(true));
      }
    });
}

function paintBookingServices(list) {
  const box = $('#lista-servicos');
  if (!box) return;
  const active = list.filter(service => service && service.ativo !== false);
  if (!active.length) {
    setEmpty(box, 'Nenhum serviço disponível no momento.');
    return;
  }
  box.replaceChildren();
  active.forEach(service => {
    const button = el('button', {
      type: 'button',
      class: 'option',
      id: 'servico-' + service.id,
      attrs: { 'aria-pressed': 'false' }
    });
    button.append(el('span', { class: 'option-title', text: service.nome || 'Serviço' }));
    button.append(el('span', {
      class: 'option-meta',
      text: formatBRL(service.precoCentavos) + ' · ' + (Number(service.duracaoMin) || 0) + ' min'
    }));
    if (service.descricao) button.append(el('span', { class: 'option-desc', text: service.descricao }));
    button.addEventListener('click', () => selectService(service));
    box.append(button);
  });
  restoreServiceSelection();
}

function restoreServiceSelection() {
  const booking = state.booking;
  $$('#lista-servicos .option').forEach(button => {
    button.setAttribute('aria-pressed', String(booking.servicoId != null && button.id === 'servico-' + booking.servicoId));
  });
}

function loadBookingBarbers(force) {
  const box = $('#lista-barbeiros');
  if (!box) return;
  if (cache.barbeiros && !force) {
    paintBookingBarbers(cache.barbeiros);
    return;
  }
  let status = $('#barbeiros-status');
  if (!status) {
    status = el('p', { class: 'state', id: 'barbeiros-status' });
    box.append(status);
  }
  status.hidden = false;
  status.className = 'state';
  status.replaceChildren(
    el('span', { class: 'spinner', attrs: { 'aria-hidden': 'true' } }),
    el('span', { text: 'Carregando barbeiros…' })
  );
  getBarbeiros(force)
    .then(list => {
      status.hidden = true;
      if (state.view === 'agendar') paintBookingBarbers(list);
    })
    .catch(error => {
      if (state.view !== 'agendar') return;
      status.hidden = false;
      status.className = 'state state-erro';
      status.replaceChildren(el('span', { text: errorMessage(error, 'Não foi possível carregar os barbeiros.') }));
      const retry = el('button', { type: 'button', class: 'btn btn-mini btn-ghost', text: 'Tentar novamente' });
      retry.addEventListener('click', () => loadBookingBarbers(true));
      status.append(retry);
    });
}

function paintBookingBarbers(list) {
  const box = $('#lista-barbeiros');
  if (!box) return;
  $$('.option-barber', box).forEach(node => node.remove());
  const status = $('#barbeiros-status');
  if (status) status.hidden = true;
  const active = list.filter(barber => barber && barber.ativo !== false);
  const anyButton = $('#barbeiro-qualquer');

  if (!active.length) {
    if (status) {
      status.hidden = false;
      status.className = 'state';
      status.textContent = 'Nenhum barbeiro disponível no momento.';
    }
  } else {
    active.forEach(barber => {
      const button = el('button', {
        type: 'button',
        class: 'option option-barber',
        id: 'barbeiro-' + barber.id,
        attrs: { 'aria-pressed': 'false' }
      });
      button.append(avatarFor(barber, true));
      const text = el('span', { class: 'option-barber-text' });
      text.append(el('span', { class: 'option-title', text: barber.nome || 'Barbeiro' }));
      const specialties = listText(barber.especialidades);
      if (specialties) text.append(el('span', { class: 'option-meta', text: specialties }));
      button.append(text);
      button.addEventListener('click', () => selectBarber(barber.id));
      box.insertBefore(button, status || anyButton || null);
    });
  }

  if (anyButton) {
    box.append(anyButton);
    anyButton.disabled = active.length === 0;
  }
  restoreBarberSelection();
}

function restoreBarberSelection() {
  const booking = state.booking;
  const target = booking.barbeiroId == null ? 'barbeiro-qualquer' : 'barbeiro-' + booking.barbeiroId;
  $$('#lista-barbeiros .option').forEach(button => {
    button.setAttribute('aria-pressed', String(button.id === target));
  });
}

function updateBarberSummary() {
  const node = $('#resumo-barbeiro');
  if (!node) return;
  const booking = state.booking;
  if (booking.barbeiroId == null) {
    node.textContent = 'Qualquer barbeiro — o primeiro horário livre será reservado.';
    return;
  }
  const barber = (cache.barbeiros || []).find(item => Number(item.id) === Number(booking.barbeiroId));
  if (!barber) {
    node.textContent = 'Barbeiro selecionado.';
    return;
  }
  const specialties = listText(barber.especialidades);
  node.textContent = barber.nome + (specialties ? ' — ' + specialties : '');
}

function renderBookingRestore() {
  const booking = state.booking;
  const calendar = $('#calendario');
  const slots = $('#horarios');

  if (!booking.servicoId) {
    const serviceSummaryNode = $('#resumo-servico');
    const barberSummaryNode = $('#resumo-barbeiro');
    const timeSummaryNode = $('#resumo-horario');
    const dateNode = $('#data-selecionada');
    if (serviceSummaryNode) serviceSummaryNode.textContent = 'Nenhum serviço selecionado.';
    if (barberSummaryNode) barberSummaryNode.textContent = 'Qualquer barbeiro — primeiro horário livre.';
    if (timeSummaryNode) timeSummaryNode.textContent = 'Nenhum horário selecionado.';
    if (dateNode) dateNode.textContent = 'Nenhuma data selecionada';
    if (calendar) calendar.replaceChildren(el('p', { class: 'state', text: 'Escolha um serviço para ver as datas com vaga.' }));
    if (slots) slots.replaceChildren(el('p', { class: 'state', text: 'Escolha uma data para ver os horários.' }));
    return;
  }

  const service = (cache.servicos || []).find(item => Number(item.id) === Number(booking.servicoId));
  if (service) {
    booking.servico = service;
    const node = $('#resumo-servico');
    if (node) node.textContent = serviceSummary(service);
  }
  restoreServiceSelection();
  restoreBarberSelection();
  updateBarberSummary();

  if (booking.resumoDias.length) {
    renderCalendar();
    if (booking.data) {
      const dateNode = $('#data-selecionada');
      if (dateNode) dateNode.textContent = 'Data: ' + formatDateLong(booking.data);
      selectDate(booking.data, { keepHora: true });
    } else {
      const dateNode = $('#data-selecionada');
      if (dateNode) dateNode.textContent = 'Escolha um dia disponível';
      if (slots) slots.replaceChildren(el('p', { class: 'state', text: 'Escolha uma data para ver os horários.' }));
    }
    return;
  }

  if (booking.servico) {
    selectService(booking.servico, { keepSelection: true });
    return;
  }

  if (calendar) calendar.replaceChildren(el('p', { class: 'state', text: 'Escolha um serviço para ver as datas com vaga.' }));
  if (slots) slots.replaceChildren(el('p', { class: 'state', text: 'Escolha uma data para ver os horários.' }));
  const dateNode = $('#data-selecionada');
  if (dateNode) dateNode.textContent = 'Nenhuma data selecionada';
}

async function selectService(service, options = {}) {
  if (!service) return;
  const booking = state.booking;
  const sameService = Number(booking.servicoId) === Number(service.id);

  if (sameService && booking.resumoDias.length && !options.force) {
    booking.servico = service;
    const summary = $('#resumo-servico');
    if (summary) summary.textContent = serviceSummary(service);
    restoreServiceSelection();
    updateBarberSummary();
    return;
  }

  booking.servico = service;
  booking.servicoId = service.id;
  if (!sameService) {
    booking.data = null;
    booking.hora = null;
    booking.resumoDias = [];
    booking.horas = [];
  }

  hideBookingError();
  const confirmation = $('#confirmacao');
  if (confirmation) confirmation.hidden = true;

  const serviceSummaryNode = $('#resumo-servico');
  if (serviceSummaryNode) serviceSummaryNode.textContent = serviceSummary(service);
  const timeSummaryNode = $('#resumo-horario');
  if (timeSummaryNode) timeSummaryNode.textContent = 'Nenhum horário selecionado.';
  restoreServiceSelection();
  setLoading($('#calendario'), 'Buscando a próxima data com vaga…');
  clearSlots('Escolha uma data para ver os horários.');

  try {
    const today = todayISO();
    const query = '/api/disponibilidade/resumo?servicoId=' + encodeURIComponent(service.id) +
      '&de=' + encodeURIComponent(today) + '&ate=' + encodeURIComponent(addDaysISO(today, 61));
    const response = await api(query);
    const days = Array.isArray(response && response.dias) ? response.dias : [];
    booking.resumoDias = days.filter(day => day && day.disponivel);
    renderCalendar();

    if (!booking.resumoDias.length) {
      const dateNode = $('#data-selecionada');
      if (dateNode) dateNode.textContent = 'Sem datas disponíveis';
      setEmpty($('#calendario'), 'Nenhuma data com vaga nos próximos 62 dias.');
      clearSlots('Nenhum horário disponível nas próximas datas.');
      return;
    }

    const preferred = booking.data && booking.resumoDias.some(day => day.data === booking.data)
      ? booking.data
      : booking.resumoDias[0].data;
    await selectDate(preferred, { autoAdvance: true, keepHora: options.keepSelection === true });
  } catch (error) {
    setError($('#calendario'), errorMessage(error, 'Não foi possível carregar as datas com vaga.'), () => {
      selectService(service, { keepSelection: true, force: true });
    });
  }
}

async function selectBarber(id) {
  const booking = state.booking;
  booking.barbeiroId = (id === null || id === undefined) ? null : Number(id);
  restoreBarberSelection();
  updateBarberSummary();
  if (!booking.servicoId || !booking.data) return;
  await selectDate(booking.data, { keepHora: true, autoAdvance: true });
}

function sourceDaySelection(date) {
  $$('#calendario .day').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.date === date));
  });
}

function renderCalendar() {
  const box = $('#calendario');
  if (!box) return;
  box.replaceChildren();
  const days = state.booking.resumoDias || [];
  if (!days.length) {
    box.append(el('p', { class: 'state', text: 'Nenhuma data com vaga nos próximos 62 dias.' }));
    return;
  }
  days.forEach(day => {
    const available = count(day.vagas);
    const button = el('button', {
      type: 'button',
      class: 'day',
      attrs: {
        'aria-pressed': String(state.booking.data === day.data),
        'aria-label': formatDateLong(day.data) + ' — ' + available + (available === 1 ? ' vaga' : ' vagas'),
        'data-date': day.data
      }
    });
    const parsed = parseISO(day.data);
    button.append(el('span', { class: 'day-week', text: weekdayShort(day.data) }));
    button.append(el('span', { class: 'day-num', text: parsed ? pad2(parsed.getDate()) : '--' }));
    button.append(el('span', { class: 'day-month', text: monthShort(day.data) }));
    button.append(el('span', { class: 'day-vagas', text: available + (available === 1 ? ' vaga' : ' vagas') }));
    button.addEventListener('click', () => selectDate(day.data));
    box.append(button);
  });
}

async function fetchAvailability(servicoId, data, barbeiroId) {
  const params = new URLSearchParams();
  params.set('servicoId', String(servicoId));
  params.set('data', String(data));
  if (barbeiroId !== null && barbeiroId !== undefined && barbeiroId !== '') {
    params.set('barbeiroId', String(barbeiroId));
  }
  const response = await api('/api/disponibilidade?' + params.toString());
  const unique = new Set();
  const options = response && Array.isArray(response.opcoes) ? response.opcoes : [];
  options.forEach(option => {
    const hours = option && Array.isArray(option.horarios) ? option.horarios : [];
    hours.forEach(hour => {
      if (/^\d{2}:\d{2}$/.test(String(hour))) unique.add(String(hour));
    });
  });
  return Array.from(unique).sort();
}

async function findNextDateWithSlots(afterDate) {
  const days = state.booking.resumoDias || [];
  if (!days.length) return null;
  const index = days.findIndex(day => day.data === afterDate);
  const candidates = index >= 0 ? days.slice(index + 1) : days.slice();
  const limit = Math.min(candidates.length, 24);
  for (let i = 0; i < limit; i += 1) {
    const candidate = candidates[i].data;
    try {
      const slots = await fetchAvailability(state.booking.servicoId, candidate, state.booking.barbeiroId);
      if (slots.length) return { data: candidate, slots };
    } catch (_) {
      /* tenta a próxima data */
    }
  }
  return null;
}

async function selectDate(date, options = {}) {
  const booking = state.booking;
  if (!booking.servicoId || !date) return;
  const keepHour = options.keepHour === true;
  if (booking.data !== date || !keepHour) booking.hora = null;
  const previousHour = booking.hora;
  booking.data = date;

  const dateNode = $('#data-selecionada');
  if (dateNode) dateNode.textContent = 'Data: ' + formatDateLong(date);
  sourceDaySelection(date);

  const box = $('#horarios');
  setLoading(box, 'Carregando horários…');
  const summary = $('#resumo-horario');
  if (summary) summary.textContent = 'Nenhum horário selecionado.';

  const token = ++dateRequestToken;
  try {
    const slots = await fetchAvailability(booking.servicoId, date, booking.barbeiroId);
    if (token !== dateRequestToken) return;
    booking.horas = slots;

    if (!slots.length) {
      clearSlots(booking.barbeiroId == null
        ? 'Nenhum horário disponível nesta data.'
        : 'Nenhum horário disponível para este barbeiro nesta data.');
      if (options.autoAdvance) {
        const next = await findNextDateWithSlots(date);
        if (next && token === dateRequestToken) {
          await selectDate(next.data, { autoAdvance: false });
          return;
        }
      }
      if (previousHour) {
        booking.hora = null;
        showBookingError('O horário escolhido não está mais disponível. Escolha outro.', null);
      }
      return;
    }

    renderSlots();
    if (previousHour && slots.indexOf(previousHour) !== -1) {
      selectHora(previousHour);
    } else if (previousHour) {
      booking.hora = null;
      showBookingError('O horário escolhido não está mais disponível. Escolha outro.', null);
    }
  } catch (error) {
    if (token !== dateRequestToken) return;
    setError(box, errorMessage(error, 'Não foi possível carregar os horários.'), () => selectDate(date, { keepHour: true }));
  }
}

function clearSlots(message) {
  state.booking.horas = [];
  const box = $('#horarios');
  if (!box) return;
  box.replaceChildren();
  if (message) box.append(el('p', { class: 'state', text: message }));
}

function renderSlots() {
  const box = $('#horarios');
  if (!box) return;
  const booking = state.booking;
  box.replaceChildren();
  booking.horas.forEach(hour => {
    const button = el('button', {
      type: 'button',
      class: 'slot',
      text: hour,
      attrs: { 'aria-pressed': String(booking.hora === hour), 'aria-label': 'Horário ' + hour }
    });
    button.addEventListener('click', () => selectHora(hour));
    box.append(button);
  });
}

function selectHora(hour) {
  state.booking.hora = hour;
  $$('#horarios .slot').forEach(button => {
    button.setAttribute('aria-pressed', String(button.textContent === hour));
  });
  const summary = $('#resumo-horario');
  if (summary) summary.textContent = 'Horário selecionado: ' + hour;
}

async function onNextDate() {
  const booking = state.booking;
  if (!booking.servicoId) {
    showBookingError('Escolha um serviço primeiro.', null);
    return;
  }
  const button = $('#btn-proxima-data');
  setBusy(button, true, 'Buscando…');
  try {
    const next = await findNextDateWithSlots(booking.data || '');
    if (next) {
      await selectDate(next.data);
      showToast('Data atualizada para ' + formatDateLong(next.data) + '.', 'info');
    } else {
      showToast('Não há outra data com vaga à frente para este serviço.', 'info');
    }
  } finally {
    setBusy(button, false);
  }
}

async function onNextHour() {
  const booking = state.booking;
  if (!booking.servicoId) {
    showBookingError('Escolha um serviço primeiro.', null);
    return;
  }
  if (!booking.data) {
    showBookingError('Escolha uma data primeiro.', null);
    return;
  }
  if (booking.horas.length) {
    selectHora(booking.horas[0]);
    return;
  }
  const button = $('#btn-proximo-horario');
  setBusy(button, true, 'Buscando…');
  try {
    const next = await findNextDateWithSlots(booking.data);
    if (next) {
      await selectDate(next.data);
      if (next.slots.length) selectHora(next.slots[0]);
    } else {
      showToast('Não há horários disponíveis nas próximas datas para este serviço.', 'info');
    }
  } finally {
    setBusy(button, false);
  }
}

function showBookingError(message, retry) {
  const box = $('#erro-booking');
  if (!box) return;
  box.hidden = false;
  box.className = 'msg msg-erro';
  box.replaceChildren(el('span', { text: message }));
  if (retry) {
    const button = el('button', { type: 'button', class: 'btn btn-mini btn-ghost', text: 'Tentar novamente' });
    button.addEventListener('click', retry);
    box.append(button);
  }
  try { box.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' }); } catch (_) { /* sem scroll */ }
}

function hideBookingError() {
  const box = $('#erro-booking');
  if (!box) return;
  box.hidden = true;
  box.replaceChildren();
}

async function refreshAfterBooking(options = {}) {
  const booking = state.booking;
  if (!booking.servicoId) return;
  try {
    const today = todayISO();
    const query = '/api/disponibilidade/resumo?servicoId=' + encodeURIComponent(booking.servicoId) +
      '&de=' + encodeURIComponent(today) + '&ate=' + encodeURIComponent(addDaysISO(today, 61));
    const response = await api(query);
    const days = Array.isArray(response && response.dias) ? response.dias : [];
    booking.resumoDias = days.filter(day => day && day.disponivel);
    renderCalendar();
  } catch (_) {
    /* mantém as datas já carregadas */
  }
  if (booking.data) await selectDate(booking.data, { keepHora: options.keepHour === true });
}

async function confirmBooking() {
  hideBookingError();
  const booking = state.booking;

  if (!booking.servicoId) {
    showBookingError('Escolha um serviço para continuar.', null);
    return;
  }
  if (!booking.data) {
    showBookingError('Escolha uma data para continuar.', null);
    return;
  }
  if (!booking.hora) {
    showBookingError('Escolha um horário para continuar.', null);
    return;
  }
  if (!state.user) {
    booking.pendingAfterLogin = true;
    showToast('Entre ou crie sua conta para confirmar o agendamento.', 'info');
    go('entrar');
    return;
  }
  if (state.user.papel !== 'cliente') {
    showBookingError('Contas de equipe não agendam por esta tela. Use o agendamento manual no painel administrativo.', null);
    return;
  }

  const button = $('#btn-confirmar');
  setBusy(button, true, 'Confirmando…');
  try {
    const response = await api('/api/agendamentos', {
      method: 'POST',
      body: {
        servicoId: booking.servicoId,
        barbeiroId: booking.barbeiroId,
        data: booking.data,
        hora: booking.hora
      }
    });
    const agendamento = response && response.agendamento ? response.agendamento : null;
    showConfirmation(agendamento, booking);
    showToast('Agendamento confirmado.', 'sucesso');
    booking.hora = null;
    const summary = $('#resumo-horario');
    if (summary) summary.textContent = 'Nenhum horário selecionado.';
    await refreshAfterBooking();
  } catch (error) {
    if (error.status === 401) {
      booking.pendingAfterLogin = true;
      sessionExpired('Sua sessão expirou. Entre novamente para concluir o agendamento.');
    } else if (error.status === 409) {
      showBookingError('Esse horário acabou de ser ocupado. Atualizamos a disponibilidade — escolha outro horário.', null);
      await refreshAfterBooking({ keepHour: false });
    } else if (error.status === 422) {
      showBookingError(error.message || 'Não foi possível agendar neste horário. Confira a data e tente novamente.', () => confirmBooking());
    } else if (error.status === 403) {
      showBookingError('Você não tem permissão para agendar por esta tela.', null);
    } else if (error.code === 'rede') {
      showBookingError('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.', () => confirmBooking());
    } else {
      showBookingError(errorMessage(error, 'Não foi possível confirmar o agendamento.'), () => confirmBooking());
    }
  } finally {
    setBusy(button, false);
  }
}

function showConfirmation(agendamento, fallback) {
  const box = $('#confirmacao');
  const detail = $('#confirmacao-detalhe');
  if (!box || !detail) return;
  detail.replaceChildren();

  const data = agendamento && agendamento.data ? agendamento.data : fallback.data;
  const hora = agendamento && agendamento.hora ? agendamento.hora : fallback.hora;
  const serviceName = agendamento && agendamento.servico && agendamento.servico.nome
    ? agendamento.servico.nome
    : (fallback.servico && fallback.servico.nome) || 'Serviço';
  const barberName = agendamento && agendamento.barbeiro && agendamento.barbeiro.nome
    ? agendamento.barbeiro.nome
    : (fallback.barbeiroId == null ? 'primeiro barbeiro disponível' : 'barbeiro selecionado');
  const duration = agendamento
    ? (Number(agendamento.duracaoMin) || Number(agendamento.servico && agendamento.servico.duracaoMin) || 0)
    : Number(fallback.servico && fallback.servico.duracaoMin) || 0;

  detail.append(el('p', {
    text: serviceName + ' com ' + barberName + ' em ' + formatDateLong(data) + ' às ' + hora + '.'
  }));
  if (duration) detail.append(el('p', { class: 'muted', text: 'Duração: ' + duration + ' min.' }));
  box.hidden = false;
  try { box.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' }); } catch (_) { /* sem scroll */ }
}

/* ------------------------------ meus agendamentos ------------------------------ */

function renderEntrar() {
  hideMsg($('#login-erro'));
  hideMsg($('#cadastro-erro'));
  const notice = $('#entrar-aviso');
  if (!notice) return;
  if (state.booking.pendingAfterLogin) {
    notice.hidden = false;
    notice.className = 'msg msg-info';
    notice.textContent = 'Entre ou crie sua conta para concluir seu agendamento. Seus dados continuam selecionados.';
    return;
  }
  if (state.user) {
    const name = [state.user.nome, state.user.sobrenome].filter(Boolean).join(' ') || state.user.login || 'conta';
    notice.hidden = false;
    notice.className = 'msg msg-info';
    notice.textContent = 'Você está conectado(a) como ' + name + ' (' + roleLabel(state.user.papel) + ').';
    return;
  }
  notice.hidden = true;
  notice.replaceChildren();
}

function setTabState() {
  const upcoming = $('#filtro-proximos');
  const history = $('#filtro-historico');
  if (upcoming) upcoming.setAttribute('aria-selected', String(state.meus.filtro === 'proximos'));
  if (history) history.setAttribute('aria-selected', String(state.meus.filtro === 'historico'));
}

function renderMeusView() {
  closeReschedule();
  setTabState();
  loadMeus(state.meus.filtro || 'proximos');
}

async function loadMeus(escopo) {
  state.meus.filtro = escopo === 'historico' ? 'historico' : 'proximos';
  setTabState();
  closeReschedule();
  const box = $('#meus-agendamentos');
  if (!box) return;

  if (!state.user) {
    box.replaceChildren();
    const prompt = el('div', { class: 'state' });
    prompt.append(el('span', { text: 'Entre ou crie sua conta para ver seus agendamentos.' }));
    const button = el('button', { type: 'button', class: 'btn btn-gold btn-mini', text: 'Entrar' });
    button.addEventListener('click', () => go('entrar'));
    prompt.append(button);
    box.append(prompt);
    return;
  }

  setLoading(box, 'Carregando agendamentos…');
  const token = ++meusRequestToken;
  try {
    const response = await api('/api/agendamentos?escopo=' + state.meus.filtro);
    if (token !== meusRequestToken) return;
    const list = Array.isArray(response && response.agendamentos) ? response.agendamentos : [];
    renderMeusList(list);
  } catch (error) {
    if (token !== meusRequestToken) return;
    if (error.status === 401) {
      sessionExpired();
      return;
    }
    setError(box, errorMessage(error, 'Não foi possível carregar seus agendamentos.'), () => loadMeus(state.meus.filtro));
  }
}

function metaItem(label, value) {
  const item = el('li');
  item.append(el('span', { class: 'meta-label', text: label + ': ' }));
  item.append(el('strong', { text: value }));
  return item;
}

function agendamentoCard(agendamento, n) {
  const card = el('article', { class: 'card agendamento-card', id: 'agendamento-' + n });
  const head = el('div', { class: 'card-head' });
  head.append(el('h3', {
    class: 'card-title',
    text: agendamento.servico && agendamento.servico.nome ? agendamento.servico.nome : 'Agendamento'
  }));
  const status = agendamento.status || 'agendado';
  head.append(el('span', {
    class: 'status status-' + status,
    text: statusLabel(status),
    attrs: { 'data-status': status, title: statusLabel(status) }
  }));
  card.append(head);

  const meta = el('ul', { class: 'card-meta' });
  meta.append(metaItem('Barbeiro', (agendamento.barbeiro && agendamento.barbeiro.nome) || '—'));
  meta.append(metaItem('Data', formatDateLong(agendamento.data)));
  meta.append(metaItem('Horário', agendamento.hora || '—'));
  const duration = Number(agendamento.duracaoMin) || Number(agendamento.servico && agendamento.servico.duracaoMin) || 0;
  meta.append(metaItem('Duração', duration + ' min'));
  if (state.user && state.user.papel !== 'cliente' && agendamento.cliente) {
    meta.append(metaItem('Cliente', fullName(agendamento.cliente)));
  }
  card.append(meta);

  const actions = el('div', { class: 'card-actions' });
  const reschedule = el('button', {
    type: 'button',
    class: 'btn btn-mini btn-ghost',
    id: 'btn-reagendar-' + n,
    text: 'Reagendar'
  });
  const cancel = el('button', {
    type: 'button',
    class: 'btn btn-mini btn-danger',
    id: 'btn-cancelar-' + n,
    text: 'Cancelar'
  });

  if (status === 'agendado') {
    reschedule.addEventListener('click', () => openReschedule(n));
    cancel.addEventListener('click', () => cancelAppointment(n));
  } else {
    reschedule.disabled = true;
    cancel.disabled = true;
    const reason = 'Somente agendamentos ativos podem ser alterados.';
    reschedule.title = reason;
    cancel.title = reason;
  }
  actions.append(reschedule, cancel);
  card.append(actions);
  return card;
}

function renderMeusList(list) {
  const box = $('#meus-agendamentos');
  if (!box) return;
  state.meus.map = {};
  if (!list.length) {
    setEmpty(box, state.meus.filtro === 'historico'
      ? 'Seu histórico ainda está vazio.'
      : 'Você não tem agendamentos futuros.');
    return;
  }
  box.replaceChildren();
  list.forEach((agendamento, index) => {
    const n = index + 1;
    state.meus.map[n] = agendamento;
    box.append(agendamentoCard(agendamento, n));
  });
}

function closeReschedule() {
  state.reagendando = null;
  const panel = $('#reagendar-panel');
  if (panel) panel.hidden = true;
  hideMsg($('#reagendar-erro'));
  const select = $('#reagendar-hora');
  if (select) select.replaceChildren(el('option', { text: 'Selecione um horário', attrs: { value: '' } }));
}

function openReschedule(n) {
  const agendamento = state.meus.map[n];
  if (!agendamento) return;
  state.reagendando = agendamento;
  const panel = $('#reagendar-panel');
  if (!panel) return;
  panel.hidden = false;
  const title = $('#reagendar-titulo');
  if (title) {
    const serviceName = agendamento.servico && agendamento.servico.nome ? agendamento.servico.nome : 'Agendamento';
    title.textContent = serviceName + ' · ' + formatDateShort(agendamento.data) + ' às ' + agendamento.hora;
  }
  const dateInput = $('#reagendar-data');
  const today = todayISO();
  if (dateInput) {
    dateInput.min = today;
    dateInput.value = agendamento.data && agendamento.data >= today ? agendamento.data : today;
  }
  hideMsg($('#reagendar-erro'));
  loadRescheduleHours();
  try { panel.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' }); } catch (_) { /* sem scroll */ }
}

async function loadRescheduleHours() {
  const select = $('#reagendar-hora');
  if (!select) return;
  const agendamento = state.reagendando;
  if (!agendamento) {
    select.replaceChildren(el('option', { text: 'Selecione um horário', attrs: { value: '' } }));
    return;
  }
  const date = ($('#reagendar-data').value || '');
  const serviceId = agendamento.servico && agendamento.servico.id ? agendamento.servico.id : null;
  const barberId = agendamento.barbeiro && agendamento.barbeiro.id ? agendamento.barbeiro.id : null;

  if (!date || !serviceId) {
    select.replaceChildren(el('option', { text: 'Escolha uma data', attrs: { value: '' } }));
    return;
  }
  select.replaceChildren(el('option', { text: 'Carregando horários…', attrs: { value: '' } }));
  const token = ++reagendarRequestToken;
  try {
    const slots = await fetchAvailability(serviceId, date, barberId);
    if (token !== reagendarRequestToken) return;
    select.replaceChildren();
    if (!slots.length) {
      select.append(el('option', { text: 'Sem horários nesta data', attrs: { value: '' } }));
      return;
    }
    select.append(el('option', { text: 'Selecione um horário', attrs: { value: '' } }));
    slots.forEach(hour => select.append(el('option', { text: hour, attrs: { value: hour } })));
  } catch (error) {
    if (token !== reagendarRequestToken) return;
    select.replaceChildren(el('option', { text: 'Erro ao carregar horários', attrs: { value: '' } }));
    showMsg($('#reagendar-erro'), errorMessage(error, 'Não foi possível carregar os horários.'));
  }
}

async function saveReschedule() {
  const agendamento = state.reagendando;
  if (!agendamento) return;
  const box = $('#reagendar-erro');
  hideMsg(box);
  const dateInput = $('#reagendar-data');
  const hourSelect = $('#reagendar-hora');
  const date = dateInput ? dateInput.value : '';
  const hour = hourSelect ? hourSelect.value : '';

  if (!date) {
    showMsg(box, 'Escolha a nova data.');
    return;
  }
  if (!hour) {
    showMsg(box, 'Escolha o novo horário.');
    return;
  }

  const button = $('#btn-salvar-reagendamento');
  setBusy(button, true, 'Salvando…');
  const body = { data: date, hora: hour };
  if (agendamento.barbeiro && agendamento.barbeiro.id) body.barbeiroId = agendamento.barbeiro.id;

  try {
    await api('/api/agendamentos/' + encodeURIComponent(agendamento.id) + '/reagendar', {
      method: 'PATCH',
      body
    });
    showToast('Agendamento reagendado com sucesso.', 'sucesso');
    closeReschedule();
    loadMeus(state.meus.filtro);
  } catch (error) {
    if (error.status === 401) {
      sessionExpired();
    } else if (error.status === 409) {
      if (error.code === 'estado_invalido') {
        showMsg(box, 'Este agendamento não pode mais ser alterado.');
      } else {
        showMsg(box, 'Esse horário não está mais disponível. Escolha outro.');
        loadRescheduleHours();
      }
    } else if (error.code === 'rede') {
      showRetryMsg(box, errorMessage(error, 'Falha de conexão.'), () => saveReschedule());
    } else {
      showMsg(box, errorMessage(error, 'Não foi possível reagendar.'));
    }
  } finally {
    setBusy(button, false);
  }
}

async function cancelAppointment(n) {
  const agendamento = state.meus.map[n];
  if (!agendamento) return;
  const serviceName = agendamento.servico && agendamento.servico.nome ? agendamento.servico.nome : 'Seu agendamento';
  const ok = await confirmDialog({
    title: 'Cancelar agendamento?',
    text: serviceName + ' em ' + formatDateLong(agendamento.data) + ' às ' + agendamento.hora +
      '. O horário será liberado para outros clientes.',
    confirmLabel: 'Cancelar agendamento',
    danger: true
  });
  if (!ok) return;

  try {
    await api('/api/agendamentos/' + encodeURIComponent(agendamento.id) + '/cancelar', { method: 'PATCH' });
    showToast('Agendamento cancelado.', 'sucesso');
    loadMeus(state.meus.filtro);
  } catch (error) {
    if (error.status === 401) {
      sessionExpired();
      return;
    }
    if (error.status === 409) {
      showToast(error.code === 'estado_invalido'
        ? 'Este agendamento não pode mais ser cancelado.'
        : errorMessage(error, 'Não foi possível cancelar.'), 'erro');
      loadMeus(state.meus.filtro);
      return;
    }
    showToast(errorMessage(error, 'Não foi possível cancelar o agendamento.'), 'erro');
  }
}

/* ------------------------------ painel do barbeiro ------------------------------ */

function renderBarbeiroView() {
  const panel = $('#painel-barbeiro');
  const restricted = $('#barbeiro-restrito');
  if (!panel || !restricted) return;
  const form = $('#form-bloqueio');
  if (form) form.hidden = true;
  hideMsg($('#bloqueio-erro'));

  if (!state.user || state.user.papel !== 'barbeiro') {
    panel.hidden = true;
    restricted.hidden = false;
    const message = $('#barbeiro-restrito-msg');
    if (message) {
      if (!state.user) {
        message.textContent = 'Área exclusiva da equipe. Entre com seu login e senha de barbeiro.';
      } else if (state.user.papel === 'admin') {
        message.textContent = 'Você está conectado(a) como administrador. Esta agenda é exclusiva do barbeiro — use o Painel administrativo.';
      } else {
        message.textContent = 'Você está conectado(a) como cliente. Entre com uma conta de barbeiro para acessar esta agenda.';
      }
    }
    hideMsg($('#login-staff-erro'));
    return;
  }

  panel.hidden = false;
  restricted.hidden = true;
  loadBarbeiroPanel();
}

function barbeiroForbidden(message) {
  const panel = $('#painel-barbeiro');
  const restricted = $('#barbeiro-restrito');
  if (panel) panel.hidden = true;
  if (restricted) restricted.hidden = false;
  const node = $('#barbeiro-restrito-msg');
  if (node) node.textContent = message || 'Acesso negado: sua conta não tem permissão para ver esta agenda.';
}

async function loadBarbeiroPanel() {
  const panel = $('#painel-barbeiro');
  if (!panel || panel.hidden) return;

  const today = todayISO();
  const weekStart = today;
  const weekEnd = addDaysISO(today, 6);
  const todayBox = $('#agenda-hoje');
  const weekBox = $('#agenda-semana');
  const blocksBox = $('#lista-bloqueios');

  setLoading(todayBox, 'Carregando agenda de hoje…');
  setLoading(weekBox, 'Carregando agenda da semana…');
  setLoading(blocksBox, 'Carregando bloqueios…');

  const dateInput = $('#bloqueio-data');
  if (dateInput) {
    dateInput.min = today;
    if (!dateInput.value) dateInput.value = today;
  }

  const token = ++barbeiroRequestToken;
  try {
    const results = await Promise.all([
      api('/api/minha-agenda?data=' + today),
      api('/api/minha-agenda?de=' + weekStart + '&ate=' + weekEnd),
      api('/api/bloqueios?de=' + weekStart + '&ate=' + weekEnd)
    ]);
    if (token !== barbeiroRequestToken) return;

    const dayData = results[0] || {};
    const weekData = results[1] || {};
    const blockData = results[2] || {};

    rowSequence = 0;
    renderAgendaList(todayBox, Array.isArray(dayData.agendamentos) ? dayData.agendamentos : [], {
      empty: 'Nenhum agendamento hoje.'
    });
    renderWeekAgenda(weekBox, Array.isArray(weekData.agendamentos) ? weekData.agendamentos : []);
    renderBlockList(blocksBox, Array.isArray(blockData.bloqueios) ? blockData.bloqueios : []);
  } catch (error) {
    if (token !== barbeiroRequestToken) return;
    if (error.status === 401) {
      sessionExpired();
      return;
    }
    if (error.status === 403) {
      barbeiroForbidden();
      return;
    }
    const retry = () => loadBarbeiroPanel();
    setError(todayBox, errorMessage(error, 'Não foi possível carregar a agenda.'), retry);
    setError(weekBox, errorMessage(error, 'Não foi possível carregar a agenda.'), retry);
    setError(blocksBox, errorMessage(error, 'Não foi possível carregar os bloqueios.'), retry);
  }
}

function renderAgendaList(container, list, options = {}) {
  if (!container) return;
  container.replaceChildren();
  const sorted = list.slice().sort(byStart);
  if (!sorted.length) {
    container.append(el('p', { class: 'state', text: options.empty || 'Nenhum agendamento.' }));
    return;
  }
  const wrap = el('div', { class: 'agenda-list' });
  sorted.forEach(item => wrap.append(agendaRow(item, false)));
  container.append(wrap);
}

function renderWeekAgenda(container, list) {
  if (!container) return;
  container.replaceChildren();
  const sorted = list.slice().sort(byStart);
  if (!sorted.length) {
    container.append(el('p', { class: 'state', text: 'Nenhum agendamento nesta semana.' }));
    return;
  }
  const groups = new Map();
  sorted.forEach(item => {
    const key = item.data || '—';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  Array.from(groups.keys()).sort().forEach(date => {
    const section = el('section', { class: 'agenda-day' });
    section.append(el('h3', { class: 'agenda-day-title', text: formatDateLong(date) }));
    const wrap = el('div', { class: 'agenda-list' });
    groups.get(date).forEach(item => wrap.append(agendaRow(item, false)));
    section.append(wrap);
    container.append(section);
  });
}

function agendaRow(item, showDate) {
  const n = ++rowSequence;
  const row = el('div', { class: 'agenda-item' });

  const time = el('div', { class: 'agenda-time' });
  time.append(el('span', { text: item.hora || '—' }));
  const duration = Number(item.duracaoMin) || Number(item.servico && item.servico.duracaoMin) || 0;
  time.append(el('small', { text: duration + ' min' }));
  row.append(time);

  const info = el('div', { class: 'agenda-info' });
  info.append(el('strong', { text: item.cliente ? fullName(item.cliente) : 'Cliente' }));
  const serviceName = item.servico && item.servico.nome ? item.servico.nome : 'Serviço';
  info.append(el('span', { text: showDate && item.data ? formatDateShort(item.data) + ' · ' + serviceName : serviceName }));
  row.append(info);

  const status = item.status || 'agendado';
  row.append(el('span', {
    class: 'status status-' + status,
    text: statusLabel(status),
    attrs: { 'data-status': status, title: statusLabel(status) }
  }));

  const actions = el('div', { class: 'agenda-actions' });
  if (status === 'agendado') {
    const done = el('button', { type: 'button', class: 'btn btn-mini btn-gold', id: 'btn-concluir-' + n, text: 'Concluir' });
    done.addEventListener('click', () => updateAppointmentStatus(item.id, 'concluido', done));
    const missed = el('button', { type: 'button', class: 'btn btn-mini btn-ghost', id: 'btn-faltou-' + n, text: 'Faltou' });
    missed.addEventListener('click', () => updateAppointmentStatus(item.id, 'faltou', missed));
    actions.append(done, missed);
  }
  row.append(actions);
  return row;
}

async function updateAppointmentStatus(id, status, button) {
  setBusy(button, true);
  try {
    await api('/api/agendamentos/' + encodeURIComponent(id) + '/status', {
      method: 'PATCH',
      body: { status }
    });
    showToast(status === 'concluido' ? 'Atendimento concluído.' : 'Falta registrada.', 'sucesso');
    await loadBarbeiroPanel();
  } catch (error) {
    if (error.status === 401) {
      sessionExpired();
      return;
    }
    if (error.status === 403) {
      showToast('Sem permissão para alterar este agendamento.', 'erro');
    } else if (error.status === 409) {
      showToast('Este agendamento não pode mais ser alterado.', 'erro');
      await loadBarbeiroPanel();
    } else {
      showToast(errorMessage(error, 'Não foi possível atualizar o status.'), 'erro');
      setBusy(button, false);
    }
  }
}

function renderBlockList(container, list) {
  if (!container) return;
  container.replaceChildren();
  const sorted = list.slice().sort((a, b) => {
    const left = String((a && a.data) || '') + String((a && a.horaInicio) || '');
    const right = String((b && b.data) || '') + String((b && b.horaInicio) || '');
    return left.localeCompare(right);
  });
  state.barbeiro.bloqueios = sorted;
  if (!sorted.length) {
    container.append(el('p', { class: 'state', text: 'Nenhum bloqueio cadastrado nesta semana.' }));
    return;
  }
  const wrap = el('div', { class: 'agenda-list' });
  sorted.forEach((block, index) => {
    const row = el('div', { class: 'agenda-item bloqueio-item' });
    const time = el('div', { class: 'agenda-time' });
    time.append(el('span', { text: (block.horaInicio || '—') + '–' + (block.horaFim || '') }));
    row.append(time);

    const info = el('div', { class: 'agenda-info' });
    info.append(el('strong', { text: block.motivo || 'Bloqueio' }));
    info.append(el('span', { text: formatDateLong(block.data) }));
    row.append(info);

    const actions = el('div', { class: 'agenda-actions' });
    const remove = el('button', {
      type: 'button',
      class: 'btn btn-mini btn-ghost',
      id: 'btn-remover-bloqueio-' + (index + 1),
      text: 'Remover'
    });
    remove.addEventListener('click', () => removeBlock(block, remove));
    actions.append(remove);
    row.append(actions);
    wrap.append(row);
  });
  container.append(wrap);
}

function toggleBlockForm() {
  const form = $('#form-bloqueio');
  if (!form) return;
  const open = form.hidden;
  form.hidden = !open;
  if (!open) return;
  const today = todayISO();
  const date = $('#bloqueio-data');
  if (date) {
    date.min = today;
    if (!date.value) date.value = today;
  }
  const start = $('#bloqueio-inicio');
  if (start && !start.value) start.value = '09:00';
  const end = $('#bloqueio-fim');
  if (end && !end.value) end.value = '10:00';
  hideMsg($('#bloqueio-erro'));
  if (date) {
    try { date.focus({ preventScroll: true }); } catch (_) { date.focus(); }
  }
}

async function saveBlock() {
  const box = $('#bloqueio-erro');
  hideMsg(box);
  const date = $('#bloqueio-data').value;
  const start = $('#bloqueio-inicio').value;
  const end = $('#bloqueio-fim').value;
  const reason = ($('#bloqueio-motivo').value || '').trim();

  if (!date) {
    showMsg(box, 'Escolha a data do bloqueio.');
    return;
  }
  if (!start || !end) {
    showMsg(box, 'Informe o início e o fim do bloqueio.');
    return;
  }
  if (start >= end) {
    showMsg(box, 'O horário final deve ser depois do horário inicial.');
    return;
  }
  if (!reason) {
    showMsg(box, 'Descreva o motivo do bloqueio.');
    return;
  }

  const button = $('#btn-salvar-bloqueio');
  setBusy(button, true, 'Salvando…');
  try {
    await api('/api/bloqueios', {
      method: 'POST',
      body: { data: date, horaInicio: start, horaFim: end, motivo: reason }
    });
    showToast('Bloqueio salvo.', 'sucesso');
    const form = $('#form-bloqueio');
    if (form) form.hidden = true;
    const reasonInput = $('#bloqueio-motivo');
    if (reasonInput) reasonInput.value = '';
    await loadBarbeiroPanel();
  } catch (error) {
    if (error.status === 401) {
      sessionExpired();
    } else if (error.status === 409) {
      showMsg(box, 'Este intervalo conflita com um agendamento existente. Escolha outro horário.');
    } else if (error.status === 403) {
      showMsg(box, 'Você não tem permissão para criar este bloqueio.');
    } else if (error.code === 'rede') {
      showRetryMsg(box, errorMessage(error, 'Falha de conexão.'), () => saveBlock());
    } else {
      showMsg(box, errorMessage(error, 'Não foi possível salvar o bloqueio.'));
    }
  } finally {
    setBusy(button, false);
  }
}

async function removeBlock(block, button) {
  const ok = await confirmDialog({
    title: 'Remover bloqueio?',
    text: formatDateLong(block.data) + ' das ' + block.horaInicio + ' às ' + block.horaFim +
      (block.motivo ? ' · ' + block.motivo : ''),
    confirmLabel: 'Remover bloqueio',
    danger: true
  });
  if (!ok) return;
  setBusy(button, true);
  try {
    await api('/api/bloqueios/' + encodeURIComponent(block.id), { method: 'DELETE' });
    showToast('Bloqueio removido.', 'sucesso');
    await loadBarbeiroPanel();
  } catch (error) {
    if (error.status === 401) {
      sessionExpired();
      return;
    }
    if (error.status === 403) {
      showToast('Sem permissão para remover este bloqueio.', 'erro');
    } else {
      showToast(errorMessage(error, 'Não foi possível remover o bloqueio.'), 'erro');
    }
    setBusy(button, false);
  }
}

/* ------------------------------ painel administrativo ------------------------------ */

function normalizeList(value, key) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return Array.isArray(value[key]) ? value[key] : [];
}

function renderAdminView() {
  const panel = $('#painel-admin');
  const restricted = $('#admin-restrito');
  if (!panel || !restricted) return;

  if (!state.user) {
    panel.hidden = true;
    restricted.hidden = false;
    const node = $('#admin-restrito-msg');
    if (node) node.textContent = 'Acesso restrito. Entre com uma conta de administrador.';
    return;
  }
  if (state.user.papel !== 'admin') {
    panel.hidden = true;
    restricted.hidden = false;
    const node = $('#admin-restrito-msg');
    if (node) node.textContent = 'Acesso restrito: sua conta não tem permissão de administrador.';
    return;
  }

  panel.hidden = false;
  restricted.hidden = true;
  hideMsg($('#admin-erro'));
  hideMsg($('#manual-erro'));
  hideMsg($('#feriado-erro'));
  const form = $('#form-manual');
  if (form) form.hidden = true;
  loadAdminData();
}

function adminForbidden(message) {
  const panel = $('#painel-admin');
  const restricted = $('#admin-restrito');
  if (panel) panel.hidden = true;
  if (restricted) restricted.hidden = false;
  const node = $('#admin-restrito-msg');
  if (node) node.textContent = message || 'Acesso negado: sua conta não tem permissão de administrador.';
}

function paintKpis(kpis) {
  const data = kpis || {};
  const set = (selector, value) => {
    const node = $(selector);
    if (node) node.textContent = String(value);
  };
  set('#kpi-dia', count(data.agendamentosDia));
  set('#kpi-concluidos', count(data.concluidos));
  set('#kpi-cancelados', count(data.cancelados));
  set('#kpi-clientes', count(data.clientesTotal));
  const revenue = $('#kpi-receita');
  if (revenue) revenue.textContent = formatBRL(data.receitaEstimadaCentavos);
}

async function loadAdminData() {
  const panel = $('#painel-admin');
  if (!panel || panel.hidden) return;
  hideMsg($('#admin-erro'));

  const today = todayISO();
  const agendasBox = $('#admin-agendas');
  setLoading(agendasBox, 'Carregando agendas…');
  setLoading($('#admin-barbeiros'), 'Carregando barbeiros…');
  setLoading($('#admin-servicos'), 'Carregando serviços…');
  setLoading($('#admin-clientes'), 'Carregando clientes…');
  setLoading($('#admin-feriados'), 'Carregando feriados…');
  ['#kpi-dia', '#kpi-concluidos', '#kpi-cancelados', '#kpi-clientes', '#kpi-receita'].forEach(selector => {
    const node = $(selector);
    if (node) node.textContent = '…';
  });

  const token = ++adminRequestToken;
  const results = await Promise.allSettled([
    api('/api/admin/dashboard?data=' + today),
    api('/api/agendamentos?data=' + today),
    api('/api/barbeiros'),
    api('/api/servicos'),
    api('/api/admin/clientes'),
    api('/api/configuracoes')
  ]);
  if (token !== adminRequestToken) return;

  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    if (result.status === 'rejected') {
      const error = result.reason;
      if (error && error.status === 401) {
        sessionExpired();
        return;
      }
      if (error && error.status === 403) {
        adminForbidden();
        return;
      }
    }
  }

  const dashboard = results[0];
  const bookings = results[1];
  const barbersResult = results[2];
  const servicesResult = results[3];
  const clientsResult = results[4];
  const configResult = results[5];

  if (dashboard.status === 'fulfilled') {
    paintKpis(dashboard.value && dashboard.value.kpis ? dashboard.value.kpis : {});
  } else {
    paintKpis({});
    showMsg($('#admin-erro'), 'Não foi possível carregar os indicadores: ' + errorMessage(dashboard.reason, 'erro inesperado.'));
  }

  const barbers = barbersResult.status === 'fulfilled' ? normalizeList(barbersResult.value, 'barbeiros') : [];
  const services = servicesResult.status === 'fulfilled' ? normalizeList(servicesResult.value, 'servicos') : [];
  const clients = clientsResult.status === 'fulfilled' ? normalizeList(clientsResult.value, 'clientes') : [];
  state.admin.barbeiros = barbers;
  state.admin.servicos = services;
  state.admin.clientes = clients;

  if (bookings.status === 'fulfilled' && barbersResult.status === 'fulfilled') {
    paintAdminAgendas(normalizeList(bookings.value, 'agendamentos'), barbers);
  } else {
    setError(agendasBox, 'Não foi possível carregar as agendas de hoje.', () => loadAdminData());
  }

  if (barbersResult.status === 'fulfilled') {
    paintAdminBarbers(barbers);
  } else {
    setError($('#admin-barbeiros'), 'Não foi possível carregar os barbeiros.', () => loadAdminData());
  }

  if (servicesResult.status === 'fulfilled') {
    paintAdminServices(services);
  } else {
    setError($('#admin-servicos'), 'Não foi possível carregar os serviços.', () => loadAdminData());
  }

  if (clientsResult.status === 'fulfilled') {
    paintAdminClients(clients);
  } else {
    setError($('#admin-clientes'), 'Não foi possível carregar os clientes.', () => loadAdminData());
  }

  if (configResult.status === 'fulfilled') {
    paintAdminHolidays(configResult.value || {});
  } else {
    setError($('#admin-feriados'), 'Não foi possível carregar os feriados.', () => loadAdminData());
  }

  populateManualSelects(clients, services, barbers);
  const manualForm = $('#form-manual');
  if (manualForm && !manualForm.hidden) updateManualHours();
}

function paintAdminAgendas(bookings, barbers) {
  const box = $('#admin-agendas');
  if (!box) return;
  box.replaceChildren();

  const grouped = new Map();
  bookings.forEach(item => {
    if (!item) return;
    const id = item.barbeiro && item.barbeiro.id != null ? item.barbeiro.id : 0;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(item);
  });

  const columns = barbers.slice();
  const known = new Set(columns.map(barber => barber.id));
  grouped.forEach((items, id) => {
    if (known.has(id)) return;
    const first = items[0];
    columns.push({ id, nome: (first && first.barbeiro && first.barbeiro.nome) || 'Barbeiro' });
    known.add(id);
  });
  columns.sort((a, b) => Number(a.id) - Number(b.id));

  if (!columns.length) {
    setEmpty(box, 'Nenhum barbeiro cadastrado.');
    return;
  }

  columns.forEach(barber => {
    const column = el('div', { class: 'admin-agenda-col' });
    const head = el('div', { class: 'admin-agenda-head' });
    head.append(el('h3', { text: barber.nome || 'Barbeiro' }));
    const items = (grouped.get(barber.id) || []).slice().sort(byStart);
    head.append(el('span', { class: 'count', text: String(items.length) }));
    column.append(head);

    if (!items.length) {
      column.append(el('p', { class: 'state small', text: 'Sem agendamentos hoje.' }));
    } else {
      const list = el('ul', { class: 'admin-agenda-list' });
      items.forEach(item => {
        const row = el('li');
        row.append(el('span', { class: 'aa-time', text: item.hora || '—' }));
        const info = el('span', { class: 'aa-info' });
        info.append(el('strong', { text: item.cliente ? fullName(item.cliente) : 'Cliente' }));
        const serviceName = item.servico && item.servico.nome ? item.servico.nome : 'Serviço';
        const duration = Number(item.duracaoMin) || Number(item.servico && item.servico.duracaoMin) || 0;
        info.append(el('small', { text: serviceName + (duration ? ' · ' + duration + ' min' : '') }));
        row.append(info);
        const status = item.status || 'agendado';
        row.append(el('span', {
          class: 'status status-' + status,
          text: statusLabel(status),
          attrs: { 'data-status': status, title: statusLabel(status) }
        }));
        list.append(row);
      });
      column.append(list);
    }
    box.append(column);
  });
}

function paintAdminBarbers(list) {
  const box = $('#admin-barbeiros');
  if (!box) return;
  box.replaceChildren();
  if (!list.length) {
    box.append(el('p', { class: 'state small', text: 'Nenhum barbeiro cadastrado.' }));
    return;
  }
  const ul = el('ul', { class: 'admin-list' });
  list.forEach(barber => {
    const item = el('li');
    const main = el('div', { class: 'admin-item-main' });
    main.append(avatarFor(barber, true));
    const text = el('div');
    text.append(el('strong', { text: barber.nome || 'Barbeiro' }));
    text.append(el('small', { text: listText(barber.especialidades) || '—' }));
    main.append(text);
    item.append(main);
    item.append(el('span', {
      class: 'badge ' + (barber.ativo === false ? 'badge-off' : 'badge-on'),
      text: barber.ativo === false ? 'Inativo' : 'Ativo'
    }));
    ul.append(item);
  });
  box.append(ul);
}

function paintAdminServices(list) {
  const box = $('#admin-servicos');
  if (!box) return;
  box.replaceChildren();
  if (!list.length) {
    box.append(el('p', { class: 'state small', text: 'Nenhum serviço cadastrado.' }));
    return;
  }
  const ul = el('ul', { class: 'admin-list' });
  list.forEach(service => {
    const item = el('li');
    const main = el('div', { class: 'admin-item-main' });
    const text = el('div');
    text.append(el('strong', { text: service.nome || 'Serviço' }));
    text.append(el('small', {
      text: formatBRL(service.precoCentavos) + ' · ' + (Number(service.duracaoMin) || 0) + ' min'
    }));
    main.append(text);
    item.append(main);
    item.append(el('span', {
      class: 'badge ' + (service.ativo === false ? 'badge-off' : 'badge-on'),
      text: service.ativo === false ? 'Inativo' : 'Ativo'
    }));
    ul.append(item);
  });
  box.append(ul);
}

function paintAdminClients(list) {
  const box = $('#admin-clientes');
  if (!box) return;
  box.replaceChildren();
  if (!list.length) {
    box.append(el('p', { class: 'state small', text: 'Nenhum cliente cadastrado.' }));
    return;
  }
  const ul = el('ul', { class: 'admin-list' });
  list.forEach(client => {
    const item = el('li');
    const main = el('div', { class: 'admin-item-main' });
    const text = el('div');
    text.append(el('strong', { text: fullName(client) }));
    const total = count(client.agendamentos);
    const since = client.criadoEm ? ' · desde ' + formatDateTimeShort(client.criadoEm) : '';
    text.append(el('small', {
      text: formatPhoneDisplay(client.telefone) + ' · ' + total +
        (total === 1 ? ' agendamento' : ' agendamentos') + since
    }));
    main.append(text);
    item.append(main);
    ul.append(item);
  });
  box.append(ul);
}

function paintAdminHolidays(config) {
  const box = $('#admin-feriados');
  if (!box) return;
  box.replaceChildren();
  const holidays = config && Array.isArray(config.feriados) ? config.feriados.slice() : [];
  holidays.forEach((holiday, index) => {
    if (typeof holiday === 'string') holidays[index] = { data: holiday, descricao: '' };
  });
  holidays.sort((a, b) => String((a && a.data) || '').localeCompare(String((b && b.data) || '')));
  if (!holidays.length) {
    box.append(el('p', { class: 'state small', text: 'Nenhum feriado cadastrado.' }));
    return;
  }
  const ul = el('ul', { class: 'admin-list' });
  holidays.forEach(holiday => {
    const item = el('li');
    const main = el('div', { class: 'admin-item-main' });
    const text = el('div');
    text.append(el('strong', { text: formatDateFull(holiday.data) }));
    text.append(el('small', { text: holiday.descricao || 'Feriado' }));
    main.append(text);
    item.append(main);
    const remove = el('button', { type: 'button', class: 'btn btn-mini btn-ghost', text: 'Remover' });
    remove.addEventListener('click', () => removeHoliday(holiday, remove));
    item.append(remove);
    ul.append(item);
  });
  box.append(ul);
}

function populateManualSelects(clients, services, barbers) {
  const clientSelect = $('#manual-cliente');
  if (clientSelect) {
    const previous = clientSelect.value;
    clientSelect.replaceChildren(el('option', { text: 'Selecione o cliente', attrs: { value: '' } }));
    if (!clients.length) {
      clientSelect.append(el('option', { text: 'Nenhum cliente cadastrado', attrs: { value: '' } }));
    } else {
      clients.forEach(client => {
        clientSelect.append(el('option', {
          text: fullName(client) + ' · ' + formatPhoneDisplay(client.telefone),
          attrs: { value: String(client.id) }
        }));
      });
    }
    if (previous && Array.from(clientSelect.options).some(option => option.value === previous)) {
      clientSelect.value = previous;
    }
  }

  const serviceSelect = $('#manual-servico');
  if (serviceSelect) {
    const previous = serviceSelect.value;
    serviceSelect.replaceChildren(el('option', { text: 'Selecione o serviço', attrs: { value: '' } }));
    const active = services.filter(service => service && service.ativo !== false);
    if (!active.length) {
      serviceSelect.append(el('option', { text: 'Nenhum serviço disponível', attrs: { value: '' } }));
    } else {
      active.forEach(service => {
        serviceSelect.append(el('option', {
          text: (service.nome || 'Serviço') + ' · ' + formatBRL(service.precoCentavos) + ' · ' + (Number(service.duracaoMin) || 0) + ' min',
          attrs: { value: String(service.id) }
        }));
      });
    }
    if (previous && Array.from(serviceSelect.options).some(option => option.value === previous)) {
      serviceSelect.value = previous;
    }
  }

  const barberSelect = $('#manual-barbeiro');
  if (barberSelect) {
    const previous = barberSelect.value;
    barberSelect.replaceChildren(el('option', { text: 'Qualquer barbeiro', attrs: { value: '' } }));
    barbers.forEach(barber => {
      barberSelect.append(el('option', {
        text: barber.nome || 'Barbeiro',
        attrs: { value: String(barber.id) }
      }));
    });
    if (previous && Array.from(barberSelect.options).some(option => option.value === previous)) {
      barberSelect.value = previous;
    }
  }

  const dateInput = $('#manual-data');
  if (dateInput) {
    dateInput.min = todayISO();
    if (!dateInput.value) dateInput.value = todayISO();
  }
}

function toggleManualForm(force) {
  const form = $('#form-manual');
  if (!form) return;
  const shouldOpen = typeof force === 'boolean' ? force : form.hidden;
  form.hidden = !shouldOpen;
  if (!shouldOpen) return;
  hideMsg($('#manual-erro'));
  const dateInput = $('#manual-data');
  if (dateInput) {
    dateInput.min = todayISO();
    if (!dateInput.value) dateInput.value = todayISO();
  }
  updateManualHours();
  try { form.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' }); } catch (_) { /* sem scroll */ }
}

async function updateManualHours() {
  const select = $('#manual-hora');
  if (!select) return;
  const serviceId = Number($('#manual-servico').value) || 0;
  const date = $('#manual-data').value;
  const barberValue = $('#manual-barbeiro').value;

  if (!serviceId || !date) {
    select.replaceChildren(el('option', { text: 'Escolha serviço e data', attrs: { value: '' } }));
    return;
  }

  const token = ++manualRequestToken;
  select.replaceChildren(el('option', { text: 'Carregando horários…', attrs: { value: '' } }));
  try {
    const slots = await fetchAvailability(serviceId, date, barberValue === '' ? null : Number(barberValue));
    if (token !== manualRequestToken) return;
    select.replaceChildren();
    if (!slots.length) {
      select.append(el('option', { text: 'Sem horários disponíveis', attrs: { value: '' } }));
      return;
    }
    select.append(el('option', { text: 'Selecione o horário', attrs: { value: '' } }));
    slots.forEach(hour => select.append(el('option', { text: hour, attrs: { value: hour } })));
  } catch (error) {
    if (token !== manualRequestToken) return;
    select.replaceChildren(el('option', { text: 'Erro ao carregar horários', attrs: { value: '' } }));
    showMsg($('#manual-erro'), errorMessage(error, 'Não foi possível carregar os horários.'));
  }
}

async function saveManual() {
  const box = $('#manual-erro');
  hideMsg(box);
  const clientId = Number($('#manual-cliente').value) || 0;
  const serviceId = Number($('#manual-servico').value) || 0;
  const date = $('#manual-data').value;
  const hour = $('#manual-hora').value;
  const barberRaw = $('#manual-barbeiro').value;

  if (!clientId) {
    showMsg(box, 'Selecione o cliente.');
    return;
  }
  if (!serviceId) {
    showMsg(box, 'Selecione o serviço.');
    return;
  }
  if (!date) {
    showMsg(box, 'Informe a data.');
    return;
  }
  if (!hour) {
    showMsg(box, 'Selecione o horário.');
    return;
  }

  const button = $('#btn-manual-salvar');
  setBusy(button, true, 'Salvando…');
  try {
    await api('/api/agendamentos', {
      method: 'POST',
      body: {
        clienteId: clientId,
        servicoId: serviceId,
        barbeiroId: barberRaw === '' ? null : Number(barberRaw),
        data: date,
        hora: hour
      }
    });
    showToast('Agendamento criado com sucesso.', 'sucesso');
    await loadAdminData();
  } catch (error) {
    if (error.status === 401) {
      sessionExpired();
    } else if (error.status === 403) {
      adminForbidden();
    } else if (error.status === 409) {
      showMsg(box, error.code === 'horario_indisponivel'
        ? 'Esse horário acabou de ser ocupado. Escolha outro.'
        : errorMessage(error, 'Não foi possível agendar.'));
      updateManualHours();
    } else if (error.status === 422) {
      showMsg(box, error.message || 'Confira os dados do agendamento.');
    } else if (error.code === 'rede') {
      showRetryMsg(box, errorMessage(error, 'Falha de conexão.'), () => saveManual());
    } else {
      showMsg(box, errorMessage(error, 'Não foi possível criar o agendamento.'));
    }
  } finally {
    setBusy(button, false);
  }
}

async function addHoliday() {
  const box = $('#feriado-erro');
  hideMsg(box);
  const date = $('#feriado-data').value;
  const description = ($('#feriado-descricao').value || '').trim();

  if (!date) {
    showMsg(box, 'Informe a data do feriado.');
    return;
  }
  if (!description) {
    showMsg(box, 'Descreva o feriado.');
    return;
  }

  const button = $('#btn-add-feriado');
  setBusy(button, true, 'Adicionando…');
  try {
    await api('/api/admin/feriados', { method: 'POST', body: { data: date, descricao: description } });
    showToast('Feriado adicionado.', 'sucesso');
    const dateInput = $('#feriado-data');
    const descriptionInput = $('#feriado-descricao');
    if (dateInput) dateInput.value = '';
    if (descriptionInput) descriptionInput.value = '';
    cache.config = null;
    cache.pConfig = null;
    const config = await getConfig(true);
    paintAdminHolidays(config);
    if (state.view === 'inicio') paintHomeInfo(config);
  } catch (error) {
    if (error.status === 401) {
      sessionExpired();
    } else if (error.status === 403) {
      adminForbidden();
    } else if (error.status === 409) {
      showMsg(box, error.message || 'Este feriado já está cadastrado.');
    } else if (error.status === 422) {
      showMsg(box, error.message || 'Confira a data e a descrição.');
    } else if (error.code === 'rede') {
      showRetryMsg(box, errorMessage(error, 'Falha de conexão.'), () => addHoliday());
    } else {
      showMsg(box, errorMessage(error, 'Não foi possível adicionar o feriado.'));
    }
  } finally {
    setBusy(button, false);
  }
}

async function removeHoliday(holiday, button) {
  const ok = await confirmDialog({
    title: 'Remover feriado?',
    text: formatDateFull(holiday.data) + (holiday.descricao ? ' · ' + holiday.descricao : ''),
    confirmLabel: 'Remover feriado',
    danger: true
  });
  if (!ok) return;
  setBusy(button, true);
  try {
    await api('/api/admin/feriados/' + encodeURIComponent(holiday.data), { method: 'DELETE' });
    showToast('Feriado removido.', 'sucesso');
    cache.config = null;
    cache.pConfig = null;
    const config = await getConfig(true);
    paintAdminHolidays(config);
    if (state.view === 'inicio') paintHomeInfo(config);
  } catch (error) {
    if (error.status === 401) {
      sessionExpired();
      return;
    }
    if (error.status === 403) {
      adminForbidden();
      return;
    }
    showToast(errorMessage(error, 'Não foi possível remover o feriado.'), 'erro');
    setBusy(button, false);
  }
}

async function resetDemo() {
  const ok = await confirmDialog({
    title: 'Restaurar demonstração?',
    text: 'Todos os agendamentos, bloqueios e cadastros atuais serão apagados. Os dados originais de demonstração serão recriados. Esta ação não pode ser desfeita.',
    confirmLabel: 'Restaurar dados',
    danger: true
  });
  if (!ok) return;

  const button = $('#btn-reset-demo');
  setBusy(button, true, 'Restaurando…');
  try {
    await api('/api/admin/reset-demo', { method: 'POST' });
    clearCatalogCache();
    state.meus.map = {};
    state.barbeiro.bloqueios = [];

    let me = null;
    let meError = null;
    try {
      me = await api('/api/me');
    } catch (error) {
      meError = error;
    }

    if (meError && meError.status === 401) {
      state.user = null;
      updateHeader();
      showToast('Demonstração restaurada. Entre novamente.', 'info');
      go('entrar');
      return;
    }
    if (me && me.usuario) {
      state.user = me.usuario;
      updateHeader();
    }
    if (state.user && state.user.papel !== 'admin') {
      showToast('Dados de demonstração restaurados.', 'sucesso');
      go('inicio');
      return;
    }
    showToast('Dados de demonstração restaurados.', 'sucesso');
    await loadAdminData();
  } catch (error) {
    if (error.status === 401) {
      sessionExpired();
    } else if (error.status === 403) {
      adminForbidden();
    } else if (error.code === 'rede') {
      showRetryMsg($('#admin-erro'), errorMessage(error, 'Falha de conexão.'), () => resetDemo());
    } else {
      showToast(errorMessage(error, 'Não foi possível restaurar a demonstração.'), 'erro');
    }
  } finally {
    setBusy(button, false);
  }
}

/* ------------------------------ configuração de eventos ------------------------------ */

function setupRouter() {
  window.addEventListener('hashchange', () => {
    if (appReady) renderRoute(parseHash());
  });
  $$('#nav-principal .nav-btn').forEach(button => {
    button.addEventListener('click', () => go(button.dataset.view));
  });
}

function setupGlobal() {
  const logoutButton = $('#btn-sair');
  if (logoutButton) logoutButton.addEventListener('click', logout);

  document.addEventListener('click', event => {
    const origin = event.target instanceof Element ? event.target : null;
    const target = origin ? origin.closest('[data-goto]') : null;
    if (!target) return;
    event.preventDefault();
    go(target.dataset.goto);
  });
}

function setupAuth() {
  const cadastroPhone = $('#cadastro-telefone');
  if (cadastroPhone) {
    cadastroPhone.addEventListener('input', () => {
      cadastroPhone.value = maskPhone(cadastroPhone.value);
      cadastroPhone.removeAttribute('aria-invalid');
    });
  }
  const loginPhone = $('#login-telefone');
  if (loginPhone) {
    loginPhone.addEventListener('input', () => {
      loginPhone.value = maskPhone(loginPhone.value);
      loginPhone.removeAttribute('aria-invalid');
    });
  }
  $$('#cadastro-pin, #login-pin').forEach(input => {
    input.addEventListener('input', () => {
      input.value = digits(input.value).slice(0, 6);
      input.removeAttribute('aria-invalid');
    });
  });
  $$('#form-cadastro input, #form-login-cliente input, #form-staff input').forEach(input => {
    input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
  });

  const cadastroForm = $('#form-cadastro');
  if (cadastroForm) {
    cadastroForm.addEventListener('submit', event => {
      event.preventDefault();
      submitCadastro();
    });
  }
  const loginForm = $('#form-login-cliente');
  if (loginForm) {
    loginForm.addEventListener('submit', event => {
      event.preventDefault();
      submitLoginCliente();
    });
  }
  const staffForm = $('#form-staff');
  if (staffForm) {
    staffForm.addEventListener('submit', event => {
      event.preventDefault();
      submitLoginStaff();
    });
  }
}

function setupBooking() {
  const heroButton = $('#btn-agendar');
  if (heroButton) heroButton.addEventListener('click', () => go('agendar'));

  const anyBarber = $('#barbeiro-qualquer');
  if (anyBarber) anyBarber.addEventListener('click', () => selectBarber(null));

  const nextDate = $('#btn-proxima-data');
  if (nextDate) nextDate.addEventListener('click', onNextDate);

  const nextHour = $('#btn-proximo-horario');
  if (nextHour) nextHour.addEventListener('click', onNextHour);

  const confirm = $('#btn-confirmar');
  if (confirm) confirm.addEventListener('click', confirmBooking);
}

function setupMeus() {
  const upcoming = $('#filtro-proximos');
  if (upcoming) upcoming.addEventListener('click', () => loadMeus('proximos'));
  const history = $('#filtro-historico');
  if (history) history.addEventListener('click', () => loadMeus('historico'));

  const dateInput = $('#reagendar-data');
  if (dateInput) {
    dateInput.addEventListener('change', () => {
      hideMsg($('#reagendar-erro'));
      loadRescheduleHours();
    });
  }
  const saveButton = $('#btn-salvar-reagendamento');
  if (saveButton) saveButton.addEventListener('click', saveReschedule);
  const closeButton = $('#btn-fechar-reagendar');
  if (closeButton) closeButton.addEventListener('click', closeReschedule);
}

function setupBarbeiro() {
  const blockButton = $('#btn-bloquear');
  if (blockButton) blockButton.addEventListener('click', toggleBlockForm);
  const blockForm = $('#form-bloqueio');
  if (blockForm) {
    blockForm.addEventListener('submit', event => {
      event.preventDefault();
      saveBlock();
    });
  }
}

function setupAdmin() {
  const newButton = $('#btn-novo-agendamento');
  if (newButton) newButton.addEventListener('click', () => toggleManualForm());

  const manualForm = $('#form-manual');
  if (manualForm) {
    manualForm.addEventListener('submit', event => {
      event.preventDefault();
      saveManual();
    });
  }

  ['#manual-cliente', '#manual-servico', '#manual-barbeiro', '#manual-data'].forEach(selector => {
    const node = $(selector);
    if (!node) return;
    node.addEventListener('change', () => {
      hideMsg($('#manual-erro'));
      if (selector !== '#manual-cliente') updateManualHours();
    });
  });

  const holidayForm = $('#form-feriado');
  if (holidayForm) {
    holidayForm.addEventListener('submit', event => {
      event.preventDefault();
      addHoliday();
    });
  }

  const resetButton = $('#btn-reset-demo');
  if (resetButton) resetButton.addEventListener('click', resetDemo);
}

function setupModal() {
  const overlay = $('#modal-overlay');
  if (!overlay) return;
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeModal(false);
  });
  const cancel = $('#modal-cancelar');
  if (cancel) cancel.addEventListener('click', () => closeModal(false));
  const confirm = $('#modal-confirmar');
  if (confirm) confirm.addEventListener('click', () => closeModal(true));

  document.addEventListener('keydown', event => {
    if (overlay.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [$('#modal-cancelar'), $('#modal-confirmar')].filter(Boolean);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

/* ------------------------------ inicialização ------------------------------ */

async function init() {
  setupRouter();
  setupGlobal();
  setupAuth();
  setupBooking();
  setupMeus();
  setupBarbeiro();
  setupAdmin();
  setupModal();

  if (!/^#\/(inicio|agendar|meus|entrar|barbeiro|admin)/.test(location.hash || '')) {
    try {
      history.replaceState(null, '', '#/inicio');
    } catch (_) {
      location.hash = '#/inicio';
    }
  }

  const initialView = parseHash();
  const publicViews = ['inicio', 'agendar', 'entrar'];
  if (publicViews.indexOf(initialView) !== -1) {
    // Pinta a view pública imediatamente; a sessão é restaurada em paralelo.
    renderRoute(initialView);
    await bootstrapSession();
    appReady = true;
    const currentView = parseHash();
    if (currentView !== initialView) renderRoute(currentView);
    else if (currentView === 'entrar') renderEntrar();
  } else {
    await bootstrapSession();
    appReady = true;
    renderRoute(parseHash());
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init().catch(() => {
    showToast('Não foi possível iniciar a interface. Recarregue a página.', 'erro');
  });
}
