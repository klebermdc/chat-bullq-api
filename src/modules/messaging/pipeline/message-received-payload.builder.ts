import {
  NormalizedInboundMessage,
  MessageContentType,
} from '../../channel-hub/ports/types';
import { MessageReceivedPayload } from '../../automations/automations.types';

// Tipos de conteúdo que contam como anexo para efeito de condição de
// automação. Set em vez de cadeia de || para a checagem não crescer junto
// com a lista. Tipado com o enum (não string solto) pra um typo virar erro
// de compilação em vez de silêncio em runtime.
const ATTACHMENT_TYPES = new Set<MessageContentType>([
  MessageContentType.IMAGE,
  MessageContentType.AUDIO,
  MessageContentType.VIDEO,
  MessageContentType.DOCUMENT,
  MessageContentType.STICKER,
]);

export interface BuildMessageReceivedPayloadParams {
  organizationId: string;
  contactId: string;
  conversationId: string;
  channelId: string;
  messageId: string;
  message: NormalizedInboundMessage;
}

// Função pura de propósito: sem @Injectable e sem módulo Nest, para não criar
// aresta no grafo de injeção (o projeto já caiu duas vezes por ciclo de DI).
export function buildMessageReceivedPayload(
  params: BuildMessageReceivedPayloadParams,
): MessageReceivedPayload {
  const { message } = params;
  const content = message.content ?? {};

  const body =
    typeof content.text === 'string'
      ? content.text
      : typeof content.caption === 'string'
        ? content.caption
        : null;

  return {
    organizationId: params.organizationId,
    contactId: params.contactId,
    conversationId: params.conversationId,
    channelId: params.channelId,
    messageId: params.messageId,
    body,
    // String(...) aqui é proposital: `MessageReceivedPayload.type` é `string`
    // solto (não o enum) para não criar dependência circular com o Prisma —
    // ver comentário em automations.types.ts.
    type: String(message.type),
    hasAttachment: ATTACHMENT_TYPES.has(message.type),
    isFromCustomer: true,
  };
}
