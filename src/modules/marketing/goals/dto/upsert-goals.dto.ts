import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, Min, ValidateIf } from 'class-validator';

/**
 * Todos os campos são opcionais e têm três estados possíveis:
 *
 * - chave ausente do corpo  → "não mexer" (mantém o valor já salvo)
 * - chave com `null`        → "apagar esta meta"
 * - chave com um número     → "gravar este valor"
 *
 * `@IsOptional()` sozinho deixaria `null` cair fora antes de chegar em
 * `@IsNumber()`/`@IsInt()`, que rejeitam `null` por padrão. O
 * `@ValidateIf((_, v) => v !== null)` é o que garante que um `null`
 * explícito passe pela validação — sem isso, o usuário consegue configurar
 * uma meta mas nunca consegue limpá-la de volta.
 */
export class UpsertGoalsDto {
  @ApiPropertyOptional({
    description: 'Orçamento mensal alvo, em reais. `null` remove a meta.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(0)
  monthlyBudget?: number | null;

  @ApiPropertyOptional({
    description: 'Custo por lead alvo, em reais. `null` remove a meta.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(0)
  targetCpl?: number | null;

  @ApiPropertyOptional({
    description: 'CTR alvo, em porcentagem. `null` remove a meta.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(0)
  targetCtrPct?: number | null;

  @ApiPropertyOptional({
    description: 'Leads por dia alvo. `null` remove a meta.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  targetLeadsPerDay?: number | null;

  @ApiPropertyOptional({
    description: 'Frequência máxima alvo. `null` remove a meta.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(0)
  targetFrequencyMax?: number | null;

  @ApiPropertyOptional({
    description: 'Taxa de conversão alvo, em porcentagem. `null` remove a meta.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(0)
  targetConversionPct?: number | null;
}
