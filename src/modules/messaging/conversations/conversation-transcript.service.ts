import { Injectable, Logger } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { chromium } from 'playwright';
import { PrismaService } from '../../../database/prisma.service';
import type { ChannelAccess } from '../../iam/channel-access/channel-access.service';
import { ContactHistoryService } from '../messages/contact-history.service';
import { buildTranscriptHtml, type TranscriptMessage } from './transcript-html';

/**
 * Teto de mensagens no documento. Acima disso o PDF leva as mais recentes e
 * avisa na capa quantas ficaram de fora — cortar em silêncio num documento que
 * serve de prova é pior do que não gerar.
 */
export const MAX_TRANSCRIPT_MESSAGES = 5000;

/**
 * Histórico do cliente em PDF, gerado sob demanda e devolvido na resposta.
 *
 * Nada é gravado em disco de propósito: a rota `/uploads` não exige sessão hoje,
 * então um PDF com a conversa inteira guardado lá seria exposição de dado pessoal
 * a quem tivesse a URL.
 */
@Injectable()
export class ConversationTranscriptService {
  private readonly logger = new Logger(ConversationTranscriptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contactHistory: ContactHistoryService,
  ) {}

  async render(
    conversationId: string,
    organizationId: string,
    generatedBy: string,
    access: ChannelAccess = 'ALL',
    currentUserId?: string,
    role?: OrgRole,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    // Mesma resolução de escopo e permissão do "ver conversas anteriores".
    const scope = await this.contactHistory.resolveScope(
      conversationId,
      organizationId,
      access,
      currentUserId,
      role,
    );

    const total = await this.prisma.message.count({
      where: { conversationId: { in: scope.conversationIds } },
    });

    const rows = await this.prisma.message.findMany({
      where: { conversationId: { in: scope.conversationIds } },
      orderBy: { createdAt: 'desc' },
      take: MAX_TRANSCRIPT_MESSAGES,
      select: {
        id: true,
        conversationId: true,
        direction: true,
        type: true,
        content: true,
        senderName: true,
        createdAt: true,
        sender: { select: { name: true } },
      },
    });

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { contact: { select: { name: true, phone: true } } },
    });

    const messages = rows.reverse().map(
      (m): TranscriptMessage => ({
        id: m.id,
        conversationId: m.conversationId,
        direction: m.direction as 'INBOUND' | 'OUTBOUND',
        type: m.type,
        content: (m.content ?? {}) as Record<string, any>,
        senderName: m.senderName,
        sender: m.sender,
        createdAt: m.createdAt,
      }),
    );

    const html = buildTranscriptHtml({
      contact: conversation?.contact ?? { name: null, phone: null },
      generatedBy,
      generatedAt: new Date(),
      messages,
      conversations: scope.conversations,
      omittedByLimit: Math.max(0, total - messages.length),
      hiddenByChannelAccess: scope.hiddenByChannelAccess,
    });

    const buffer = await this.toPdf(html);
    this.logger.log(
      `transcript gerado: conv=${conversationId} conversas=${scope.conversationIds.length} msgs=${messages.length} por=${generatedBy}`,
    );

    return { buffer, fileName: this.fileNameFor(conversation?.contact?.name) };
  }

  /** Mesmo caminho do PDF do Aceite: HTML → Chromium → PDF. */
  private async toPdf(html: string): Promise<Buffer> {
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.PROPOSAL_CHROMIUM_PATH || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      return (await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate:
          '<div style="width:100%;font-size:8px;color:#71717a;text-align:center;">' +
          '<span class="pageNumber"></span>/<span class="totalPages"></span></div>',
      })) as Buffer;
    } finally {
      await browser.close();
    }
  }

  private fileNameFor(contactName?: string | null): string {
    const slug = (contactName || 'cliente')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
    const day = new Date().toISOString().slice(0, 10);
    return `historico-${slug}-${day}.pdf`;
  }
}
