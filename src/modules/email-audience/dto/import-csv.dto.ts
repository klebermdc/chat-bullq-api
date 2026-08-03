import { IsString, MinLength } from 'class-validator';

export class ImportCsvDto {
  @IsString()
  @MinLength(3)
  csv!: string;
}
