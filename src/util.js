'use strict';

/**
 * Utilidades compartilhadas do backend Barber Prime.
 * Datas e horas são sempre strings locais de America/Sao_Paulo.
 */

const TZ = 'America/Sao_Paulo';

class ErroHttp extends Error {
  constructor(status, erro, mensagem) {
    super(mensagem || erro);
    this.name = 'ErroHttp';
    this.status = status;
    this.erro = erro;
    this.mensagem = mensagem || erro;
  }
}

function doisDigitos(n) {
  return String(n).padStart(2, '0');
}

/** Retorna data/hora local da barbearia, sem converter nada no banco. */
function agoraLocal(base = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const partes = {};
  for (const p of fmt.formatToParts(base)) partes[p.type] = p.value;
  const hora = partes.hour === '24' ? '00' : partes.hour;
  const data = `${partes.year}-${partes.month}-${partes.day}`;
  const minutos = Number(hora) * 60 + Number(partes.minute);
  return {
    data,
    hora: `${hora}:${partes.minute}`,
    minutos,
    segundos: Number(partes.second),
    diaSemana: diaSemanaDeData(data),
    timestamp: base.getTime(),
    texto: `${data} ${hora}:${partes.minute}:${partes.second}`,
    inicio: `${data} ${hora}:${partes.minute}`,
  };
}

/** Validação estrita de 'YYYY-MM-DD' (rejeita 2026-02-31). */
function validarData(data) {
  if (typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
  const [ano, mes, dia] = data.split('-').map(Number);
  if (ano < 1900 || ano > 2200 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const dt = new Date(Date.UTC(ano, mes - 1, dia));
  if (
    dt.getUTCFullYear() !== ano ||
    dt.getUTCMonth() !== mes - 1 ||
    dt.getUTCDate() !== dia
  ) {
    return null;
  }
  return data;
}

/** 'HH:MM' 24h, sempre com dois dígitos. */
function validarHora(hora) {
  if (typeof hora !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return null;
  return hora;
}

function horaParaMin(hora) {
  const [h, m] = String(hora).split(':').map(Number);
  return h * 60 + m;
}

function minParaHora(minutos) {
  const m = ((Math.trunc(minutos) % 1440) + 1440) % 1440;
  return `${doisDigitos(Math.floor(m / 60))}:${doisDigitos(m % 60)}`;
}

/** 0=domingo ... 6=sábado, calculado em UTC para não sofrer fuso do processo. */
function diaSemanaDeData(data) {
  const [ano, mes, dia] = String(data).split('-').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

function somarDias(data, dias) {
  const [ano, mes, dia] = String(data).split('-').map(Number);
  const dt = new Date(Date.UTC(ano, mes - 1, dia + Number(dias)));
  return `${dt.getUTCFullYear()}-${doisDigitos(dt.getUTCMonth() + 1)}-${doisDigitos(dt.getUTCDate())}`;
}

function diferencaDias(de, ate) {
  const [a1, m1, d1] = String(de).split('-').map(Number);
  const [a2, m2, d2] = String(ate).split('-').map(Number);
  const t1 = Date.UTC(a1, m1 - 1, d1);
  const t2 = Date.UTC(a2, m2 - 1, d2);
  return Math.round((t2 - t1) / 86400000);
}

function listarDias(de, ate) {
  const out = [];
  const total = diferencaDias(de, ate);
  for (let i = 0; i <= total; i += 1) out.push(somarDias(de, i));
  return out;
}

function minutosSobrepoem(aInicio, aFim, bInicio, bFim) {
  return aInicio < bFim && bInicio < aFim;
}

function mdc(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

/** Normaliza telefone brasileiro para 10 ou 11 dígitos. Retorna null se inválido. */
function normalizarTelefone(valor) {
  if (typeof valor !== 'string' && typeof valor !== 'number') return null;
  let digitos = String(valor).replace(/\D/g, '');
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) {
    digitos = digitos.slice(2);
  }
  if (digitos.length !== 10 && digitos.length !== 11) return null;
  return digitos;
}

/** Nunca exponha telefone completo em logs/auditoria. */
function mascararTelefone(telefone) {
  if (!telefone) return null;
  const digitos = String(telefone).replace(/\D/g, '');
  return `***${digitos.slice(-4)}`;
}

function textoValido(valor, min, max) {
  if (typeof valor !== 'string') return null;
  const t = valor.trim();
  if (t.length < min || t.length > max) return null;
  return t;
}

function inteiroValido(valor) {
  if (typeof valor === 'number' && Number.isInteger(valor)) return valor;
  if (typeof valor === 'string' && /^-?\d+$/.test(valor.trim())) return Number(valor);
  return null;
}

function inteiroPositivo(valor) {
  const n = inteiroValido(valor);
  return n !== null && n > 0 ? n : null;
}

function booleanoValido(valor) {
  if (typeof valor === 'boolean') return valor;
  if (valor === 1 || valor === 0) return Boolean(valor);
  if (valor === 'true') return true;
  if (valor === 'false') return false;
  return null;
}

function listaStrings(valor, maxItens = 20, maxChars = 60) {
  if (!Array.isArray(valor)) return null;
  if (valor.length > maxItens) return null;
  const out = [];
  for (const item of valor) {
    if (typeof item !== 'string') return null;
    const t = item.trim();
    if (t.length === 0 || t.length > maxChars) return null;
    out.push(t);
  }
  return out;
}

function jsonSeguro(valor, padrao) {
  try {
    const v = JSON.parse(valor);
    return v === undefined ? padrao : v;
  } catch {
    return padrao;
  }
}

function rotuloUsuario(usuario) {
  if (!usuario) return 'sistema';
  if (usuario.login) return usuario.login;
  return `${usuario.papel || 'usuario'}#${usuario.id}`;
}

module.exports = {
  TZ,
  ErroHttp,
  agoraLocal,
  validarData,
  validarHora,
  horaParaMin,
  minParaHora,
  diaSemanaDeData,
  somarDias,
  diferencaDias,
  listarDias,
  minutosSobrepoem,
  mdc,
  normalizarTelefone,
  mascararTelefone,
  textoValido,
  inteiroValido,
  inteiroPositivo,
  booleanoValido,
  listaStrings,
  jsonSeguro,
  rotuloUsuario,
  doisDigitos,
};
