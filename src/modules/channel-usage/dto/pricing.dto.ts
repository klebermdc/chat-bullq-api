import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

export class SetPricingDto {
  @ApiPropertyOptional({ default: 'BRL' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty()
  @IsObject()
  rates!: Record<string, number>;
}
