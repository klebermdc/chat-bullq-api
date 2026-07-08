import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Payload do PATCH /recovery/settings. Todos os campos são opcionais — só o
 * que vier é atualizado (upsert por org). A convenção de variáveis do template
 * ({{1}}=nome, {{2}}=produto) é fixa no código; aqui escolhe-se só o NOME.
 */
export class UpdateRecoverySettingsDto {
  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Canal usado pra disparar o outreach (fallback: env).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  outreachChannelId?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    example: 'brvy_recuperacao_checkout',
    description: 'Nome do template HSM aprovado usado no opener.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  openerTemplateName?: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Nome do template HSM usado no follow-up.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  followUpTemplateName?: string | null;

  @ApiProperty({
    required: false,
    example: 'pt_BR',
    description: 'Idioma do template HSM (ex: pt_BR).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  templateLang?: string;
}
