import { IsBoolean, IsString, Matches, MaxLength } from 'class-validator';

/** ~85.000 caracteres de data URL cobrem os 60 KB de PNG (MAX_SIGNATURE_BYTES) e cabem no body de 100 KB. */
export const MAX_SIGNATURE_DATA_URL_LENGTH = 85_000;

export class AcceptContractDto {
  /** data:image/png;base64,... — os bytes são conferidos no service. */
  @IsString()
  @MaxLength(MAX_SIGNATURE_DATA_URL_LENGTH)
  signature!: string;

  @IsBoolean()
  agree!: boolean;

  /** sha256 hex dos termos que a página mostrou (`termsHash` da view). */
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  termsHash!: string;
}
