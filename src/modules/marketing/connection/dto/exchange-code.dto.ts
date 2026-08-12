import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ExchangeCodeDto {
  @ApiProperty({ description: 'code devolvido pelo Facebook Login for Business' })
  @IsString()
  @IsNotEmpty()
  code!: string;
}
