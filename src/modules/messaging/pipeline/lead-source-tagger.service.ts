import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { ORIGIN_TAG_NAMES } from './lead-origin.constants';

/** Nome da tag aplicada a leads que vieram do Instagram orgânico. */
const INSTAGRAM_TAG_NAME = ORIGIN_TAG_NAMES.INSTAGRAM_ORGANIC;

/** Nome da tag aplicada a leads que vieram de anúncio Click-to-WhatsApp. */
const AD_TAG_NAME = 'Anúncio Meta';

/** Frase-marca padrão no texto pré-preenchido do link wa.me (configurável). */
const DEFAULT_MARKER = 'vim pelo instagram';

function normalize(s?: string | null): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .trim();
}

/**
 * Atribuição de origem por link rastreado (Instagram orgânico).
 *
 * O link que o ManyChat/Instagram divulga é um `wa.me` com uma frase-marca no
 * texto pré-preenchido (ex.: "Vim pelo Instagram…"). Quando o lead clica e
 * manda a 1ª mensagem, ela contém essa marca — aí marcamos a conversa com a
 * tag "Instagram Orgânico". É o sinal visível pro time, sem webhook externo.
 *
 * A frase-marca é configurável via `INSTAGRAM_LEAD_MARKER` (default acima).
 */
@Injectable()
export class LeadSourceTaggerService {
  private readonly logger = new Logger(LeadSourceTaggerService.name);
  private readonly marker: string;

  constructor(private readonly prisma: PrismaService) {
    this.marker = normalize(process.env.INSTAGRAM_LEAD_MARKER || DEFAULT_MARKER);
  }

  /** True se o texto contém a frase-marca (case/acento-insensitive). */
  matches(text?: string | null): boolean {
    if (!text) return false;
    return normalize(text).includes(this.marker);
  }

  /**
   * Se o corpo da mensagem tem a marca, aplica a tag "Instagram Orgânico" na
   * conversa. Idempotente (re-aplicar é no-op) e best-effort. Retorna true se a
   * conversa ficou marcada (agora ou já estava).
   */
  async tagInstagramOrganicIfMatch(params: {
    organizationId: string;
    conversationId: string;
    body?: string | null;
  }): Promise<boolean> {
    if (!this.matches(params.body)) return false;

    const tag = await this.prisma.tag.upsert({
      where: {
        organizationId_name: {
          organizationId: params.organizationId,
          name: INSTAGRAM_TAG_NAME,
        },
      },
      update: {},
      create: { organizationId: params.organizationId, name: INSTAGRAM_TAG_NAME },
      select: { id: true },
    });

    try {
      await this.prisma.conversationTag.create({
        data: { conversationId: params.conversationId, tagId: tag.id },
      });
      this.logger.log(
        `lead Instagram orgânico: conversa ${params.conversationId} marcada`,
      );
    } catch (err: any) {
      // Já tinha a tag (PK composta conversationId+tagId) → no-op.
      if (err?.code !== 'P2002') throw err;
    }
    return true;
  }

  /**
   * Marca a conversa como vinda de anúncio quando a mensagem traz o referral
   * do Click-to-WhatsApp.
   *
   * O gatilho é o `ctwaClid` da PRÓPRIA mensagem, não o do contato: contato
   * que clicou num anúncio meses atrás guarda o clid antigo, e usá-lo marcaria
   * como "anúncio" uma conversa nova que na verdade veio orgânica.
   *
   * Idempotente e best-effort — nunca quebra o pipeline de entrada.
   */
  async tagAdLeadIfReferral(params: {
    organizationId: string;
    conversationId: string;
    ctwaClid?: string | null;
  }): Promise<boolean> {
    if (!params.ctwaClid) return false;

    const tag = await this.prisma.tag.upsert({
      where: {
        organizationId_name: {
          organizationId: params.organizationId,
          name: AD_TAG_NAME,
        },
      },
      update: {},
      create: { organizationId: params.organizationId, name: AD_TAG_NAME },
      select: { id: true },
    });

    try {
      await this.prisma.conversationTag.create({
        data: { conversationId: params.conversationId, tagId: tag.id },
      });
      this.logger.log(
        `lead de anúncio (CTWA): conversa ${params.conversationId} marcada`,
      );
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err;
    }
    return true;
  }
}
