import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpsertMetaCapiDto {
  @ApiProperty({ example: '1234567890', description: 'Dataset/Pixel ID do Events Manager' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  datasetId: string;

  @ApiProperty({
    required: false,
    description:
      'System User access token da Conversions API. Omitir mantém o token atual.',
  })
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(400)
  token?: string;

  @ApiProperty({ required: false, description: 'Test Event Code (Events Manager → Test Events)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  testEventCode?: string;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
