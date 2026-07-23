import { Injectable } from '@nestjs/common';

@Injectable()
export class OrderFichaSettingsService {
  /** Prazo (horas) sem carrinho até alertar demora. Default 24h. Configurável por org futuramente. */
  async delayHoursFor(_organizationId: string): Promise<number> {
    return 24;
  }
}
