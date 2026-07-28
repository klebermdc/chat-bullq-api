import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReactMessageDto {
  @ApiProperty({
    example: '👍',
    description: 'Exatamente um emoji (validado no service)',
  })
  @IsString()
  emoji: string;
}
