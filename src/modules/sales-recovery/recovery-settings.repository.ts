import { Injectable } from '@nestjs/common';
import { RecoverySettings } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/** Campos editáveis das configurações de recuperação por org. */
export interface RecoverySettingsData {
  outreachChannelId?: string | null;
  openerTemplateName?: string | null;
  followUpTemplateName?: string | null;
  templateLang?: string;
}

/**
 * Acesso Prisma da tabela `recovery_settings` (1 registro por org). Guarda o
 * NOME dos templates HSM que a recuperação usa por org — a convenção de
 * variáveis ({{1}}=nome, {{2}}=produto) fica no código.
 */
@Injectable()
export class RecoverySettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  getByOrg(organizationId: string): Promise<RecoverySettings | null> {
    return this.prisma.recoverySettings.findUnique({
      where: { organizationId },
    });
  }

  upsert(
    organizationId: string,
    data: RecoverySettingsData,
  ): Promise<RecoverySettings> {
    return this.prisma.recoverySettings.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
  }
}
