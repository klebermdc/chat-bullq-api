/**
 * Reconciliação de echo → placeholder para canais Baileys (Wasender/Zappfy).
 *
 * Toda mensagem que ENVIAMOS volta como um "echo" (`key.fromMe = true`) no
 * webhook `messages.upsert`. O merge normal usa a constraint única
 * `(conversationId, externalId)`: o envio grava a linha com o `externalId`
 * devolvido pelo `/send-message`, e o echo tem que trazer o MESMO id em
 * `key.id` pra cair na mesma linha.
 *
 * Quando o provedor devolve no envio um id INTERNO (ex.: `msgId` numérico do
 * WasenderAPI) diferente do `key.id` do WhatsApp que chega no echo, o merge por
 * externalId falha e o echo cria uma SEGUNDA linha → mensagem duplicada.
 *
 * Este helper é o fallback provider-agnóstico: dado o echo e os candidatos
 * OUTBOUND recentes da conversa, escolhe qual placeholder o echo deve mesclar,
 * casando por conteúdo (assinatura) dentro de uma janela de tempo. FIFO no
 * empate (sends idênticos repetidos casam do mais antigo pro mais novo).
 */

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;

export interface EchoCandidate {
  id: string;
  externalId: string | null;
  createdAt: Date;
  type: string;
  content: unknown;
  metadata: unknown;
}

/**
 * Assinatura de conteúdo estável entre o placeholder e o echo. Para mídia,
 * ignora o `mediaUrl` de propósito: o echo do WhatsApp traz uma URL `.enc`
 * criptografada diferente da URL local que subimos no envio.
 */
export function echoContentSignature(type: string, content: unknown): string {
  const c = (content ?? {}) as Record<string, unknown>;
  if (type === 'TEXT') {
    const text = typeof c.text === 'string' ? c.text.trim() : '';
    return `TEXT:${text}`;
  }
  const caption = typeof c.caption === 'string' ? c.caption.trim() : '';
  return `${type}:${caption}`;
}

export function pickEchoReconcileTarget(
  echo: { type: string; content: unknown; externalId: string | null },
  candidates: EchoCandidate[],
  opts: { nowMs?: number; windowMs?: number } = {},
): EchoCandidate | null {
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const cutoff = opts.nowMs != null ? opts.nowMs - windowMs : null;
  const sig = echoContentSignature(echo.type, echo.content);

  const matches = candidates
    .filter((r) => !(r.metadata as { echoReconciled?: boolean } | null)?.echoReconciled)
    .filter((r) => cutoff == null || r.createdAt.getTime() >= cutoff)
    .filter((r) => echoContentSignature(r.type, r.content) === sig)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return matches[0] ?? null;
}
