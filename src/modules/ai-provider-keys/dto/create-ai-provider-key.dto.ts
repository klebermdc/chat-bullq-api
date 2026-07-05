import { ApiProperty } from '@nestjs/swagger';
import { AiProvider, AiCapability } from '@prisma/client';
import { IsArray, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAiProviderKeyDto {
  @ApiProperty({ example: 'Groq produção' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({ enum: AiProvider })
  @IsEnum(AiProvider)
  provider: AiProvider;

  @ApiProperty({ example: 'gsk_...' })
  @IsString()
  @MinLength(8)
  @MaxLength(400)
  key: string;

  @ApiProperty({ enum: AiCapability, isArray: true })
  @IsArray()
  @IsEnum(AiCapability, { each: true })
  capabilities: AiCapability[];

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
