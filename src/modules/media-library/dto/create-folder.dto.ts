import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFolderDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional({
    description:
      'Pasta de figurinhas: seus .webp aparecem na aba "Figurinhas" do compositor',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isStickerFolder?: boolean;
}
