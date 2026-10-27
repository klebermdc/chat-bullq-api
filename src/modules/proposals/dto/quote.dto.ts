import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CURRENCY_RE,
  ISO_DATE_RE,
  QUOTE_HOTEL_ADDRESS_MAX,
  QUOTE_HOTEL_AMENITY_MAX,
  QUOTE_HOTEL_ID_MAX,
  QUOTE_HOTEL_MAX_AMENITIES,
  QUOTE_HOTEL_MAX_PHOTOS,
  QUOTE_HOTEL_NAME_MAX,
  QUOTE_HOTEL_PHOTO_RE,
  QUOTE_HOTEL_SUMMARY_MAX,
  QUOTE_HOTEL_TIME_RE,
  QUOTE_MAX_AMOUNT,
  QUOTE_MAX_INSTALLMENTS,
  QUOTE_MAX_ITEMS,
  QUOTE_MAX_PEOPLE,
  QUOTE_PROVIDER_MAX,
  QUOTE_TEXT_MAX,
  QUOTE_TITLE_MAX,
} from '../quote/quote.constants';

const INVALID_DATE = 'Data inválida (use AAAA-MM-DD).';
const MONEY = { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 } as const;

/** Data opcional: nula, ou AAAA-MM-DD de um dia que existe. */
function OptionalIsoDate(): PropertyDecorator {
  return (target, key) => {
    IsOptional()(target, key);
    Matches(ISO_DATE_RE, { message: INVALID_DATE })(target, key);
    IsDateString({ strict: true }, { message: INVALID_DATE })(target, key);
  };
}

/** Valor em dinheiro maior que zero e abaixo do teto de sanidade. */
function Amount(message: string): PropertyDecorator {
  return (target, key) => {
    IsNumber(MONEY, { message })(target, key);
    IsPositive({ message })(target, key);
    Max(QUOTE_MAX_AMOUNT, { message })(target, key);
  };
}

function OptionalAmount(message: string): PropertyDecorator {
  return (target, key) => {
    IsOptional()(target, key);
    Amount(message)(target, key);
  };
}

function People(message: string): PropertyDecorator {
  return (target, key) => {
    IsInt({ message })(target, key);
    Min(0, { message })(target, key);
    Max(QUOTE_MAX_PEOPLE, { message })(target, key);
  };
}

function OptionalText(max: number, label: string): PropertyDecorator {
  return (target, key) => {
    IsOptional()(target, key);
    IsString()(target, key);
    MaxLength(max, { message: `${label} pode ter até ${max} caracteres.` })(target, key);
  };
}

/** Ficha do hotel (LiteAPI). Sem preço; fotos só do CDN da LiteAPI. */
export class QuoteHotelDto {
  @ApiProperty({ maxLength: QUOTE_HOTEL_ID_MAX })
  @IsString()
  @MaxLength(QUOTE_HOTEL_ID_MAX)
  id!: string;

  @ApiProperty({ maxLength: QUOTE_HOTEL_NAME_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(QUOTE_HOTEL_NAME_MAX, { message: `O nome do hotel pode ter até ${QUOTE_HOTEL_NAME_MAX} caracteres.` })
  name!: string;

  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  stars?: number | null;

  @ApiPropertyOptional({ nullable: true, maxLength: QUOTE_HOTEL_ADDRESS_MAX })
  @OptionalText(QUOTE_HOTEL_ADDRESS_MAX, 'O endereço do hotel')
  address?: string | null;

  @ApiProperty({ maxLength: QUOTE_HOTEL_SUMMARY_MAX })
  @IsString()
  @MinLength(1, { message: 'O resumo do hotel não pode ficar vazio (ou tire a ficha do hotel).' })
  @MaxLength(QUOTE_HOTEL_SUMMARY_MAX, { message: `O resumo do hotel pode ter até ${QUOTE_HOTEL_SUMMARY_MAX} caracteres.` })
  summary!: string;

  @ApiProperty({ type: [String], maxItems: QUOTE_HOTEL_MAX_AMENITIES })
  @IsArray()
  @ArrayMaxSize(QUOTE_HOTEL_MAX_AMENITIES)
  @IsString({ each: true })
  @MaxLength(QUOTE_HOTEL_AMENITY_MAX, { each: true })
  amenities!: string[];

  @ApiPropertyOptional({ nullable: true, example: '16h' })
  @IsOptional()
  @Matches(QUOTE_HOTEL_TIME_RE)
  checkin?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '11h' })
  @IsOptional()
  @Matches(QUOTE_HOTEL_TIME_RE)
  checkout?: string | null;

  @ApiProperty({ type: [String], maxItems: QUOTE_HOTEL_MAX_PHOTOS })
  @IsArray()
  @ArrayMaxSize(QUOTE_HOTEL_MAX_PHOTOS)
  @Matches(QUOTE_HOTEL_PHOTO_RE, { each: true, message: 'Foto de hotel com endereço não permitido.' })
  photos!: string[];
}

/** Um produto/reserva da cotação. Sem campo para CPF ou nome de viajante. */
export class QuoteItemDto {
  @ApiProperty({ maxLength: QUOTE_PROVIDER_MAX, example: 'Universal Orlando Resort' })
  @IsString()
  @MaxLength(QUOTE_PROVIDER_MAX, { message: `O fornecedor pode ter até ${QUOTE_PROVIDER_MAX} caracteres.` })
  provider!: string;

  @ApiProperty({ maxLength: QUOTE_TITLE_MAX })
  @IsString()
  @MinLength(1, { message: 'Informe o título de cada item.' })
  @MaxLength(QUOTE_TITLE_MAX, { message: `O título pode ter até ${QUOTE_TITLE_MAX} caracteres.` })
  title!: string;

  @ApiPropertyOptional({ nullable: true, example: '2026-12-10' })
  @OptionalIsoDate()
  startDate?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2026-12-12' })
  @OptionalIsoDate()
  endDate?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: QUOTE_TEXT_MAX })
  @OptionalText(QUOTE_TEXT_MAX, 'A descrição')
  description?: string | null;

  @ApiProperty({ minimum: 0, maximum: QUOTE_MAX_PEOPLE })
  @People(`Adultos: número inteiro de 0 a ${QUOTE_MAX_PEOPLE}.`)
  adults!: number;

  @ApiProperty({ minimum: 0, maximum: QUOTE_MAX_PEOPLE })
  @People(`Crianças: número inteiro de 0 a ${QUOTE_MAX_PEOPLE}.`)
  children!: number;

  @ApiPropertyOptional({ nullable: true })
  @OptionalAmount('Preço por adulto inválido.')
  priceAdult?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @OptionalAmount('Preço por criança inválido.')
  priceChild?: number | null;

  @ApiProperty()
  @Amount('O total de cada item precisa ser maior que zero.')
  total!: number;

  @ApiPropertyOptional({ nullable: true, maxLength: QUOTE_TEXT_MAX })
  @OptionalText(QUOTE_TEXT_MAX, 'A política de cancelamento')
  cancellationPolicy?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: QUOTE_HOTEL_NAME_MAX })
  @OptionalText(QUOTE_HOTEL_NAME_MAX, 'O nome do hotel')
  hotelName?: string | null;

  @ApiPropertyOptional({ type: QuoteHotelDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuoteHotelDto)
  hotel?: QuoteHotelDto | null;
}

export class QuoteInstallmentsDto {
  @ApiProperty({ minimum: 1, maximum: QUOTE_MAX_INSTALLMENTS })
  @IsInt({ message: `Número de parcelas: inteiro de 1 a ${QUOTE_MAX_INSTALLMENTS}.` })
  @Min(1, { message: `Número de parcelas: inteiro de 1 a ${QUOTE_MAX_INSTALLMENTS}.` })
  @Max(QUOTE_MAX_INSTALLMENTS, { message: `Número de parcelas: inteiro de 1 a ${QUOTE_MAX_INSTALLMENTS}.` })
  count!: number;

  @ApiProperty()
  @Amount('Valor da parcela inválido.')
  value!: number;
}

/** A cotação conferida/editada pelo atendente. */
export class QuoteDto {
  @ApiProperty({ type: [QuoteItemDto], minItems: 1, maxItems: QUOTE_MAX_ITEMS })
  @IsArray()
  @ArrayMinSize(1, { message: 'A cotação precisa de pelo menos 1 item.' })
  @ArrayMaxSize(QUOTE_MAX_ITEMS, { message: `A cotação pode ter até ${QUOTE_MAX_ITEMS} itens.` })
  @ValidateNested({ each: true })
  @Type(() => QuoteItemDto)
  items!: QuoteItemDto[];

  @ApiProperty({ example: 'BRL' })
  @IsString()
  @Matches(CURRENCY_RE, { message: 'Moeda inválida (ex.: BRL).' })
  currency!: string;

  @ApiProperty()
  @Amount('O total da reserva precisa ser maior que zero.')
  total!: number;

  @ApiPropertyOptional({ nullable: true })
  @OptionalAmount('Valor no Pix inválido.')
  pixTotal?: number | null;

  @ApiPropertyOptional({ type: QuoteInstallmentsDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuoteInstallmentsDto)
  installments?: QuoteInstallmentsDto | null;

  @ApiPropertyOptional({ nullable: true, maxLength: QUOTE_TEXT_MAX })
  @OptionalText(QUOTE_TEXT_MAX, 'A observação')
  notes?: string | null;
}
