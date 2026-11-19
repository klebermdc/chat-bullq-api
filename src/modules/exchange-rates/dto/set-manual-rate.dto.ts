import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

export class SetManualRateDto {
  @ApiProperty({ description: 'R$ por US$ 1', example: 5.88 })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(1)
  @Max(20)
  value!: number;
}
