import { IsArray, IsBoolean, IsEnum, IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';

export class PreferenceItemDto {
  @ApiProperty({ enum: NotificationType })
  @IsEnum(NotificationType)
  type!: NotificationType;

  @ApiProperty()
  @IsBoolean()
  inApp!: boolean;

  @ApiProperty()
  @IsBoolean()
  browserPush!: boolean;

  @ApiProperty()
  @IsBoolean()
  sound!: boolean;

  @ApiProperty({ required: false, nullable: true, example: '22:00' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  dndStart?: string | null;

  @ApiProperty({ required: false, nullable: true, example: '07:00' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  dndEnd?: string | null;
}

export class UpdatePreferencesDto {
  @ApiProperty({ type: [PreferenceItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreferenceItemDto)
  preferences!: PreferenceItemDto[];
}
