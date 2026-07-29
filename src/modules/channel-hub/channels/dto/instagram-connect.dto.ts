import { IsOptional, IsUrl } from 'class-validator';
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

// InstagramCallbackQueryDto foi removido: o ValidationPipe global roda com
// `forbidNonWhitelisted` e a Meta manda `error_reason`/`error_description`
// junto do `error` no redirect de cancelamento — um DTO estrito rejeitaria
// esse caminho com 400 antes do controller rodar. `/callback` le a query
// solta (`Record<string, string>`), mesmo padrao do webhook-gateway.
