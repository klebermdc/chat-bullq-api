import { llm } from '@livekit/agents';
import { z } from 'zod';
import type { SendturVoiceClient } from './sendtur-client.js';

/**
 * Ferramentas da Aline na ligação de retorno de cotação. A conversa vem da
 * missão (Sendtur); o modelo nunca escolhe conversa, empresa ou vendedor.
 */
export function quoteFollowUpTools(client: SendturVoiceClient, conversationId: string) {
  return [
    llm.tool({
      name: 'horarios_livres',
      description:
        'Busca os próximos horários livres do vendedor para a conversa com o cliente. Use ANTES de oferecer horários; ofereça no máximo dois por vez, falando como está no campo "falado".',
      execute: async () => {
        try {
          return await client.freeSlots(conversationId, 4);
        } catch {
          return { erro: 'Não consegui ver a agenda agora. Pergunte o melhor dia e período e diga que o vendedor confirma.' };
        }
      },
    }),
    llm.tool({
      name: 'agendar_retorno',
      description:
        'Marca a conversa com o vendedor no horário que o cliente CONFIRMOU. Use somente um "inicio" devolvido por horarios_livres. Se a resposta vier com ok=false, peça desculpas e ofereça outro horário livre.',
      parameters: z.object({
        inicio: z.string().describe('O campo "inicio" (ISO) exatamente como veio de horarios_livres.'),
        observacao: z.string().max(300).optional().describe('Dúvida ou assunto que o cliente quer tratar, em poucas palavras.'),
      }),
      execute: async ({ inicio, observacao }) => {
        try {
          return await client.schedule({ conversationId, startsAt: inicio, notes: observacao });
        } catch {
          return { ok: false, codigo: 'FALHA', mensagem: 'Não consegui marcar agora. Diga que o vendedor vai entrar em contato para confirmar o horário.' };
        }
      },
    }),
  ];
}
