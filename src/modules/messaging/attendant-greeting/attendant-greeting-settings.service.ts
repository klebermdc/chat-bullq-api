import { Injectable } from '@nestjs/common';
import { AttendantGreetingSettings } from '@prisma/client';
import { AttendantGreetingSettingsRepository } from './attendant-greeting-settings.repository';
import { UpdateAttendantGreetingSettingsDto } from './dto/update-attendant-greeting-settings.dto';

export const DEFAULT_ATTENDANT_GREETING_SETTINGS = {
  enabled: true,
  template: 'Oi! Sou o {atendente} e vou continuar seu atendimento por aqui 😊',
};

export type ResolvedAttendantGreetingSettings =
  typeof DEFAULT_ATTENDANT_GREETING_SETTINGS & { organizationId: string };

@Injectable()
export class AttendantGreetingSettingsService {
  constructor(private readonly repo: AttendantGreetingSettingsRepository) {}

  async get(organizationId: string): Promise<ResolvedAttendantGreetingSettings> {
    const row = await this.repo.find(organizationId);
    return {
      organizationId,
      ...DEFAULT_ATTENDANT_GREETING_SETTINGS,
      ...(row ? { enabled: row.enabled, template: row.template } : {}),
    };
  }

  update(
    organizationId: string,
    dto: UpdateAttendantGreetingSettingsDto,
  ): Promise<AttendantGreetingSettings> {
    const data: any = { ...dto };
    return this.repo.upsert(organizationId, data);
  }
}
