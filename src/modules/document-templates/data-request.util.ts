/**
 * "Pedir dados ao cliente": a mensagem do WhatsApp que lista só o que o
 * cliente ainda precisa mandar para o contrato. Funções puras.
 */
import { friendlyLabel, normalizeFieldName } from './field-groups.util';

export interface MissingClientFields {
  /** Campos do cliente sem valor, na ordem do modelo. */
  fields: string[];
  /** Rótulos para a mensagem, sem repetir ("CPF" do cliente aparece uma vez). */
  labels: string[];
}

/** Campos do grupo `client` ainda sem valor, e os rótulos sem repetição. */
export function missingClientFields(
  clientFields: readonly string[],
  known: Readonly<Record<string, string>>,
): MissingClientFields {
  const values = new Map(Object.entries(known));
  const fields = clientFields.filter((name) => !(values.get(name) ?? '').trim());
  // Sem repetir rótulo, ignorando caixa e acento ("CPF" e "Cpf" são um só).
  const byKey = new Map<string, string>();
  fields.map(friendlyLabel).forEach((label) => {
    const key = normalizeFieldName(label);
    if (!byKey.has(key)) byKey.set(key, label);
  });
  return { fields, labels: [...byKey.values()] };
}

/** Primeiro nome do contato; nada se o "nome" for só número/telefone. */
export function firstName(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return /\p{L}/u.test(first) ? first : null;
}

export function buildDataRequestText(input: {
  contactName: string | null | undefined;
  title: string;
  labels: readonly string[];
}): string {
  const name = firstName(input.contactName);
  const greeting = name ? `Olá, ${name}!` : 'Olá!';
  const items = input.labels.map((label) => `• ${label}`).join('\n');
  return [
    `${greeting} Para emitir seu contrato (*${input.title}*), me envie por favor:`,
    items,
    'Pode mandar tudo numa mensagem só. 😊',
  ].join('\n');
}
