import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RenderService } from './render.service';
import { ExtractionService } from './extraction.service';
import { ProposalsRepository } from './proposals.repository';
import { MessagesService } from '../messaging/messages/messages.service';
import { ConversationAccessService } from '../messaging/conversations/conversation-access.service';
import { resolveAssignmentScope } from '../messaging/conversations/conversation-scope';
import type { ChannelAccess } from '../iam/channel-access/channel-access.service';
import { buildOtherProposalMessage, buildProposalMessage } from './message-builder';
import { CreateProposalDto, ProposalImageDto } from './dto/create-proposal.dto';
import {
  PROPOSAL_ALLOWED_HOSTS,
  PROPOSAL_IMAGE_MAX_BYTES,
  PROPOSAL_SENT_STAGE_NAME,
} from './proposals.constants';
import {
  PROPOSAL_NEW_FOLLOWUPS,
  PROPOSAL_NEW_FOLLOWUPS_OTHER,
} from './proposal-followups';
import { PipelinesService } from '../pipelines/pipelines.service';
import { OrderFichaService } from '../order-ficha/order-ficha.service';
import type { Proposal } from '@prisma/client';
import { StorageService } from '../storage/storage.service';
import { storageKeyFromUploadUrl } from '../acceptances/storage-key.util';
import { sniffImageMime } from './proposal-images';
import type {
  ExtractedCart,
  ExtractedProposal,
  ProposalDetails,
  ProposalImage,
  ProposalImageData,
} from './proposals.types';

const INVALID_IMAGE = 'Imagem inválida.';
const UNREADABLE_PROPOSAL =
  'Não consegui montar a proposta com o que foi enviado. O print ou o resumo precisa mostrar ' +
  'o produto e as condições (para ingressos: parques, datas e pessoas).';

/** Print já conferido: o que vai ao cliente/registro e os bytes para a visão. */
interface LoadedImage {
  image: ProposalImage;
  data: ProposalImageData;
}

/** Para onde e em nome de quem as mensagens da proposta saem. */
interface SendContext {
  conversationId: string;
  userId: string;
  organizationId: string;
  access: ChannelAccess;
}

@Injectable()
export class ProposalsService {
  private readonly logger = new Logger(ProposalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly render: RenderService,
    private readonly extraction: ExtractionService,
    private readonly repo: ProposalsRepository,
    private readonly messages: MessagesService,
    private readonly pipelines: PipelinesService,
    private readonly orderFicha: OrderFichaService,
    private readonly conversationAccess: ConversationAccessService,
    private readonly storage: StorageService,
  ) {}

  async create(
    dto: CreateProposalDto,
    userId: string,
    organizationId: string,
    access: ChannelAccess,
    role?: OrgRole,
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: dto.conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.organizationId !== organizationId) throw new ForbiddenException();
    // AGENT só cria proposta em conversa atribuída a si — mesma barreira
    // compartilhada do resto do app (NotFound, não Forbidden: não confirma
    // a existência do registro pra quem não tem acesso).
    await this.conversationAccess.assertConversationAccess(
      conversation.id,
      organizationId,
      role,
      userId,
    );

    // O atendente cola o link OU o bloco inteiro (link + resumo do carrinho).
    // Extraímos a URL de dentro do que foi colado; o texto completo vira
    // contexto extra pra extração.
    //
    // Proposta SEM link (`includeLink: false`): o link deixa de ser exigido.
    // Sem URL no que foi colado, o carrinho é lido só do resumo — não há
    // checkout pra abrir. Com print anexado, nem o resumo é exigido: a
    // proposta é lida da imagem.
    const pasted = dto.checkoutUrl ?? '';
    const images = dto.images ?? [];
    const includeLink = dto.includeLink ?? true;
    const url = this.extractCheckoutUrl(pasted);
    if (!url && includeLink) {
      throw new BadRequestException(
        'Não encontrei um link de checkout no que foi colado. Cole o link (pode ser junto com o resumo).',
      );
    }
    if (!url && !pasted.trim() && images.length === 0) {
      throw new BadRequestException(
        'Cole o resumo do carrinho (parques, datas e quantidade de pessoas).',
      );
    }
    // Antes de abrir checkout ou storage: barra de saída o que não é upload nosso.
    const imageKeys = images.map((image) => this.imageKeyOrThrow(image));

    let rawText: string;
    if (url) {
      this.assertAllowedUrl(url);
      try {
        rawText = await this.render.render(url);
      } catch (err) {
        this.logger.warn(`proposal_render_failed url=${url}: ${(err as Error).message}`);
        throw new BadRequestException(
          'Não foi possível abrir o carrinho. Confere o link e tenta de novo.',
        );
      }
    } else {
      rawText = pasted;
    }

    const loaded = await this.loadImages(images, imageKeys);

    let extracted: ExtractedProposal;
    try {
      if (loaded.length > 0) {
        extracted = await this.extraction.extractFromImages(
          organizationId,
          {
            images: loaded.map((l) => l.data),
            renderedText: url ? rawText : undefined,
            pastedText: pasted,
          },
          { allowMissingTotal: !url },
        );
      } else {
        extracted = url
          ? await this.extraction.extract(organizationId, rawText, pasted)
          : await this.extraction.extract(organizationId, rawText, undefined, {
              allowMissingTotal: true,
            });
      }
    } catch (err) {
      this.logger.warn(
        `proposal_extract_failed url=${url} images=${loaded.length}: ${(err as Error).message}`,
      );
      // Print sem link: o erro cru do parser ("campos obrigatórios ausentes")
      // não diz ao atendente o que faltou no print.
      if (loaded.length > 0 && !url) throw new BadRequestException(UNREADABLE_PROPOSAL);
      throw new BadRequestException(
        (err as Error).message ||
          'Não foi possível ler o carrinho. Confere o link e tenta de novo.',
      );
    }

    const isOther = extracted.kind === 'OTHER';
    const cart = this.toCart(extracted);
    const sentImages = loaded.map((l) => l.image);

    const proposal = await this.repo.create({
      organizationId,
      contactId: conversation.contactId,
      conversationId: conversation.id,
      checkoutUrl: url ?? '',
      createdById: userId,
      cart,
      rawText,
      kind: isOther ? 'OTHER' : 'PARKS',
      details: this.buildDetails(extracted, sentImages),
    });

    const mode = dto.mode ?? 'NEW';
    const messageOptions = { includeLink: includeLink && !!url };
    const text =
      extracted.kind === 'OTHER'
        ? buildOtherProposalMessage(extracted, url ?? '', mode, messageOptions)
        : buildProposalMessage(cart, url ?? '', mode, messageOptions);
    const sendContext: SendContext = {
      conversationId: conversation.id,
      userId,
      organizationId,
      access,
    };
    await this.sendToCustomer(sendContext, 'TEXT', { text });

    // Prints logo depois do texto da proposta, um por mensagem, na ordem em
    // que o atendente anexou. Best-effort como os follow-ups.
    await this.sendImages(sendContext, sentImages);

    // Cruzamento com a Ficha do Pedido: compara o que o cliente pediu na
    // conversa com o carrinho realmente montado no HUB e, se divergir, posta
    // alerta SYSTEM + marca a conversa. Fire-and-forget — nunca deve
    // bloquear/derrubar o envio da proposta. Disparado DEPOIS do envio da
    // mensagem de proposta pra a bolha SYSTEM de divergência (se houver)
    // sempre aparecer depois da proposta no thread.
    // Só para ingressos: o cruzamento compara parques/datas/pessoas, que uma
    // proposta OTHER (carro, hotel…) não tem.
    if (!isOther) {
      this.orderFicha
        .crossCheckOnProposal({
          conversationId: conversation.id,
          channelId: conversation.channelId,
          proposalId: proposal.id,
          cart,
        })
        .catch((e) => this.logger.warn(`cross-check ficha falhou: ${e}`));
    }

    // Só na PRIMEIRA proposta (NEW): dispara as mensagens de follow-up
    // (conferência + referências) pra reforçar confiança. Best-effort — se uma
    // falhar, a proposta principal já foi enviada e persistida.
    if (mode === 'NEW') {
      // Proposta que não é de ingresso usa a conferência sem falar em parques.
      const followUps = isOther ? PROPOSAL_NEW_FOLLOWUPS_OTHER : PROPOSAL_NEW_FOLLOWUPS;
      for (const followUp of followUps) {
        try {
          await this.sendToCustomer(sendContext, 'TEXT', { text: followUp });
        } catch (err) {
          this.logger.warn(
            `proposal_followup_failed conv=${conversation.id}: ${(err as Error).message}`,
          );
        }
      }
    }

    // Liga ao pipeline: garante o card em "PROPOSTA ENVIADA" (cria se não existe,
    // avança se está antes — só avança) e atualiza o valor. Dispara a cadência de
    // negociação. Best-effort — a proposta já foi enviada/persistida.
    try {
      await this.pipelines.ensureConversationAtStageByName(
        organizationId,
        conversation.id,
        PROPOSAL_SENT_STAGE_NAME,
        // Resumo sem valor (total 0) não sobrescreve o valor do negócio.
        cart.totalValue > 0
          ? { value: cart.totalValue, currency: cart.currency }
          : undefined,
      );
    } catch (err) {
      this.logger.warn(
        `proposal_pipeline_link_failed conv=${conversation.id}: ${(err as Error).message}`,
      );
    }

    return proposal;
  }

  async listForContact(
    organizationId: string,
    contactId: string,
    role?: OrgRole,
    currentUserId?: string,
  ) {
    const proposals = await this.repo.listForContact(organizationId, contactId);
    return this.scopeToAssignedConversation(proposals, role, currentUserId);
  }

  /**
   * Propostas do contato de uma conversa — usado pelo modal pra decidir o padrão
   * (se já existe proposta, o modal abre em "Atualização").
   */
  async listForConversation(
    organizationId: string,
    conversationId: string,
    role?: OrgRole,
    currentUserId?: string,
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { organizationId: true, contactId: true },
    });
    if (!conversation || conversation.organizationId !== organizationId) {
      return [];
    }
    const proposals = await this.repo.listForContact(organizationId, conversation.contactId);
    return this.scopeToAssignedConversation(proposals, role, currentUserId);
  }

  /**
   * Filtra propostas pra AGENT: um contato pode ter propostas espalhadas por
   * várias conversas (dele e de colegas). Sem isso, `GET /proposals/contact/:id`
   * vazava valor, datas e nº de pedido da conversa de outro atendente pra
   * qualquer AGENT que soubesse o contactId. OWNER/ADMIN não filtra.
   */
  private async scopeToAssignedConversation(
    proposals: Proposal[],
    role: OrgRole | undefined,
    currentUserId: string | undefined,
  ): Promise<Proposal[]> {
    const scopedUserId = currentUserId
      ? resolveAssignmentScope(role, currentUserId)
      : undefined;
    if (!scopedUserId) return proposals;
    if (proposals.length === 0) return proposals;

    const conversationIds = [...new Set(proposals.map((p) => p.conversationId))];
    const owned = await this.prisma.conversation.findMany({
      where: { id: { in: conversationIds }, assignedToId: scopedUserId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((c) => c.id));
    return proposals.filter((p) => ownedIds.has(p.conversationId));
  }

  /** Toda mensagem da proposta (texto, prints, follow-ups) sai por aqui. */
  private sendToCustomer(
    ctx: SendContext,
    type: 'TEXT' | 'IMAGE',
    content: Record<string, unknown>,
  ) {
    return this.messages.send(
      { conversationId: ctx.conversationId, type, content },
      ctx.userId,
      ctx.organizationId,
      ctx.access,
      undefined,
      // Já validamos acesso à conversa em `create` (assertConversationAccess);
      // sem `system: true` esta chamada ficaria escopada de novo (fail-closed
      // por padrão) sem `role` — redundante mas inofensivo, marcamos mesmo
      // assim para não depender de uma segunda checagem implícita.
      { system: true },
    );
  }

  /** Um print que falha não derruba a proposta (já enviada) nem os seguintes. */
  private async sendImages(ctx: SendContext, images: ProposalImage[]): Promise<void> {
    for (const image of images) {
      try {
        await this.sendToCustomer(ctx, 'IMAGE', {
          mediaUrl: image.url,
          mimeType: image.mimeType,
          ...(image.filename ? { fileName: image.filename } : {}),
          ...(image.size !== undefined ? { size: image.size } : {}),
        });
      } catch (err) {
        this.logger.warn(
          `proposal_image_failed conv=${ctx.conversationId}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * FRONTEIRA DE SEGURANÇA: a URL vem do cliente e vira leitura no storage.
   * Quem decide o que pode ser lido é `storageKeyFromUploadUrl` (só `media/`).
   */
  private imageKeyOrThrow(image: ProposalImageDto): string {
    const key = storageKeyFromUploadUrl(image.url);
    if (!key) throw new BadRequestException(INVALID_IMAGE);
    return key;
  }

  private loadImages(images: ProposalImageDto[], keys: string[]): Promise<LoadedImage[]> {
    return Promise.all(images.map((image, i) => this.loadImage(image, keys[i])));
  }

  /**
   * Lê um print do storage e confere que é mesmo uma imagem. O tipo que segue
   * adiante (visão, WhatsApp, registro) é o dos BYTES, não o declarado.
   */
  private async loadImage(image: ProposalImageDto, key: string): Promise<LoadedImage> {
    let buffer: Buffer;
    try {
      const stat = await this.storage.stat(key);
      if (!stat) throw new BadRequestException(INVALID_IMAGE);
      if (stat.size > PROPOSAL_IMAGE_MAX_BYTES) {
        throw new BadRequestException(
          `Imagem muito grande (máx. ${PROPOSAL_IMAGE_MAX_BYTES / 1024 / 1024} MB).`,
        );
      }
      buffer = await this.storage.getBuffer(key);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      // `JSON.stringify` na chave: ela vem do cliente e uma quebra de linha
      // decodificada deixaria forjar linha de log.
      this.logger.warn(
        `proposal_image_read_failed key=${JSON.stringify(key)}: ${(err as Error)?.message}`,
      );
      throw new BadRequestException(INVALID_IMAGE);
    }

    const mimeType = sniffImageMime(buffer);
    if (!mimeType) throw new BadRequestException(INVALID_IMAGE);

    return {
      image: {
        url: image.url,
        mimeType,
        ...(image.filename ? { filename: image.filename } : {}),
        ...(image.size !== undefined ? { size: image.size } : {}),
      },
      data: { mediaType: mimeType, data: buffer.toString('base64') },
    };
  }

  /**
   * Campos de ingresso que a tabela exige. OTHER não tem nenhum deles: zera
   * pessoas e parques e usa o momento do envio nas duas datas.
   */
  private toCart(extracted: ExtractedProposal): ExtractedCart {
    if (extracted.kind !== 'OTHER') {
      const { adults, children, startDate, endDate, parks, totalValue, currency } = extracted;
      return { adults, children, startDate, endDate, parks, totalValue, currency };
    }
    const now = new Date().toISOString();
    return {
      adults: 0,
      children: 0,
      startDate: now,
      endDate: now,
      parks: [],
      totalValue: extracted.totalValue,
      currency: extracted.currency,
    };
  }

  /** `details` da proposta; null quando é ingresso sem print (como sempre foi). */
  private buildDetails(
    extracted: ExtractedProposal,
    images: ProposalImage[],
  ): ProposalDetails | null {
    const withImages = images.length > 0 ? { images } : {};
    if (extracted.kind === 'OTHER') {
      return { title: extracted.title, lines: extracted.lines, ...withImages };
    }
    return images.length > 0 ? withImages : null;
  }

  /**
   * Pega a primeira URL http(s) de dentro do texto colado (pode ser só a URL
   * ou o link + resumo do carrinho em várias linhas). Retorna null se não achar.
   */
  private extractCheckoutUrl(pasted: string): string | null {
    const match = (pasted ?? '').match(/https?:\/\/[^\s<>"']+/i);
    if (!match) return null;
    // Remove pontuação de fim que costuma grudar quando a URL vem no meio de texto.
    return match[0].replace(/[.,);]+$/, '');
  }

  private assertAllowedUrl(rawUrl: string) {
    let host: string;
    try {
      host = new URL(rawUrl).hostname.toLowerCase();
    } catch {
      throw new BadRequestException('Link inválido.');
    }
    const ok = PROPOSAL_ALLOWED_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
    if (!ok) {
      throw new BadRequestException('Este link não é de um checkout permitido.');
    }
  }
}
