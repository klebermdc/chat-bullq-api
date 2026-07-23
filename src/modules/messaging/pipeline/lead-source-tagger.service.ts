import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { ORIGIN_TAG_NAMES } from './lead-origin.constants';

/** Nome da tag aplicada a leads que vieram do Instagram orgânico. */
const INSTAGRAM_TAG_NAME = ORIGIN_TAG_NAMES.INSTAGRAM_ORGANIC;

/** Nome da tag aplicada a leads que vieram de anúncio Click-to-WhatsApp. */
const AD_TAG_NAME = 'Anúncio Meta';

/** Frase-marca padrão no texto pré-preenchido do link wa.me (configurável). */
const DEFAULT_MARKER = 'vim pelo instagram';

/**
 * Frases automáticas que o Meta pré-preenche em anúncios Click-to-WhatsApp.
 * Servem de REDE DE SEGURANÇA: quando o Meta não anexa o `ctwa_clid` (anúncio
 * mal configurado, ou o Meta simplesmente engole o referral), ainda dá pra
 * reconhecer o lead pela frase e marcá-lo "Anúncio Meta" para o time enxergar.
 *
 * Não recupera a ATRIBUIÇÃO (qual anúncio) — isso só o ctwa_clid dá — mas
 * resolve a visibilidade. Sobrescrevível por org via env CTWA_AD_MARKERS
 * (lista separada por `|`).
 */
const DEFAULT_AD_MARKERS = [
  'quero fazer uma cotação',
  'olá! posso ter mais informações sobre isso?',
];

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
  /** Frases de anúncio normalizadas, para match exato. */
  private readonly adMarkers: string[];

  constructor(private readonly prisma: PrismaService) {
    this.marker = normalize(process.env.INSTAGRAM_LEAD_MARKER || DEFAULT_MARKER);
    const raw = process.env.CTWA_AD_MARKERS
      ? process.env.CTWA_AD_MARKERS.split('|')
      : DEFAULT_AD_MARKERS;
    this.adMarkers = raw.map((m) => normalize(m)).filter(Boolean);
  }

  /** True se o texto contém a frase-marca (case/acento-insensitive). */
  matches(text?: string | null): boolean {
    if (!text) return false;
    return normalize(text).includes(this.marker);
  }

  /**
   * True se a mensagem É (exatamente, normalizada) uma das frases automáticas
   * de anúncio. Match EXATO de propósito: a frase pré-preenchida chega como a
   * mensagem inteira; exigir igualdade evita marcar como anúncio um humano que
   * só mencionou "cotação" no meio de um texto maior.
   */
  matchesAdMarker(text?: string | null): boolean {
    if (!text) return false;
    return this.adMarkers.includes(normalize(text));
  }

  /** Aplica uma tag na conversa. Idempotente (P2002 = já tinha) e best-effort. */
  private async applyTag(
    organizationId: string,
    conversationId: string,
    tagName: string,
    logMsg: string,
  ): Promise<boolean> {
    const tag = await this.prisma.tag.upsert({
      where: { organizationId_name: { organizationId, name: tagName } },
      update: {},
      create: { organizationId, name: tagName },
      select: { id: true },
    });

    try {
      await this.prisma.conversationTag.create({
        data: { conversationId, tagId: tag.id },
      });
      this.logger.log(logMsg);
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err;
    }
    return true;
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
    return this.applyTag(
      params.organizationId,
      params.conversationId,
      INSTAGRAM_TAG_NAME,
      `lead Instagram orgânico: conversa ${params.conversationId} marcada`,
    );
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
    return this.applyTag(
      params.organizationId,
      params.conversationId,
      AD_TAG_NAME,
      `lead de anúncio (CTWA): conversa ${params.conversationId} marcada`,
    );
  }

  /**
   * Rede de segurança: marca "Anúncio Meta" quando a mensagem É uma frase
   * automática de anúncio, mesmo sem `ctwa_clid`. Cobre o caso real em que o
   * Meta não anexa o referral — o lead chega com a frase padrão do anúncio mas
   * sem a identificação. Aplica a MESMA tag que o caminho por referral, então
   * o filtro na caixa de entrada é único.
   *
   * Não substitui o referral: quando o `ctwa_clid` vem, ele é a fonte da
   * atribuição pra Meta; a frase só garante a visibilidade interna.
   */
  async tagAdLeadIfMarkerPhrase(params: {
    organizationId: string;
    conversationId: string;
    body?: string | null;
  }): Promise<boolean> {
    if (!this.matchesAdMarker(params.body)) return false;
    return this.applyTag(
      params.organizationId,
      params.conversationId,
      AD_TAG_NAME,
      `lead de anúncio (frase): conversa ${params.conversationId} marcada`,
    );
  }
}
