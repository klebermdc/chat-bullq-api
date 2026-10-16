import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { StorageService } from '../storage/storage.service';
import { ALLOWED_FILE_MIME, MAX_FILE_BYTES, type ContractFileKind } from './contracts.constants';

export type ReadableFileKind = ContractFileKind | 'signature' | 'acceptance-pdf';

const FIELD: Record<ReadableFileKind, 'signedContractKey' | 'paymentReceiptKey' | 'signatureKey' | 'acceptancePdfKey'> = {
  'signed-contract': 'signedContractKey',
  'payment-receipt': 'paymentReceiptKey',
  signature: 'signatureKey',
  'acceptance-pdf': 'acceptancePdfKey',
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const HEIC_BRANDS = ['ftypheic', 'ftypheix', 'ftypmif1', 'ftypmsf1', 'ftyphevc'];

export interface IncomingFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
}

/** Tipo real pelos bytes iniciais — o mime declarado pelo navegador não basta. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.subarray(0, 8).equals(PNG_MAGIC)) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  if (HEIC_BRANDS.includes(buf.subarray(4, 12).toString('latin1'))) return 'image/heic';
  return null;
}

@Injectable()
export class ContractFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Valida e grava; devolve a chave. Usado também pelo aceite público (2B). */
  async store(organizationId: string, contractId: string, kind: string, file: IncomingFile): Promise<string> {
    if (!file?.buffer?.length) throw new BadRequestException('Arquivo vazio');
    // O tamanho real do buffer manda; `size` vem do cliente/multer.
    if (file.buffer.length > MAX_FILE_BYTES || file.size > MAX_FILE_BYTES) {
      throw new BadRequestException('Arquivo maior que 10 MB');
    }
    const declared = (file.mimetype || '').split(';')[0].trim().toLowerCase();
    const ext = ALLOWED_FILE_MIME[declared];
    if (!ext || sniffMime(file.buffer) !== declared) {
      throw new BadRequestException('Envie PDF, PNG, JPG, WEBP ou HEIC.');
    }
    const key = `contracts/${organizationId}/${contractId}/${kind}-${Date.now()}.${ext}`;
    await this.storage.put(key, file.buffer, declared);
    return key;
  }

  async upload(organizationId: string, contractId: string, kind: ContractFileKind, file: IncomingFile) {
    await this.ensureContract(organizationId, contractId);
    const key = await this.store(organizationId, contractId, kind, file);
    await this.prisma.contract.updateMany({
      where: { id: contractId, organizationId },
      data: { [FIELD[kind]]: key },
    });
    this.realtime.emitToOrg(organizationId, 'contract:changed', { id: contractId });
    return key;
  }

  /** O arquivo antigo continua no MinIO (histórico); só o campo volta a null. */
  async clear(organizationId: string, contractId: string, kind: ContractFileKind) {
    await this.ensureContract(organizationId, contractId);
    await this.prisma.contract.updateMany({
      where: { id: contractId, organizationId },
      data: { [FIELD[kind]]: null },
    });
    this.realtime.emitToOrg(organizationId, 'contract:changed', { id: contractId });
    return { cleared: true };
  }

  async keyFor(organizationId: string, contractId: string, kind: ReadableFileKind): Promise<string> {
    const contract = await this.ensureContract(organizationId, contractId);
    const key = (contract as Record<string, unknown>)[FIELD[kind]];
    const isOwnKey =
      typeof key === 'string' && key.startsWith(`contracts/${organizationId}/`) && !key.split('/').includes('..');
    if (!isOwnKey) throw new NotFoundException('Arquivo não encontrado');
    return key;
  }

  async stream(key: string, res: Response, downloadName: string) {
    const stat = await this.storage.stat(key);
    if (!stat) throw new NotFoundException('Arquivo não encontrado');
    res.setHeader('Content-Type', stat.contentType);
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${downloadName.replace(/[^\w.-]/g, '_')}"`);
    (await this.storage.getStream(key)).pipe(res);
  }

  private async ensureContract(organizationId: string, id: string) {
    const contract = await this.prisma.contract.findFirst({ where: { id, organizationId } });
    if (!contract) throw new NotFoundException('Contrato não encontrado');
    return contract;
  }
}
