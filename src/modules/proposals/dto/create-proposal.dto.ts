import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PROPOSAL_IMAGE_MIME_TYPES, PROPOSAL_MAX_IMAGES } from '../proposals.constants';

const INVALID_IMAGE = 'Imagem inválida.';
const MAX_IMAGE_FILENAME_LENGTH = 255;

/**
 * Print anexado à proposta: o que `POST /messages/uploads/media` devolveu.
 */
export class ProposalImageDto {
  /**
   * Esta URL é persistida em `details.images` e vira `content.mediaUrl` de uma
   * mensagem ao cliente — por isso a trava de esquema já no boundary (mesma do
   * `VoucherRefDto`, inclusive o `require_tld: false` do dev local). Se ela é
   * mesmo um upload NOSSO quem decide é `storageKeyFromUploadUrl`, no service.
   */
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true, require_tld: false },
    { message: INVALID_IMAGE },
  )
  url!: string;

  @IsIn(PROPOSAL_IMAGE_MIME_TYPES, { message: INVALID_IMAGE })
  mimeType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_IMAGE_FILENAME_LENGTH)
  filename?: string;

  @IsOptional()
  @IsNumber()
  size?: number;
}

export class CreateProposalDto {
  @ApiProperty({ example: 'conversation-id' })
  @IsString()
  conversationId: string;

  /**
   * NEW = proposta nova (saudação completa). UPDATE = atualização de uma proposta
   * existente (mensagem curta, sem a saudação longa). Default NEW.
   */
  @ApiPropertyOptional({ enum: ['NEW', 'UPDATE'], default: 'NEW' })
  @IsOptional()
  @IsIn(['NEW', 'UPDATE'])
  mode?: 'NEW' | 'UPDATE';

  /**
   * false = envia a proposta sem a linha do link do checkout, e o link deixa
   * de ser exigido: basta um resumo colado OU ao menos um print. Default true.
   */
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  includeLink?: boolean;

  /**
   * Conteúdo colado pelo atendente. Pode ser só a URL do checkout OU o bloco
   * inteiro que ele copia (URL + resumo do carrinho: parque, datas, pax). A URL
   * é extraída no service; o texto completo também vira contexto pra extração.
   * Pode vir vazio quando `includeLink` é false e há print em `images`.
   */
  @ApiProperty({
    example:
      'https://reservas.orlandofastpass.com.br/pt/checkout/uuid\n\nDISNEY 4 PARKS [4 dias]\n29/07/2026\n3 Adultos\n1 Criança',
  })
  @IsString()
  checkoutUrl: string;
  /**
   * Prints anexados no modal. Vão ao cliente junto da proposta (uma mensagem
   * por imagem) e são lidos por visão para montar a proposta.
   */
  @ApiPropertyOptional({ type: [ProposalImageDto], maxItems: PROPOSAL_MAX_IMAGES })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PROPOSAL_MAX_IMAGES, { message: `Envie no máximo ${PROPOSAL_MAX_IMAGES} imagens.` })
  @ValidateNested({ each: true })
  @Type(() => ProposalImageDto)
  images?: ProposalImageDto[];
}
