import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CuratedItemDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(500) question!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(4000) content!: string;
  @ApiProperty() @IsString() @MaxLength(50) category!: string;
}

export class ImportKnowledgeDto {
  @ApiProperty({ type: [CuratedItemDto] })
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => CuratedItemDto)
  items!: CuratedItemDto[];
}
