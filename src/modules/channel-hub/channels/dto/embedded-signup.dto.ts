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

  @ApiPropertyOptional({
    description:
      'Portfólio empresarial (business_id) do cliente, devolvido no sessionInfo. ' +
      'Guardado pra amarrar o canal ao portfólio dono da WABA.',
  })
  @IsOptional()
  @IsString()
  businessId?: string;

  @ApiPropertyOptional({ enum: ['ORG', 'PRIVATE'] })
  @IsOptional()
  @IsIn(['ORG', 'PRIVATE'])
  visibility?: 'ORG' | 'PRIVATE';
}
