import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { phoneVariants } from '../../common/utils/phone.util';

export type MoveOwnerResult = 'moved' | 'skipped' | 'not-in-carteira';

/**
 * Transferir o cliente para outro vendedor troca o dono dele na carteira
 * legada (`contatos_legado`). Sem isto, a próxima conversa nova voltaria para
 * o vendedor antigo e a etiqueta do contato voltaria atrás.
 *
 * Só escreve: quem lê a carteira é o LegacyOwnerRoutingService. Separado dele
 * de propósito — o de leitura depende do FSM, e o FSM chama este aqui.
 */
@Injectable()
export class LegacyOwnerWriterService {
  private readonly logger = new Logger(LegacyOwnerWriterService.name);

  constructor(private readonly prisma: PrismaService) {}

  async moveOwner(contactId: string, userId: string): Promise<MoveOwnerResult> {
    const [contact, mapped] = await Promise.all([
      this.prisma.contact.findUnique({
        where: { id: contactId },
        select: { phone: true },
      }),
      this.prisma.$queryRaw<Array<{ vendedor: string }>>`
        SELECT vendedor FROM contatos_legado_vendedores WHERE user_id = ${userId} LIMIT 1`,
    ]);

    const vendedor = mapped[0]?.vendedor;
    const digits = (contact?.phone ?? '').replace(/\D/g, '');
    if (!vendedor || !digits) return 'skipped';

    const telefones = phoneVariants(digits).map((v) => `+${v}`);
    const updated = await this.prisma.$executeRaw`
      UPDATE contatos_legado
      SET vendedor = ${vendedor}
      WHERE telefone IN (${Prisma.join(telefones)})
        AND vendedor IS DISTINCT FROM ${vendedor}`;

    if (updated === 0) return 'not-in-carteira';
    this.logger.log(`carteira: contato ${contactId} passou para "${vendedor}"`);
    return 'moved';
  }
}
