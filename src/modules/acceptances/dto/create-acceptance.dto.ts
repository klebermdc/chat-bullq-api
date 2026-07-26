import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class AcceptanceItemDto {
  @IsString()
  description!: string;

  @IsOptional()
  @IsNumber()
  qty?: number;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

/** Body opcional do `order-sent`. Sem ele, o endpoint só move o card (legado). */
export class OrderSentDto {
  @IsOptional()
  @IsBoolean()
  withAcceptance?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcceptanceItemDto)
  items?: AcceptanceItemDto[];

  @IsOptional()
  @IsString()
  termText?: string;
}
