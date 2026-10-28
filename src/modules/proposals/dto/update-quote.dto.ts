import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { QUOTE_CUSTOMER_NAME_MAX } from '../quote/quote.constants';
import { QuoteDto } from './quote.dto';

/** Nova versão de uma cotação por link já enviada (mesmo link, validade renovada). */
export class UpdateQuoteDto {
  @ApiProperty({ type: QuoteDto })
  @ValidateNested()
  @Type(() => QuoteDto)
  quote: QuoteDto;

  @ApiPropertyOptional({ maxLength: QUOTE_CUSTOMER_NAME_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(QUOTE_CUSTOMER_NAME_MAX, {
    message: `O nome do cliente pode ter até ${QUOTE_CUSTOMER_NAME_MAX} caracteres.`,
  })
  customerName?: string;

  /** false = só grava; o atendente avisa o cliente do jeito dele. Padrão true. */
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  notify?: boolean;
}
