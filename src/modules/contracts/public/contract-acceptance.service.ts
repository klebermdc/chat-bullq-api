import { BadRequestException, ConflictException, GoneException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Contract } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../../database/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { StorageService } from '../../storage/storage.service';
import { ContractFilesService, sniffMime, type IncomingFile } from '../contract-files.service';
import { ContractSettingsService } from '../contract-settings.service';
import { ContractsService } from '../contracts.service';
import { readContractDates } from '../domain/park-dates';
import { assertSafePng } from '../domain/png-guard';
import { ContractNotifierService } from '../notify/contract-notifier.service';
import { ContractPdfService } from '../pdf/contract-pdf.service';

/**
 * O body JSON da API usa o limite padrão do Express (100 KB, sem config no
 * main.ts). 60 KB de PNG viram ~82 KB de base64, que cabem nele com folga.
 */
export const MAX_SIGNATURE_BYTES = 60 * 1024;
const MAX_USER_AGENT = 500;
const SIGNATURE_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

const TERMS_CHANGED_MESSAGE = 'Os termos foram atualizados. Recarregue a página e leia de novo antes de aceitar.';

export interface AcceptBody {
  signature: string;
  agree: boolean;
  /** sha256 hex dos termos que a página mostrou (`view().termsHash`). */
  termsHash: string;
}

export interface AcceptMeta {
  ip: string | null;
  userAgent: string | null;
}

/** Só os dois grupos finais do CPF: `***.***.*89-01`. */
export function maskCpf(cpf: string): string {
  const d = (cpf ?? '').replace(/\D/g, '');
  return d.length === 11 ? `***.***.*${d.slice(7, 9)}-${d.slice(9)}` : '***';
}

/** sha256 hex do texto dos termos: prova que o cliente aceitou o que viu. */
export function hashTerms(terms: string): string {
  return createHash('sha256').update(terms ?? '', 'utf8').digest('hex');
}

/** Data URL de PNG → bytes conferidos (assinatura e IHDR). Não toca em banco nem storage. */
function decodeSignature(dataUrl: string): Buffer {
  const m = SIGNATURE_DATA_URL.exec(dataUrl ?? '');
  const buf = m ? Buffer.from(m[1], 'base64') : null;
  if (!buf || buf.length > MAX_SIGNATURE_BYTES || sniffMime(buf) !== 'image/png' || !isSafePng(buf)) {
    throw new BadRequestException('Assinatura inválida: desenhe sua assinatura antes de aceitar.');
  }
  return buf;
}

function isSafePng(buf: Buffer): boolean {
  try {
    assertSafePng(buf);
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class ContractAcceptanceService {
  private readonly logger = new Logger(ContractAcceptanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly settings: ContractSettingsService,
    private readonly contracts: ContractsService,
    private readonly pdf: ContractPdfService,
    private readonly files: ContractFilesService,
    private readonly notifier: ContractNotifierService,
    private readonly realtime: RealtimeGateway,
  ) {}

  private async byToken(token: string): Promise<Contract> {
    const c = token ? await this.prisma.contract.findUnique({ where: { acceptanceToken: token } }) : null;
    if (!c) throw new NotFoundException('Contrato não encontrado ou link inválido');
    return c;
  }

  /** Só o que a página de aceite mostra. Lista explícita: campo novo no model não vaza sozinho. */
  async view(token: string) {
    const c = await this.byToken(token);
    const s = await this.settings.get(c.organizationId);
    const isUsd = c.amount.trim().startsWith('$');
    const terms = c.acceptedTermsText ?? s.terms;
    return {
      fullName: c.fullName,
      cpf: maskCpf(c.cpf),
      email: c.email,
      phone: c.phone,
      guideName: c.guideName,
      people: c.people,
      days: c.days,
      amount: c.amount,
      paymentMethod: c.paymentMethod,
      dates: readContractDates(c).map((d) => ({ label: d.label, date: d.date })),
      pixKey: isUsd ? null : (c.pixKey ?? s.defaultPixKey),
      usdInstructions: isUsd ? s.usdPaymentInstructions : null,
      terms,
      termsHash: hashTerms(terms ?? ''),
      accepted: !!c.acceptedAt,
      acceptedAt: c.acceptedAt,
      hasReceipt: !!c.paymentReceiptKey,
      companyName: s.companyName,
    };
  }

  async accept(token: string, body: AcceptBody, meta: AcceptMeta) {
    // Validação da entrada antes de qualquer acesso ao banco ou ao storage.
    if (body.agree !== true) throw new BadRequestException('É preciso concordar com os termos.');
    const sig = decodeSignature(body.signature);
    const c = await this.byToken(token);
    if (c.acceptedAt) throw new GoneException('Contrato já aceito');

    const { terms } = await this.settings.get(c.organizationId);
    if (!terms?.trim()) throw new BadRequestException('Termos do contrato não configurados');
    if (body.termsHash !== hashTerms(terms)) throw new ConflictException(TERMS_CHANGED_MESSAGE);

    const userAgent = meta.userAgent?.slice(0, MAX_USER_AGENT) ?? null;
    const signatureKey = `contracts/${c.organizationId}/${c.id}/signature-${randomUUID()}.png`;
    // Se outra aba aceitar entre o put e o updateMany (count 0), este PNG fica
    // órfão no MinIO. É aceitável: é pequeno, privado e não é referenciado.
    await this.storage.put(signatureKey, sig, 'image/png');
    const acceptedAt = new Date();
    const { count } = await this.prisma.contract.updateMany({
      where: { id: c.id, acceptedAt: null },
      data: { acceptedAt, signatureKey, acceptedTermsText: terms, clientIp: meta.ip, clientUserAgent: userAgent },
    });
    if (count === 0) throw new GoneException('Contrato já aceito');

    this.realtime.emitToOrg(c.organizationId, 'contract:accepted', { id: c.id });
    // O cliente não espera o Chromium: o PDF sai em segundo plano e, se falhar
    // ou ainda não tiver saído, `pdfForContract` monta um com a evidência.
    void this.storeAcceptancePdf(c, {
      acceptedAt, ip: meta.ip, userAgent, signaturePngBase64: sig.toString('base64'), acceptedTerms: terms,
    }).catch((err: Error) => this.logger.warn(`contract_acceptance_pdf_failed contract=${c.id} reason=${err.message}`));
    return { accepted: true, acceptedAt };
  }

  /** O aceite já vale sem o PDF: falha só loga, e `GET pdf` gera na hora com a evidência. */
  private async storeAcceptancePdf(
    c: Contract,
    acceptance: { acceptedAt: Date; ip: string | null; userAgent: string | null; signaturePngBase64: string; acceptedTerms: string },
  ): Promise<void> {
    try {
      const input = await this.contracts.buildPdfInput(c.organizationId, c, acceptance);
      const key = `contracts/${c.organizationId}/${c.id}/acceptance-${randomUUID()}.pdf`;
      await this.storage.put(key, await this.pdf.render(input), 'application/pdf');
      await this.prisma.contract.update({ where: { id: c.id }, data: { acceptancePdfKey: key } });
    } catch (err) {
      this.logger.warn(`contract_acceptance_pdf_failed contract=${c.id} reason=${(err as Error).message}`);
    }
  }

  /** PDF para o cliente baixar: o do aceite, ou gerado na hora. O token é o escopo. */
  async pdfByToken(token: string): Promise<{ key: string } | { buffer: Buffer }> {
    const c = await this.byToken(token);
    return this.contracts.pdfForContract(c.organizationId, c);
  }

  /** Um comprovante por link; trocar depois é com o operador, pelo painel. */
  async uploadReceipt(token: string, file: IncomingFile, appPublicUrl: string) {
    const c = await this.byToken(token);
    if (!c.acceptedAt) throw new ConflictException('Aceite o contrato antes de enviar o comprovante.');
    if (c.paymentReceiptKey) throw new ConflictException('Comprovante já enviado. Fale com a equipe para trocar.');
    const key = await this.files.store(c.organizationId, c.id, 'payment-receipt', file);
    const { count } = await this.prisma.contract.updateMany({
      where: { id: c.id, paymentReceiptKey: null },
      data: { paymentReceiptKey: key },
    });
    if (count === 0) throw new ConflictException('Comprovante já enviado.');
    // O comprovante já está gravado: falha no aviso só loga.
    const panelUrl = appPublicUrl ? `${appPublicUrl}/contratos/${c.id}` : null;
    try {
      await this.notifier.receiptUploaded(c.organizationId, c, panelUrl);
    } catch (err) {
      this.logger.warn(`contract_receipt_notify_failed contract=${c.id} reason=${(err as Error).message}`);
    }
    this.realtime.emitToOrg(c.organizationId, 'contract:changed', { id: c.id });
    return { received: true };
  }
}
