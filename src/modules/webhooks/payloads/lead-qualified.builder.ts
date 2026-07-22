import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { hashPhoneSha256 } from '../../../common/utils/phone-hash.util';

/**
 * Monta o payload do webhook LEAD_QUALIFIED.
 *
 * Diferente dos outros eventos — que são propositalmente "magros" (só IDs, o
 * consumidor busca o resto na API) — este vai enriquecido. O motivo é que o
 * destino típico é um contêiner de tag server-side (sGTM/Stape), que não tem
 * como autenticar de volta na nossa API para buscar a atribuição. Sem o
 * ctwa_clid dentro do próprio payload, o evento chega órfão e a conversão não
 * é atribuída ao anúncio.
 *
 * O ctwa_clid vai SEM hash de propósito: a Meta exige assim para atribuição de
 * Click-to-WhatsApp, ao contrário dos demais dados de usuário.
 */
@Injectable()
export class LeadQualifiedPayloadBuilder {
  constructor(private readonly prisma: PrismaService) {}

  async build(payload: {
    contactId: string;
    conversationId: string;
    channelId?: string | null;
    tagId?: string | null;
    occurredAt?: Date | string;
  }): Promise<Record<string, any>> {
    const contact = await this.prisma.contact.findUnique({
      where: { id: payload.contactId },
      select: {
        id: true,
        phone: true,
        ctwaClid: true,
        ctwaSourceId: true,
        ctwaSourceType: true,
        ctwaClidAt: true,
      },
    });

    const [tag, channel] = await Promise.all([
      payload.tagId
        ? this.prisma.tag.findUnique({
            where: { id: payload.tagId },
            select: { name: true },
          })
        : Promise.resolve(null),
      payload.channelId
        ? this.prisma.channel.findUnique({
            where: { id: payload.channelId },
            select: { name: true, type: true },
          })
        : Promise.resolve(null),
    ]);

    const occurredAt = payload.occurredAt
      ? new Date(payload.occurredAt)
      : new Date();

    const phoneSha256 = hashPhoneSha256(contact?.phone);

    return {
      event: 'LEAD_QUALIFIED',
      occurredAt: occurredAt.toISOString(),
      // Chave de deduplicação ponta a ponta: mesma granularidade da chave
      // do outbox (por conversa), para a Meta não contar o lead duas vezes
      // se houver reentrega.
      eventId: `${payload.conversationId}:qualified`,
      contactId: payload.contactId,
      conversationId: payload.conversationId,
      tag: tag?.name ?? null,
      attribution: contact?.ctwaClid
        ? {
            ctwaClid: contact.ctwaClid,
            sourceId: contact.ctwaSourceId ?? null,
            sourceType: contact.ctwaSourceType ?? null,
            clickedAt: contact.ctwaClidAt?.toISOString() ?? null,
          }
        : // Lead que não veio de anúncio (orgânico, indicação). Mandamos
          // null explícito para o consumidor distinguir "sem anúncio" de
          // "campo faltando por erro".
          null,
      contact: {
        phoneSha256,
      },
      channel: channel
        ? { name: channel.name, type: channel.type }
        : null,
    };
  }
}
