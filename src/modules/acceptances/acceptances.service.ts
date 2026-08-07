import { BadRequestException, GoneException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { AcceptancePdfService } from './acceptance-pdf.service';
import { AcceptanceEffectsService } from './acceptance-effects.service';
import { StorageService } from '../storage/storage.service';
import { VoucherExtractorService } from './voucher-extractor.service';
import { generateAcceptanceToken } from './acceptance-token.util';
import { extractPdfText } from './pdf-text.util';
import { storageKeyFromUploadUrl } from './storage-key.util';
import { AcceptanceItem, PublicAcceptanceView, VoucherInput, VoucherRef } from './acceptances.types';

const DEFAULT_TERM = (org: string) =>
  `Confirmo que recebi de ${org} os produtos/serviços listados abaixo e que conferi cada item — datas, quantidades e informações — estando tudo correto e de acordo com o combinado.`;
const ACCEPTANCE_TTL_DAYS = 30;

@Injectable()
export class AcceptancesService {
  private readonly logger = new Logger(AcceptancesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: AcceptancePdfService,
    private readonly effects: AcceptanceEffectsService,
    private readonly storage: StorageService,
    private readonly voucherExtractor: VoucherExtractorService,
  ) {}

  private baseUrl(): string {
    const url = process.env.APP_PUBLIC_URL;
    if (!url) throw new BadRequestException('APP_PUBLIC_URL não configurado — não é possível gerar o link de aceite.');
    return url.replace(/\/+$/, '');
  }

  /**
   * Calcula o SHA-256 de cada voucher lendo o arquivo do storage. O hash é
   * calculado AQUI, não no navegador: hash mandado pelo client não prova nada.
   * Arquivo ilegível vira hash vazio — o aceite não pode ser bloqueado por
   * isso, mas o comprovante deixa claro quando não há hash.
   */
  private async withHashes(vouchers: VoucherInput[]): Promise<VoucherRef[]> {
    return Promise.all(
      vouchers.map(async (v) => {
        const key = storageKeyFromUploadUrl(v.url);
        if (!key) return { ...v, sha256: '' };
        try {
          const buf = await this.storage.getBuffer(key);
          return { ...v, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
        } catch (err) {
          // `JSON.stringify` no nome: ele vem do cliente e uma quebra de linha
          // no nome do arquivo deixaria forjar linha de log (mesmo motivo do
          // `extractVoucher`).
          this.logger.warn(
            `sem hash para ${JSON.stringify(v.filename)}: ${(err as Error)?.message ?? err}`,
          );
          return { ...v, sha256: '' };
        }
      }),
    );
  }

  async createForConversation(
    organizationId: string,
    conversationId: string,
    input: {
      items: AcceptanceItem[];
      termText?: string;
      createdById: string;
      vouchers?: VoucherInput[];
      orderRef?: string;
    },
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

    const vouchers = input.vouchers?.length ? await this.withHashes(input.vouchers) : [];

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
        vouchers: vouchers as any,
        orderRef: input.orderRef?.trim() || null,
        termText: input.termText?.trim() || DEFAULT_TERM(conv.organization.name),
        status: 'PENDING',
        createdById: input.createdById,
        expiresAt,
      },
    });
    return { acceptance, link: `${base}/aceite/${token}` };
  }

  /**
   * Indireção fina para o `extractPdfText`, só para o teste do fluxo poder
   * substituir a leitura sem carregar o pdfjs.
   */
  protected readPdfText(buffer: Buffer): Promise<string> {
    return extractPdfText(buffer);
  }

  /**
   * Lê um voucher já subido via `messages/uploads/media` e devolve os itens
   * para o modal preencher. Falha suave: PDF ilegível devolve lista vazia com
   * aviso, nunca erro — o atendente segue digitando à mão e o envio continua.
   */
  async extractVoucher(
    organizationId: string,
    input: { mediaUrl: string },
  ): Promise<{ items: AcceptanceItem[]; orderRef: string | null; warning?: string }> {
    const key = storageKeyFromUploadUrl(input.mediaUrl);
    if (!key) {
      throw new BadRequestException('Arquivo inválido para leitura.');
    }

    let buffer: Buffer;
    try {
      buffer = await this.storage.getBuffer(key);
    } catch (err) {
      // `JSON.stringify` na chave: ela vem do cliente e um `%0A` decodificado
      // vira quebra de linha de verdade, deixando forjar linha de log.
      this.logger.warn(
        `voucher não encontrado no storage (${JSON.stringify(key)}): ${(err as Error)?.message}`,
      );
      throw new NotFoundException('Arquivo não encontrado.');
    }

    const text = await this.readPdfText(buffer);
    if (!text) {
      return {
        items: [],
        orderRef: null,
        warning:
          'Não consegui ler este PDF (provavelmente é uma imagem escaneada). Confira os itens à mão — o voucher será enviado normalmente.',
      };
    }

    const { items, orderRef } = await this.voucherExtractor.extract(
      text,
      organizationId,
    );
    return { items, orderRef };
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
      vouchers: ((acc.vouchers as any) ?? []) as VoucherRef[],
      orderRef: acc.orderRef ?? null,
    };
  }

  async sign(token: string, input: { name: string; ip: string; userAgent: string }): Promise<PublicAcceptanceView> {
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
      vouchers: ((acc.vouchers as any) ?? []) as VoucherRef[],
      orderRef: acc.orderRef ?? null,
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
    return {
      status: signed.status,
      organizationName: acc.organization.name,
      items: (signed.items as any) ?? [],
      termText: signed.termText,
      signedAt: signed.signedAt ? signed.signedAt.toISOString() : null,
      signerName: signed.signerName ?? null,
      pdfUrl: this.pdfUrl(signed.pdfKey),
      vouchers: ((signed.vouchers as any) ?? []) as VoucherRef[],
      orderRef: signed.orderRef ?? null,
    };
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
