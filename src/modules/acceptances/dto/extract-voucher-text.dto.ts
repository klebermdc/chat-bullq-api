import { IsString, MaxLength } from 'class-validator';

/**
 * Texto do voucher colado à mão pelo atendente. É o caminho CONFIÁVEL: o
 * voucher escaneado não tem camada de texto e a leitura do PDF erra, então
 * colar o texto elimina a etapa frágil (PDF→texto) em vez de tentar consertá-la.
 *
 * O limite é generoso de propósito — voucher com vários passageiros e regras de
 * uso passa fácil de alguns milhares de caracteres, e o corte tem que barrar
 * abuso, não recusar um voucher real.
 */
export const VOUCHER_TEXT_MAX_LENGTH = 20000;

export class ExtractVoucherTextDto {
  @IsString()
  @MaxLength(VOUCHER_TEXT_MAX_LENGTH)
  text!: string;
}
