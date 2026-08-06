import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * ~25 mil linhas (`email,nome` numa linha típica gira uns 40 bytes) — cobre
 * qualquer importação real com folga generosa e ainda barra o caso de
 * alguém colar um arquivo errado (um dump binário, um CSV de outro
 * sistema) que travaria o parser e/ou estufaria o payload sem necessidade.
 */
const MAX_CSV_LENGTH = 1_000_000;

export class ImportCsvDto {
  @IsString()
  @MinLength(3)
  @MaxLength(MAX_CSV_LENGTH)
  csv!: string;
}
