import { IsString, IsOptional, IsUrl } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class InstagramAuthorizeQueryDto {
  @ApiPropertyOptional({
    description:
      'URL absoluta https para onde voltar depois do OAuth. Precisa estar na IG_RETURN_ALLOWLIST.',
    example: 'https://sendtur.com.br/settings/channels',
  })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  returnTo?: string;
}

export class InstagramCallbackQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  /** A Meta manda `error=access_denied` quando o usuário cancela. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  error?: string;
}
