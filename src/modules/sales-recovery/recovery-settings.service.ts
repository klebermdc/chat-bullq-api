import { Injectable } from '@nestjs/common';
import { RecoverySettings } from '@prisma/client';
import {
  RecoverySettingsData,
  RecoverySettingsRepository,
} from './recovery-settings.repository';

/**
 * Configuração de recuperação por org. Hoje o NOME do template usado no
 * outreach vinha só de env (`RECOVERY_OPENER_TEMPLATE_NAME`). Aqui ele passa
 * a poder vir de um registro no banco por org — o env continua sendo o
 * fallback no ponto de envio (`RecoveryOutreachService`).
 */
export interface RecoverySettingsView {
  outreachChannelId: string | null;
  openerTemplateName: string | null;
  followUpTemplateName: string | null;
  templateLang: string;
}

const DEFAULTS: RecoverySettingsView = {
  outreachChannelId: null,
  openerTemplateName: null,
  followUpTemplateName: null,
  templateLang: 'pt_BR',
};

@Injectable()
export class RecoverySettingsService {
  constructor(private readonly repo: RecoverySettingsRepository) {}

  /**
   * Retorna a config da org OU um default seguro (sem quebrar) quando ainda
   * não há registro. Nunca lança — o outreach depende disso pra decidir o
   * template com fallback no env.
   */
  async getForOrg(organizationId: string): Promise<RecoverySettingsView> {
    const row = await this.repo.getByOrg(organizationId);
    if (!row) return { ...DEFAULTS };
    return {
      outreachChannelId: row.outreachChannelId,
      openerTemplateName: row.openerTemplateName,
      followUpTemplateName: row.followUpTemplateName,
      templateLang: row.templateLang,
    };
  }

  /** Cria/atualiza (upsert) a config da org. */
  update(
    organizationId: string,
    dto: RecoverySettingsData,
  ): Promise<RecoverySettings> {
    return this.repo.upsert(organizationId, dto);
  }
}
