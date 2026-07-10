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

    this.assertAllowedUrl(dto.checkoutUrl);

    let rawText: string;
    try {
      rawText = await this.render.render(dto.checkoutUrl);
    } catch (err) {
      this.logger.warn(`proposal_render_failed url=${dto.checkoutUrl}: ${(err as Error).message}`);
      throw new BadRequestException(
        'Não foi possível abrir o carrinho. Confere o link e tenta de novo.',
      );
    }

    let cart;
    try {
      cart = await this.extraction.extract(organizationId, rawText);
    } catch (err) {
      this.logger.warn(
        `proposal_extract_failed url=${dto.checkoutUrl}: ${(err as Error).message}`,
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
      checkoutUrl: dto.checkoutUrl,
      createdById: userId,
      cart,
      rawText,
    });

    const text = buildProposalMessage(cart, dto.checkoutUrl);
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
