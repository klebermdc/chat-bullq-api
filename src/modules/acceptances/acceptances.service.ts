import { BadRequestException, GoneException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AcceptancePdfService } from './acceptance-pdf.service';
import { AcceptanceEffectsService } from './acceptance-effects.service';
import { StorageService } from '../storage/storage.service';
import { generateAcceptanceToken } from './acceptance-token.util';
import { AcceptanceItem, PublicAcceptanceView } from './acceptances.types';

const DEFAULT_TERM = (org: string) =>
  `Declaro que recebi de ${org} os itens listados abaixo, que conferi cada um deles e que está tudo correto.`;
const ACCEPTANCE_TTL_DAYS = 30;

@Injectable()
export class AcceptancesService {
  private readonly logger = new Logger(AcceptancesService.name);

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

  private isExpired(acc: { expiresAt: Date | null }): boolean {
    return !!acc.expiresAt && acc.expiresAt.getTime() < Date.now();
  }

  private pdfUrl(pdfKey: string | null): string | null {
    return pdfKey ? `/api/v1/uploads/${pdfKey}` : null;
  }

  async getByToken(token: string): Promise<PublicAcceptanceView> {
    const acc = await this.prisma.orderAcceptance.findUnique({
      where: { token }, include: { organization: { select: { name: true } } },
    });
    if (!acc) throw new NotFoundException('Aceite não encontrado.');
    let status = acc.status;
    if (status === 'PENDING' && this.isExpired(acc)) {
      status = 'EXPIRED';
      await this.prisma.orderAcceptance.update({ where: { id: acc.id }, data: { status: 'EXPIRED' } });
    }
    return {
      status: status as any,
      organizationName: acc.organization.name,
      items: (acc.items as any) ?? [],
      termText: acc.termText,
      signedAt: acc.signedAt ? acc.signedAt.toISOString() : null,
      signerName: acc.signerName ?? null,
      pdfUrl: this.pdfUrl(acc.pdfKey),
    };
  }

  async sign(token: string, input: { name: string; ip: string; userAgent: string }): Promise<any> {
    const acc = await this.prisma.orderAcceptance.findUnique({
      where: { token }, include: { organization: { select: { name: true } } },
    });
    if (!acc) throw new NotFoundException('Aceite não encontrado.');
    if (acc.status === 'SIGNED') throw new GoneException('Este aceite já foi assinado.');
    if (acc.status === 'CANCELED') throw new GoneException('Este aceite foi cancelado.');
    if (acc.status === 'EXPIRED' || this.isExpired(acc)) {
      if (acc.status !== 'EXPIRED') {
        await this.prisma.orderAcceptance.update({ where: { id: acc.id }, data: { status: 'EXPIRED' } });
      }
      throw new GoneException('O prazo para este aceite expirou. Peça um novo link ao atendente.');
    }

    const signedAt = new Date();
    const pdfBuf = await this.pdf.render({
      organizationName: acc.organization.name,
      termText: acc.termText,
      items: (acc.items as any) ?? [],
      signerName: input.name,
      signedAt,
      signerIp: input.ip,
    });
    const pdfKey = `acceptances/${signedAt.toISOString().slice(0, 10)}/${acc.id}.pdf`;
    await this.storage.put(pdfKey, pdfBuf, 'application/pdf');

    const signed = await this.prisma.orderAcceptance.update({
      where: { id: acc.id },
      data: {
        status: 'SIGNED', signedAt, signerName: input.name,
        signerIp: input.ip || null, signerUserAgent: input.userAgent || null, pdfKey,
      },
    });

    try {
      await this.effects.onSigned({
        id: signed.id, organizationId: signed.organizationId, conversationId: signed.conversationId,
        cardId: signed.cardId, signerName: input.name, signedAt,
      });
    } catch (err) {
      this.logger.error(`Aceite ${signed.id} assinado, mas efeitos pós-assinatura falharam: ${err instanceof Error ? err.message : err}`);
    }
    return signed;
  }

  async resend(organizationId: string, id: string): Promise<{ acceptance: any; link: string }> {
    const base = this.baseUrl();
    const acc = await this.prisma.orderAcceptance.findFirst({ where: { id, organizationId } });
    if (!acc) throw new NotFoundException('Aceite não encontrado.');
    if (acc.status === 'SIGNED') throw new GoneException('Este aceite já foi assinado.');
    const expiresAt = new Date(Date.now() + ACCEPTANCE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const updated = await this.prisma.orderAcceptance.update({
      where: { id: acc.id }, data: { status: 'PENDING', expiresAt },
    });
    return { acceptance: updated, link: `${base}/aceite/${acc.token}` };
  }

  async getStatusForConversation(organizationId: string, conversationId: string) {
    const acc = await this.prisma.orderAcceptance.findFirst({
      where: { organizationId, conversationId }, orderBy: { createdAt: 'desc' },
    });
    if (!acc) return null;
    return {
      id: acc.id, status: acc.status, items: acc.items,
      signedAt: acc.signedAt, signerName: acc.signerName,
      signerIp: acc.signerIp, signerUserAgent: acc.signerUserAgent,
      pdfUrl: this.pdfUrl(acc.pdfKey), createdAt: acc.createdAt, expiresAt: acc.expiresAt,
    };
  }
}
