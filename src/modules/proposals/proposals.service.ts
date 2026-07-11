import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RenderService } from './render.service';
import { ExtractionService } from './extraction.service';
import { ProposalsRepository } from './proposals.repository';
import { MessagesService } from '../messaging/messages/messages.service';
import type { ChannelAccess } from '../iam/channel-access/channel-access.service';
import { buildProposalMessage } from './message-builder';
import { CreateProposalDto } from './dto/create-proposal.dto';
import { PROPOSAL_ALLOWED_HOSTS } from './proposals.constants';

@Injectable()
export class ProposalsService {
  private readonly logger = new Logger(ProposalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly render: RenderService,
    private readonly extraction: ExtractionService,
    private readonly repo: ProposalsRepository,
    private readonly messages: MessagesService,
  ) {}

  async create(
    dto: CreateProposalDto,
    userId: string,
    organizationId: string,
    access: ChannelAccess,
  ) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: dto.conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.organizationId !== organizationId) throw new ForbiddenException();

    // O atendente cola o link OU o bloco inteiro (link + resumo do carrinho).
    // Extraímos a URL de dentro do que foi colado; o texto completo vira
    // contexto extra pra extração.
    const pasted = dto.checkoutUrl;
    const url = this.extractCheckoutUrl(pasted);
    if (!url) {
      throw new BadRequestException(
        'Não encontrei um link de checkout no que foi colado. Cole o link (pode ser junto com o resumo).',
      );
    }
    this.assertAllowedUrl(url);

    let rawText: string;
    try {
      rawText = await this.render.render(url);
    } catch (err) {
      this.logger.warn(`proposal_render_failed url=${url}: ${(err as Error).message}`);
      throw new BadRequestException(
        'Não foi possível abrir o carrinho. Confere o link e tenta de novo.',
      );
    }

    let cart;
    try {
      cart = await this.extraction.extract(organizationId, rawText, pasted);
    } catch (err) {
      this.logger.warn(
        `proposal_extract_failed url=${url}: ${(err as Error).message}`,
      );
      throw new BadRequestException(
        (err as Error).message ||
          'Não foi possível ler o carrinho. Confere o link e tenta de novo.',
      );
    }

    const proposal = await this.repo.create({
      organizationId,
      contactId: conversation.contactId,
      conversationId: conversation.id,
      checkoutUrl: url,
      createdById: userId,
      cart,
      rawText,
    });

    const text = buildProposalMessage(cart, url, dto.mode ?? 'NEW');
    await this.messages.send(
      { conversationId: conversation.id, type: 'TEXT', content: { text } },
      userId,
      organizationId,
      access,
    );

    return proposal;
  }

  listForContact(organizationId: string, contactId: string) {
    return this.repo.listForContact(organizationId, contactId);
  }

  /**
   * Propostas do contato de uma conversa — usado pelo modal pra decidir o padrão
   * (se já existe proposta, o modal abre em "Atualização").
   */
  async listForConversation(organizationId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { organizationId: true, contactId: true },
    });
    if (!conversation || conversation.organizationId !== organizationId) {
      return [];
    }
    return this.repo.listForContact(organizationId, conversation.contactId);
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
