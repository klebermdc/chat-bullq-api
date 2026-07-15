import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMemberWebphoneDto {
  // Aceita a URL do widget OU o <script> inteiro colado (o service extrai o src).
  // Vazio/omitido limpa o webphone (volta a usar softphone externo).
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  webphoneUrl?: string;
}
