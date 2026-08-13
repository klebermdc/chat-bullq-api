import { BadRequestException } from '@nestjs/common';
import { PeriodQueryDto } from './dto/period-query.dto';

const MS_PER_DAY = 86_400_000;

/**
 * `to` é interpretado como o fim do dia civil (23:59:59.999 UTC), não meia-
 * noite — senão qualquer consulta que filtre por `<= to` derruba o último
 * dia do período silenciosamente.
 */
function endOfDayUtc(dateStr: string): Date {
  const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
  return new Date(startOfDay.getTime() + MS_PER_DAY - 1);
}

/**
 * Recusa período invertido: um `from > to` devolvendo zeros em silêncio
 * é indistinguível de "sem dados", o que manda alguém caçar um bug de
 * ingestão que não existe.
 *
 * Compartilhado por todos os controllers do módulo — a regra de parsing de
 * período não pode divergir entre `overview`/`daily` e `attribution`/`creatives`.
 */
export function parsePeriod(query: PeriodQueryDto): { from: Date; to: Date } {
  const from = new Date(`${query.from}T00:00:00.000Z`);
  const to = endOfDayUtc(query.to);

  if (from.getTime() > to.getTime()) {
    throw new BadRequestException('O parâmetro "from" não pode ser posterior a "to".');
  }

  return { from, to };
}
