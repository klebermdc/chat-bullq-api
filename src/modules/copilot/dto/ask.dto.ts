import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CopilotTurnDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  content!: string;
}

export class AskDto {
  @ApiProperty({ example: 'quantas vendas o Pedro fez em julho?' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  @ApiPropertyOptional({
    type: [CopilotTurnDto],
    description:
      'Histórico recente da sessão (o front envia; backend não persiste).',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CopilotTurnDto)
  history?: CopilotTurnDto[];
}
