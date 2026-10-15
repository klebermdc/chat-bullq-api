import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { LegacyBlockedDateRow, LegacyContractRow } from '../legacy.types';

export const IMPORT_BATCH_MAX = 50;

export class ImportContractsDto {
  // Sem @Type, enableImplicitConversion do ValidationPipe global converte cada linha em [].
  @Type(() => Object)
  @IsArray()
  @ArrayMaxSize(IMPORT_BATCH_MAX)
  rows!: LegacyContractRow[];
}

export class ImportBlockedDatesDto {
  // Sem @Type, enableImplicitConversion do ValidationPipe global converte cada linha em [].
  @Type(() => Object)
  @IsArray()
  @ArrayMaxSize(IMPORT_BATCH_MAX)
  rows!: LegacyBlockedDateRow[];
}

export class ImportSettingsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50_000)
  terms!: string;
}

export class ImportFileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  path!: string;
}
