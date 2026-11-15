import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  PERSONAL_DATA_SELECT,
  personalDataToValues,
  valuesToPersonalData,
} from './personal-data.util';

/**
 * Dados pessoais do cliente lembrados dos contratos. Só o preenchimento de
 * contrato usa esta tabela; nenhuma rota de contato a expõe. Nunca loga
 * valores — no máximo ids e contagens.
 */
@Injectable()
export class ContactPersonalDataService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `{ "[CPF do Cliente]": "…" }` do contato, escopado pela org. Com
   * `placeholders`, as chaves saem na grafia do modelo.
   */
  async findValues(
    organizationId: string,
    contactId: string,
    placeholders?: readonly string[],
  ): Promise<Record<string, string>> {
    const row = await this.prisma.contactPersonalData.findFirst({
      where: { contactId, organizationId },
      select: PERSONAL_DATA_SELECT,
    });
    return personalDataToValues(row, placeholders);
  }

  /**
   * Grava os campos pessoais preenchidos no contrato. Valor novo não vazio
   * sobrescreve; vazio nunca apaga. Devolve quantos campos foram gravados.
   */
  async saveFromValues(
    organizationId: string,
    contactId: string,
    values: Readonly<Record<string, string>>,
    userId: string,
  ): Promise<number> {
    const data = valuesToPersonalData(values);
    const count = Object.keys(data).length;
    if (count === 0) return 0;
    await this.prisma.contactPersonalData.upsert({
      where: { contactId },
      create: { contactId, organizationId, ...data, updatedById: userId },
      update: { ...data, updatedById: userId },
    });
    return count;
  }
}
