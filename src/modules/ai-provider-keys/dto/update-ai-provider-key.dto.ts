import { ApiProperty } from '@nestjs/swagger';
import { AiProvider, AiCapability } from '@prisma/client';
import { IsArray, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateAiProviderKeyDto {
  @ApiProperty({ example: 'Groq produção', required: false })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiProperty({ enum: AiProvider, required: false })
  @IsOptional()
  @IsEnum(AiProvider)
  provider?: AiProvider;

  @ApiProperty({
    example: 'gsk_...',
    required: false,
    description: 'Se informado, substitui a chave; se omitido, mantém a chave atual.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(400)
  key?: string;

  @ApiProperty({ enum: AiCapability, isArray: true, required: false })
  @IsOptional()
  @IsArray()
  @IsEnum(AiCapability, { each: true })
  capabilities?: AiCapability[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  baseUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;
}
