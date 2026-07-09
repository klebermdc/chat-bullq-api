import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { MetaCapiHttpClient } from './meta-capi.http-client';
import { UpsertMetaCapiDto } from './dto/upsert-meta-capi.dto';

const PUBLIC_SELECT = {
  datasetId: true,
  tokenPreview: true,
  testEventCode: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface ResolvedMetaCapiConfig {
  datasetId: string;
  token: string;
  testEventCode: string | null;
  enabled: boolean;
}

@Injectable()
export class MetaCapiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly http: MetaCapiHttpClient,
  ) {}

  /** Config pública (sem token) — usada pela UI. `null` se nunca configurada. */
  async getConfig(organizationId: string) {
    return this.prisma.metaCapiConfig.findUnique({
      where: { organizationId },
      select: PUBLIC_SELECT,
    });
  }

  /** Cria ou atualiza a config da org. Cifra o token quando enviado. */
  async upsert(organizationId: string, dto: UpsertMetaCapiDto) {
    const existing = await this.prisma.metaCapiConfig.findUnique({
      where: { organizationId },
      select: { id: true },
    });

    if (!existing && !dto.token) {
      throw new BadRequestException(
        'Token é obrigatório na primeira configuração',
      );
    }

    const tokenFields = dto.token
      ? {
          encryptedToken: this.crypto.encrypt(dto.token),
          tokenPreview: this.crypto.preview(dto.token),
        }
      : {};

    await this.prisma.metaCapiConfig.upsert({
      where: { organizationId },
      create: {
        organizationId,
        datasetId: dto.datasetId,
        testEventCode: dto.testEventCode ?? null,
        enabled: dto.enabled ?? false,
        // `create` sempre tem token (garantido acima).
        encryptedToken: tokenFields.encryptedToken!,
        tokenPreview: tokenFields.tokenPreview!,
      },
      update: {
        datasetId: dto.datasetId,
        ...(dto.testEventCode !== undefined
          ? { testEventCode: dto.testEventCode || null }
          : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...tokenFields,
      },
    });

    return this.getConfig(organizationId);
  }

  async remove(organizationId: string) {
    await this.prisma.metaCapiConfig.deleteMany({ where: { organizationId } });
    return { message: 'Configuração removida' };
  }

  /**
   * Dispara um evento de teste ("Purchase" fictício) pra validar credenciais
   * no Events Manager → Test Events. Funciona mesmo com `enabled=false`.
   */
  async sendTest(organizationId: string) {
    const row = await this.prisma.metaCapiConfig.findUnique({
      where: { organizationId },
    });
    if (!row) throw new BadRequestException('Configure o Dataset e o token antes de testar');

    const result = await this.http.sendEvents({
      datasetId: row.datasetId,
      token: this.crypto.decrypt(row.encryptedToken),
      testEventCode: row.testEventCode,
      data: [
        {
          event_name: 'Purchase',
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'business_messaging',
          messaging_channel: 'whatsapp',
          event_id: `test-${organizationId}-${Date.now()}`,
          user_data: { ph: [this.testHash()] },
          custom_data: { value: 1, currency: 'BRL' },
        },
      ],
    });

    if (!result.ok) {
      throw new BadRequestException({
        message: 'Meta rejeitou o evento de teste',
        details: result.body,
      });
    }
    return { ok: true, response: result.body };
  }

  private testHash() {
    // hash fixo de um telefone de teste — só pra popular user_data no teste.
    return createHash('sha256').update('5511900000000').digest('hex');
  }

  /**
   * Config com token decifrado, para o processor/http-client. `null` quando
   * não há config ou está desligada — o chamador trata como "não enviar".
   */
  async resolveConfig(
    organizationId: string,
  ): Promise<ResolvedMetaCapiConfig | null> {
    const row = await this.prisma.metaCapiConfig.findUnique({
      where: { organizationId },
    });
    if (!row || !row.enabled) return null;
    return {
      datasetId: row.datasetId,
      token: this.crypto.decrypt(row.encryptedToken),
      testEventCode: row.testEventCode,
      enabled: row.enabled,
    };
  }
}
