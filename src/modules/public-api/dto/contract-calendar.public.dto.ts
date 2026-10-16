import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `?from&to&guide` da agenda de contratos; `?guide=a&guide=b` vira array e dá 400. */
export class ContractCalendarQueryDto {
  @IsOptional() @Matches(ISO_DATE, { message: 'from deve ser YYYY-MM-DD' }) from?: string;
  @IsOptional() @Matches(ISO_DATE, { message: 'to deve ser YYYY-MM-DD' }) to?: string;
  @IsOptional() @IsString() @MaxLength(100) guide?: string;
}
