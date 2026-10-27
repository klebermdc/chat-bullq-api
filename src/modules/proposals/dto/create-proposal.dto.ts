import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PROPOSAL_IMAGE_MIME_TYPES,
  PROPOSAL_MAX_IMAGES,
  PROPOSAL_TEXT_MAX,
} from '../proposals.constants';
import {
  QUOTE_CUSTOMER_NAME_MAX,
  QUOTE_MAX_VALIDITY_HOURS,
  QUOTE_MIN_VALIDITY_HOURS,
} from '../quote/quote.constants';
import { QuoteDto } from './quote.dto';

const INVALID_IMAGE = 'Imagem inválida.';
const MAX_IMAGE_FILENAME_LENGTH = 255;
const VALIDITY_MESSAGE = `A validade precisa ser de ${QUOTE_MIN_VALIDITY_HOURS} a ${QUOTE_MAX_VALIDITY_HOURS} horas.`;

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

  /**
   * true = só LÊ e devolve `{ preview: true, proposal, text }`; não grava, não
   * envia nada ao cliente e não mexe no funil. É o passo de conferência da
   * proposta lida de print.
   */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  preview?: boolean;

  /**
   * Proposta já conferida (e possivelmente corrigida) pelo atendente, no formato
   * devolvido pelo preview. OBRIGATÓRIA para enviar proposta com prints: o que
   * vai ao cliente é o que o atendente viu, nunca uma segunda leitura do modelo.
   * A forma é validada no service (`ExtractionService.validateReviewed`).
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  reviewed?: Record<string, unknown>;

  /**
   * Texto final da proposta, corrigido pelo atendente na conferência. Quando
   * vem, é exatamente o que o cliente recebe no lugar do texto montado. Só vale
   * junto de `reviewed` (proposta lida do print).
   */
  @ApiPropertyOptional({ maxLength: PROPOSAL_TEXT_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(PROPOSAL_TEXT_MAX, {
    message: `A mensagem da proposta pode ter até ${PROPOSAL_TEXT_MAX} caracteres.`,
  })
  text?: string;

  /**
   * TEXT (padrão) = a proposta de sempre, em texto. LINK = cotação por link:
   * página pública com os itens conferidos e uma mensagem curta com o link.
   * LINK exige `includeLink: false` e prints.
   */
  @ApiPropertyOptional({ enum: ['TEXT', 'LINK'], default: 'TEXT' })
  @IsOptional()
  @IsIn(['TEXT', 'LINK'])
  format?: 'TEXT' | 'LINK';

  /** LINK: a cotação conferida pelo atendente. Obrigatória para enviar. */
  @ApiPropertyOptional({ type: QuoteDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuoteDto)
  quote?: QuoteDto;

  /** LINK: como chamar o cliente na página e na mensagem. */
  @ApiPropertyOptional({ maxLength: QUOTE_CUSTOMER_NAME_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(QUOTE_CUSTOMER_NAME_MAX, {
    message: `O nome do cliente pode ter até ${QUOTE_CUSTOMER_NAME_MAX} caracteres.`,
  })
  customerName?: string;

  /** LINK: validade da página em horas (padrão 24, máx. 7 dias). */
  @ApiPropertyOptional({ minimum: QUOTE_MIN_VALIDITY_HOURS, maximum: QUOTE_MAX_VALIDITY_HOURS, default: 24 })
  @IsOptional()
  @IsInt({ message: VALIDITY_MESSAGE })
  @Min(QUOTE_MIN_VALIDITY_HOURS, { message: VALIDITY_MESSAGE })
  @Max(QUOTE_MAX_VALIDITY_HOURS, { message: VALIDITY_MESSAGE })
  validityHours?: number;
}
