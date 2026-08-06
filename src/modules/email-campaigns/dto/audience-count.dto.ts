import { IsObject, IsOptional } from 'class-validator';

/**
 * Corpo opcional de `POST /email/campaigns/:id/audience-count`.
 *
 * Sem `filter`, a contagem usa o `audienceFilter` já gravado na campanha.
 * Com `filter`, usa o que veio no corpo — é o que permite a tela contar
 * enquanto o operador monta os critérios, antes de salvar.
 */
export class AudienceCountDto {
  @IsOptional()
  @IsObject()
  filter?: Record<string, unknown>;
}
