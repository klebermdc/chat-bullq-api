import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dtos/pagination.dto';
import { QUOTE_SEARCH_MAX, QUOTE_STATUS_FILTERS, type QuoteStatusFilter } from '../quote/quote-search';

export class ListQuotesDto extends PaginationDto {
  /** Número, nome do cliente, telefone, hotel ou produto. */
  @ApiPropertyOptional({ maxLength: QUOTE_SEARCH_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(QUOTE_SEARCH_MAX)
  q?: string;

  @ApiPropertyOptional({ enum: QUOTE_STATUS_FILTERS })
  @IsOptional()
  @IsIn(QUOTE_STATUS_FILTERS)
  status?: QuoteStatusFilter;

  /** Quem gerou a cotação. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  sellerId?: string;
}
