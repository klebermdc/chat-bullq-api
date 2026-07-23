import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Origens aceitas na correção manual nesta fatia (AD/SITE virão com CTWA/Site). */
export const MANUAL_ORIGINS = ['INSTAGRAM_ORGANIC', 'WHATSAPP_DIRECT'] as const;
export type ManualOrigin = (typeof MANUAL_ORIGINS)[number];

export class SetOriginDto {
  /** Origem correta escolhida manualmente pelo operador. */
  @ApiProperty({ enum: MANUAL_ORIGINS })
  @IsIn(MANUAL_ORIGINS as unknown as string[])
  origin!: ManualOrigin;
}
