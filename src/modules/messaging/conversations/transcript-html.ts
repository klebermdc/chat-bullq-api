/**
 * HTML do histórico do cliente para virar PDF.
 *
 * Função pura: recebe as mensagens já buscadas e devolve o documento. Assim o
 * formato é testável sem subir navegador nenhum.
 *
 * O documento serve de registro fora do sistema, então ele nunca pode afirmar
 * ser completo quando não é: corte por teto e atendimento oculto por permissão
 * viram aviso na capa.
 */

export interface TranscriptMessage {
  id: string;
  conversationId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  type: string;
  content: Record<string, any> | null;
  senderName: string | null;
  sender: { name: string } | null;
  createdAt: Date;
}

export interface TranscriptConversation {
  protocol: string | null;
  channelName: string;
  startedAt: Date;
}

export interface TranscriptInput {
  contact: { name: string | null; phone: string | null };
  /** Quem clicou no botão — exportação de dado pessoal tem que ter origem. */
  generatedBy: string;
  generatedAt: Date;
  messages: TranscriptMessage[];
  conversations: Record<string, TranscriptConversation>;
  /** Mensagens deixadas de fora pelo teto. */
  omittedByLimit: number;
  /** Atendimentos que existem mas o usuário não pode ver. */
  hiddenByChannelAccess: number;
}

/** Mensagem de cliente é texto de terceiro: nunca entra crua no documento. */
export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

const DATE_ONLY = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Sao_Paulo',
});

/** Tipos que valem um marcador em vez de um anexo — não existem em papel. */
const MEDIA_LABELS: Record<string, string> = {
  AUDIO: '🎤 áudio',
  VIDEO: '🎬 vídeo',
  DOCUMENT: '📄 documento',
  STICKER: '🏷️ figurinha',
  LOCATION: '📍 localização',
};

function authorOf(message: TranscriptMessage, contactName: string): string {
  if (message.direction === 'INBOUND') return contactName;
  return message.sender?.name || message.senderName || 'Atendimento';
}

function bodyOf(message: TranscriptMessage): string {
  const content = message.content ?? {};
  const caption = typeof content.text === 'string' ? content.text : '';

  if (message.type === 'IMAGE' && content.mediaUrl) {
    // `onerror` deixa o corte visível: imagem que não carregar não pode sumir
    // calada de um documento que serve de prova.
    return (
      `<img src="${escapeHtml(String(content.mediaUrl))}" class="media" ` +
      `onerror="this.replaceWith(document.createTextNode('[imagem não recuperada]'))" />` +
      (caption ? `<div class="caption">${escapeHtml(caption)}</div>` : '')
    );
  }

  const label = MEDIA_LABELS[message.type];
  if (label) {
    const fileName =
      typeof content.fileName === 'string' ? ` — ${escapeHtml(content.fileName)}` : '';
    return `<div class="attachment">${label}${fileName}</div>${
      caption ? `<div class="caption">${escapeHtml(caption)}</div>` : ''
    }`;
  }

  if (!caption) return `<div class="attachment">[${escapeHtml(message.type)}]</div>`;
  return `<div class="text">${escapeHtml(caption).replace(/\n/g, '<br />')}</div>`;
}

function conversationHeader(
  conversationId: string,
  conversations: Record<string, TranscriptConversation>,
): string {
  const brief = conversations[conversationId];
  if (!brief) return '<div class="divider">Atendimento</div>';
  const parts = [
    brief.protocol ? `Protocolo ${escapeHtml(brief.protocol)}` : 'Atendimento',
    escapeHtml(brief.channelName),
    `iniciado em ${DATE_ONLY.format(brief.startedAt)}`,
  ];
  return `<div class="divider">${parts.join(' · ')}</div>`;
}

function warnings(input: TranscriptInput): string {
  const items: string[] = [];
  if (input.omittedByLimit > 0) {
    items.push(
      `Este documento traz as mensagens mais recentes. ` +
        `${input.omittedByLimit} mensagens mais antigas ficaram de fora por limite de tamanho.`,
    );
  }
  if (input.hiddenByChannelAccess > 0) {
    items.push(
      `${input.hiddenByChannelAccess} atendimento(s) deste cliente não constam aqui: ` +
        `estão em canais sem acesso para quem gerou o documento.`,
    );
  }
  if (items.length === 0) return '';
  return `<div class="warn">${items.map((i) => `<div>⚠ ${i}</div>`).join('')}</div>`;
}

export function buildTranscriptHtml(input: TranscriptInput): string {
  const contactName = input.contact.name || 'Cliente';
  const period = input.messages.length
    ? `${DATE_ONLY.format(input.messages[0].createdAt)} a ${DATE_ONLY.format(
        input.messages[input.messages.length - 1].createdAt,
      )}`
    : '—';

  let lastConversationId = '';
  const rows = input.messages
    .map((message) => {
      const divider =
        message.conversationId === lastConversationId
          ? ''
          : conversationHeader(message.conversationId, input.conversations);
      lastConversationId = message.conversationId;
      const side = message.direction === 'INBOUND' ? 'in' : 'out';
      return `${divider}<div class="msg ${side}">
        <div class="meta">${escapeHtml(authorOf(message, contactName))} · ${DATE_TIME.format(
          message.createdAt,
        )}</div>
        ${bodyOf(message)}
      </div>`;
    })
    .join('');

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" />
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; font-size: 11px; color: #18181b; margin: 24px; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .sub { color: #52525b; font-size: 11px; }
  .cover { border-bottom: 2px solid #18181b; padding-bottom: 10px; margin-bottom: 14px; }
  .warn { border: 1px solid #b45309; background: #fffbeb; color: #7c2d12; padding: 8px; margin: 10px 0; border-radius: 4px; }
  .divider { margin: 18px 0 8px; padding: 5px 8px; background: #f4f4f5; border-left: 3px solid #71717a; font-weight: 600; page-break-after: avoid; }
  .msg { margin: 0 0 8px; padding: 6px 8px; border-radius: 5px; page-break-inside: avoid; max-width: 78%; }
  .in { background: #f4f4f5; }
  .out { background: #e0e7ff; margin-left: auto; }
  .meta { color: #52525b; font-size: 9px; margin-bottom: 2px; }
  .text { white-space: pre-wrap; word-break: break-word; }
  .caption { margin-top: 3px; }
  .attachment { font-style: italic; color: #3f3f46; }
  .media { max-width: 100%; max-height: 320px; border-radius: 4px; }
</style></head><body>
  <div class="cover">
    <h1>Histórico de atendimento — ${escapeHtml(contactName)}</h1>
    <div class="sub">${input.contact.phone ? escapeHtml(input.contact.phone) + ' · ' : ''}${
      input.messages.length
    } mensagens · período ${period}</div>
    <div class="sub">Gerado em ${DATE_TIME.format(input.generatedAt)} por ${escapeHtml(
      input.generatedBy,
    )}</div>
  </div>
  ${warnings(input)}
  ${rows}
</body></html>`;
}
