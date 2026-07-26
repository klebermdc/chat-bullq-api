import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AcceptancePdfService } from './acceptance-pdf.service';
import { AcceptanceEffectsService } from './acceptance-effects.service';
import { StorageService } from '../storage/storage.service';
import { generateAcceptanceToken } from './acceptance-token.util';
import { AcceptanceItem } from './acceptances.types';

const DEFAULT_TERM = (org: string) =>
  `Declaro que recebi de ${org} os itens listados abaixo, que conferi cada um deles e que está tudo correto.`;
const ACCEPTANCE_TTL_DAYS = 30;

@Injectable()
export class AcceptancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: AcceptancePdfService,
    private readonly effects: AcceptanceEffectsService,
    private readonly storage: StorageService,
  ) {}

  private baseUrl(): string {
    const url = process.env.APP_PUBLIC_URL;
    if (!url) throw new BadRequestException('APP_PUBLIC_URL não configurado — não é possível gerar o link de aceite.');
    return url.replace(/\/+$/, '');
  }

  async createForConversation(
    organizationId: string,
    conversationId: string,
    input: { items: AcceptanceItem[]; termText?: string; createdById: string },
  ): Promise<{ acceptance: any; link: string }> {
    const base = this.baseUrl();
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
      include: { organization: { select: { name: true } } },
    });
    if (!conv) throw new BadRequestException('Conversa não encontrada nesta organização.');

    const card = await this.prisma.card.findFirst({
      where: { conversationId, organizationId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    const token = generateAcceptanceToken();
    const expiresAt = new Date(Date.now() + ACCEPTANCE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const acceptance = await this.prisma.orderAcceptance.create({
      data: {
        organizationId,
        conversationId,
        contactId: conv.contactId,
        cardId: card?.id ?? null,
        token,
        items: (input.items ?? []) as any,
        termText: input.termText?.trim() || DEFAULT_TERM(conv.organization.name),
        status: 'PENDING',
        createdById: input.createdById,
        expiresAt,
      },
    });
    return { acceptance, link: `${base}/aceite/${token}` };
  }
}
