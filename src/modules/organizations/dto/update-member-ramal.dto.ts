import { IsOptional, IsString, Matches } from 'class-validator';

export class UpdateMemberRamalDto {
  // aceita dígitos (ex.: "101"); vazio/omitido limpa o ramal.
  @IsOptional()
  @IsString()
  @Matches(/^\d{0,6}$/, { message: 'Ramal deve conter só dígitos (até 6)' })
  sonaxRamal?: string;
}
