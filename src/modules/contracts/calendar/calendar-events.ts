import { createHash } from 'node:crypto';
import { MULTIPASS_DAYS_BEFORE_DEFAULT, MULTIPASS_DAYS_BEFORE_DISNEY_GUEST } from '../contracts.constants';
import { multipassBuyDate } from '../domain/multipass';
import { readContractDates, type ContractDate } from '../domain/park-dates';

/** Fuso dos parques: eventos com hora (Multipass) são em Orlando. */
export const CALENDAR_TIME_ZONE = 'America/New_York';
const FINGERPRINT_LENGTH = 12;
const MULTIPASS_START_TIME = '07:00:00';
const MULTIPASS_END_TIME = '07:30:00';
const DAY_MS = 86_400_000;
const EMPTY_FIELD = '—';
const MAX_NAME = 80;
const MAX_GUIDE = 60;
const MAX_PHONE = 25;
const MAX_LABEL = 60;
const LABEL_HASH_LENGTH = 8;
const MARKER_WORD = /sendtur/gi;
// Quebras (\r \n \t e separadores de linha) viram espaço, para não colar palavras.
const BREAKS = /[\t\n\r\u2028\u2029]/g;
// Demais controles, zero-width/marcas direcionais e markup somem sem deixar espaço.
const INVISIBLE_OR_MARKUP = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\ufeff\[\]{}<>`]/g;

/** Só o que a agenda precisa: sem CPF, e-mail, endereço nem valor. */
export interface CalendarContract {
  id: string;
  fullName: string;
  phone: string;
  guideName: string;
  disneyGuest: boolean;
  purchased: boolean;
  parkDates: unknown;
  requestedDates: string;
  createdAt: Date;
}

export interface CalendarOptions {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  today: string; // YYYY-MM-DD, em Orlando
  panelBaseUrl: string;
}

export interface CalendarEvent {
  key: string;
  fingerprint: string;
  kind: 'park' | 'multipass';
  contractId: string;
  summary: string;
  description: string;
  allDay: boolean;
  start: string;
  end: string;
  timeZone: typeof CALENDAR_TIME_ZONE;
}

type EventDraft = Omit<CalendarEvent, 'fingerprint' | 'description' | 'timeZone'> & { body: string };

export function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Higieniza texto vindo de usuário antes de entrar em título/descrição: uma
 * linha só, sem colchetes/markup e sem a palavra "sendtur", para que ninguém
 * forje a marca da rotina nem injete instruções em linhas novas.
 */
export function clean(text: string, max: number): string {
  let out = text ?? '';
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(BREAKS, ' ').replace(INVISIBLE_OR_MARKUP, '').replace(MARKER_WORD, '');
  }
  out = out.replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return out || EMPTY_FIELD;
}

const inWindow = (date: string, o: CalendarOptions) => o.from <= date && date <= o.to;

const brDate = (isoDate: string) => isoDate.split('-').reverse().join('/');

/** "Parque Água Nova!" → "parque-agua-nova" (chave estável sem acento nem espaço). */
function slug(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Chave estável do parque legado: slug do label ou, se o slug fica vazio (só emoji), x + sha1. */
function labelKey(label: string): string {
  return slug(label) || `x${createHash('sha1').update(label).digest('hex').slice(0, LABEL_HASH_LENGTH)}`;
}

function baseLines(c: CalendarContract, panelBaseUrl: string): string[] {
  const link = panelBaseUrl ? `${panelBaseUrl}/contratos/${c.id}` : c.id;
  return [
    `Cliente: ${clean(c.fullName, MAX_NAME)}`,
    `Telefone: ${clean(c.phone, MAX_PHONE)}`,
    `Hóspede Disney: ${c.disneyGuest ? 'Sim' : 'Não'}`,
    `Guia: ${clean(c.guideName, MAX_GUIDE)}`,
    `Contrato: ${link}`,
  ];
}

function parkDraft(c: CalendarContract, d: ContractDate, o: CalendarOptions): EventDraft {
  return {
    key: `park:${c.id}:${d.date}:${d.parkId ?? labelKey(d.label)}`,
    kind: 'park',
    contractId: c.id,
    summary: `🎢 ${clean(d.label, MAX_LABEL)} — ${clean(c.fullName, MAX_NAME)}`,
    body: baseLines(c, o.panelBaseUrl).join('\n'),
    allDay: true,
    start: d.date,
    end: addDays(d.date, 1),
  };
}

function multipassDraft(c: CalendarContract, firstDate: string, o: CalendarOptions): EventDraft | null {
  if (c.purchased) return null;
  const buyDate = multipassBuyDate(firstDate, c.disneyGuest);
  if (buyDate < o.today || !inWindow(buyDate, o)) return null;
  const rule = c.disneyGuest
    ? `Regra: D-${MULTIPASS_DAYS_BEFORE_DISNEY_GUEST} Hóspede Disney`
    : `Regra: D-${MULTIPASS_DAYS_BEFORE_DEFAULT} Não hóspede`;
  const [cliente, telefone, hospede, guia, contrato] = baseLines(c, o.panelBaseUrl);
  return {
    key: `multipass:${c.id}`,
    kind: 'multipass',
    contractId: c.id,
    summary: `⚡ Comprar Multipass — ${clean(c.fullName, MAX_NAME)}`,
    body: [cliente, telefone, hospede, guia, rule, `Viagem inicia: ${brDate(firstDate)}`, contrato].join('\n'),
    allDay: false,
    start: `${buyDate}T${MULTIPASS_START_TIME}`,
    end: `${buyDate}T${MULTIPASS_END_TIME}`,
  };
}

/** sha1 do conteúdo visível (sem a marca): muda quando título, texto ou horário mudam. */
function fingerprintOf(d: EventDraft): string {
  const content = JSON.stringify({ summary: d.summary, description: d.body, start: d.start, end: d.end });
  return createHash('sha1').update(content).digest('hex').slice(0, FINGERPRINT_LENGTH);
}

function finalize(d: EventDraft): CalendarEvent {
  const { body, ...rest } = d;
  const fingerprint = fingerprintOf(d);
  return {
    ...rest,
    fingerprint,
    description: `${body}\n\n[sendtur:${d.key}|${fingerprint}]`,
    timeZone: CALENDAR_TIME_ZONE,
  };
}

function draftsFor(c: CalendarContract, o: CalendarOptions): EventDraft[] {
  const dates = readContractDates(c);
  if (!dates.length) return [];
  const parks = dates.filter((d) => inWindow(d.date, o)).map((d) => parkDraft(c, d, o));
  const multipass = multipassDraft(c, dates[0].date, o);
  return multipass ? [...parks, multipass] : parks;
}

/**
 * Eventos "desejados" na agenda para a janela `from..to` (inclusive): um de dia
 * inteiro por data de parque e um lembrete às 7h de Orlando para comprar o
 * Multipass (só se não comprado e a data de compra não passou). A última linha
 * da descrição (`[sendtur:<key>|<fingerprint>]`) é como a rotina de
 * sincronização reconhece os eventos que são dela.
 */
export function buildCalendarEvents(contracts: readonly CalendarContract[], options: CalendarOptions): CalendarEvent[] {
  const seen = new Set<string>();
  return contracts
    .flatMap((c) => draftsFor(c, options))
    .filter((d) => !seen.has(d.key) && !!seen.add(d.key))
    .map(finalize)
    .sort((a, b) => a.start.localeCompare(b.start) || a.key.localeCompare(b.key));
}
