import { BadRequestException, GoneException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { AcceptancePdfService } from './acceptance-pdf.service';
import { AcceptanceEffectsService } from './acceptance-effects.service';
import { StorageService } from '../storage/storage.service';
import { VoucherExtractorService } from './voucher-extractor.service';
import { generateAcceptanceToken } from './acceptance-token.util';
import { extractPdfText } from './pdf-text.util';
import { renderPdfToPngs } from './pdf-render.util';
import { storageKeyFromUploadUrl } from './storage-key.util';
import { AcceptanceItem, PublicAcceptanceView, VoucherInput, VoucherRef } from './acceptances.types';

// O nome da org é interpolado de propósito (o texto original dizia "da OFP"):
// numa instalação multi-org, o cliente de outra empresa não pode assinar um
// documento declarando que recebeu da OFP.
const DEFAULT_TERM = (org: string) =>
  `Declaro que recebi da ${org} todos os produtos e/ou serviços relacionados abaixo e que realizei a conferência das respectivas datas, quantidades, informações e demais detalhes. Confirmo que os itens estão corretos, completos e de acordo com o que foi previamente contratado e acordado.`;
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
      include: { organization: { select: { name: true, cancellationPolicy: true } } },
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
        // Snapshot: o aceite guarda a política vigente AGORA. Ler por relação
        // faria uma edição futura reescrever um documento já assinado.
        policyText: conv.organization.cancellationPolicy?.trim() || null,
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

    // Caminho barato primeiro: PDF com camada de texto nunca paga visão.
    const text = await this.readPdfText(buffer);
    if (text) {
      const { items, orderRef } = await this.voucherExtractor.extract(
        text,
        organizationId,
      );
      return { items, orderRef };
    }

    // Sem camada de texto = voucher escaneado. Rasteriza as páginas e tenta
    // por visão. Só aqui, nunca antes: imagem custa muito mais token que texto.
    const images = await this.renderPdfPages(buffer);
    if (images.length) {
      // Log deliberado e no nível `warn`: sem esta linha ninguém descobre que
      // está pagando visão em TODO voucher — foi justamente a ausência dela
      // que fez o diagnóstico deste caso levar meia hora.
      this.logger.warn(
        `voucher sem camada de texto — caindo no caminho de visão (${images.length} página(s) rasterizada(s))`,
      );
      const { items, orderRef } = await this.voucherExtractor.extractFromImages(
        images,
        organizationId,
      );
      // `orderRef` sozinho já é leitura: só cai no aviso quando não veio nada.
      if (items.length || orderRef) return { items, orderRef };
    }

    return {
      items: [],
      orderRef: null,
      warning:
        'Não consegui ler este PDF, nem pelo texto nem pela imagem. Confira os itens à mão — o voucher será enviado normalmente.',
    };
  }

  /**
   * Mesma leitura, a partir do texto COLADO pelo atendente. Existe porque a
   * conversão PDF→texto é a etapa que falha em produção (voucher escaneado não
   * tem camada de texto); aqui ela simplesmente não existe. Convive com o
   * `extractVoucher` de propósito — as duas fontes se somam, não se substituem.
   *
   * Devolve o MESMO formato do irmão para o modal não precisar saber de onde
   * veio a leitura.
   */
  async extractVoucherText(
    organizationId: string,
    input: { text: string },
  ): Promise<{ items: AcceptanceItem[]; orderRef: string | null }> {
    // Texto em branco não paga token: o extrator já devolveria vazio, mas
    // deixar a chamada sair cobra uma ida ao LLM por campo vazio do atendente.
    if (!input.text?.trim()) return { items: [], orderRef: null };

    const { items, orderRef } = await this.voucherExtractor.extract(
      input.text,
      organizationId,
    );
    return { items, orderRef };
  }

  /** Seam de teste, igual ao `readPdfText`: o pdfjs tem teste próprio. */
  protected renderPdfPages(buffer: Buffer): Promise<Buffer[]> {
    return renderPdfToPngs(buffer);
  }

  private isExpired(acc: { expiresAt: Date | null }): boolean {
    return !!acc.expiresAt && acc.expiresAt.getTime() < Date.now();
  }

  /**
   * O PDF assinado saiu de `/uploads`, que serve sem sessão para provedor
   * externo baixar mídia. Ele tem assinatura, IP e dado pessoal, e ficava
   * baixável por quem tivesse a URL — de qualquer organização.
   *
   * Agora tem dois caminhos autorizados, um por audiência: o cliente não tem
   * login, mas tem o token do aceite; o atendente tem sessão.
   */
  private pdfUrlForToken(token: string, pdfKey: string | null): string | null {
    return pdfKey ? `/api/v1/public/acceptances/${token}/pdf` : null;
  }

  private pdfUrlForOrg(id: string, pdfKey: string | null): string | null {
    return pdfKey ? `/api/v1/acceptances/${id}/pdf` : null;
  }

  /** Bytes do PDF para o cliente, autorizado pelo token do próprio aceite. */
  async pdfForToken(token: string): Promise<{ buffer: Buffer; fileName: string }> {
    const acc = await this.prisma.orderAcceptance.findUnique({
      where: { token },
      select: { id: true, pdfKey: true },
    });
    return this.readPdf(acc);
  }

  /** Bytes do PDF para o atendente, escopado à organização dele. */
  async pdfForOrg(
    id: string,
    organizationId: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const acc = await this.prisma.orderAcceptance.findFirst({
      where: { id, organizationId },
      select: { id: true, pdfKey: true },
    });
    return this.readPdf(acc);
  }

  private async readPdf(acc: { id: string; pdfKey: string | null } | null) {
    // Mesmo 404 para "não existe" e "não é seu": diferenciar os dois confirmaria
    // a existência de um aceite alheio para quem chutar ids.
    if (!acc?.pdfKey) throw new NotFoundException('Aceite não encontrado.');
    return {
      buffer: await this.storage.getBuffer(acc.pdfKey),
      fileName: `aceite-${acc.id}.pdf`,
    };
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
      policyText: acc.policyText ?? null,
      signedAt: acc.signedAt ? acc.signedAt.toISOString() : null,
      signerName: acc.signerName ?? null,
      pdfUrl: this.pdfUrlForToken(token, acc.pdfKey),
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
      policyText: acc.policyText ?? null,
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
      policyText: signed.policyText ?? null,
      signedAt: signed.signedAt ? signed.signedAt.toISOString() : null,
      signerName: signed.signerName ?? null,
      pdfUrl: this.pdfUrlForToken(token, signed.pdfKey),
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
      pdfUrl: this.pdfUrlForOrg(acc.id, acc.pdfKey), createdAt: acc.createdAt, expiresAt: acc.expiresAt,
    };
  }
}
