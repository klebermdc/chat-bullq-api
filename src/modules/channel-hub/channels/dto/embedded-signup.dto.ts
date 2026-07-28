import { IsString, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EmbeddedSignupDto {
  @ApiProperty({ description: 'Authorization code retornado pelo popup do Embedded Signup' })
  @IsString()
  code: string;

  @ApiProperty()
  @IsString()
  phoneNumberId: string;

  @ApiProperty({ description: 'WhatsApp Business Account ID (WABA)' })
  @IsString()
  wabaId: string;

  @ApiPropertyOptional({ enum: ['ORG', 'PRIVATE'] })
  @IsOptional()
  @IsIn(['ORG', 'PRIVATE'])
  visibility?: 'ORG' | 'PRIVATE';
}
