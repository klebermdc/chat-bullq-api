/**
 * Monta o payload de um template HSM (formato Meta) para envios AUTOMÁTICOS —
 * cadência e reengajamento — onde não há ninguém para digitar as variáveis.
 *
 * Regra de preenchimento: `{{1}}` = primeiro nome do contato; as demais saem
 * dos `variableExamples` cadastrados no template. Parâmetro vazio é rejeitado
 * pela Meta, então cai em '-' (mesmo padrão do `recovery-outreach`).
 */

export interface HsmTemplateRow {
  name: string;
  language: string;
  components: unknown;
  variableExamples?: unknown;
}

/** Variáveis {{n}} do corpo, distintas e em ordem crescente. */
function extractVariables(bodyText: string): string[] {
  const seen = new Set<string>();
  const re = /\{\{(\d+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bodyText)) !== null) seen.add(m[1]);
  return [...seen].sort((a, b) => Number(a) - Number(b));
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

/** Formato do cabeçalho de mídia do template, ou null se não houver. */
function mediaHeaderFormat(components: Record<string, any>): string | null {
  const fmt = asRecord(components.header).format;
  return fmt === 'IMAGE' || fmt === 'VIDEO' || fmt === 'DOCUMENT' ? fmt : null;
}

export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * Retorna o `content` pronto para `MessagesService.send` com type=TEMPLATE, ou
 * null quando o template não pode ser montado sem intervenção humana (hoje:
 * cabeçalho de mídia, que exigiria um link de imagem/vídeo/documento).
 */
export function buildHsmTemplateContent(
  template: HsmTemplateRow,
  contactName: string | null,
): Record<string, any> | null {
  const components = asRecord(template.components);
  if (mediaHeaderFormat(components)) return null;

  const bodyText = String(asRecord(components.body).text ?? '');
  const vars = extractVariables(bodyText);
  const examples = asRecord(template.variableExamples);

  const payload: Record<string, any> = {
    name: template.name,
    language: { code: template.language },
  };

  if (vars.length > 0) {
    const value = (n: string): string => {
      const raw = n === '1' ? firstName(contactName) : String(examples[n] ?? '');
      return raw.trim() || '-';
    };
    payload.components = [
      {
        type: 'body',
        parameters: vars.map((n) => ({ type: 'text', text: value(n) })),
      },
    ];
  }

  return payload;
}
