import { IsString, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProposalDto {
  @ApiProperty({ example: 'conversation-id' })
  @IsString()
  conversationId: string;

  /**
   * NEW = proposta nova (saudação completa). UPDATE = atualização de uma proposta
   * existente (mensagem curta, sem a saudação longa). Default NEW.
   */
  @ApiPropertyOptional({ enum: ['NEW', 'UPDATE'], default: 'NEW' })
  @IsOptional()
  @IsIn(['NEW', 'UPDATE'])
  mode?: 'NEW' | 'UPDATE';

  /**
   * Conteúdo colado pelo atendente. Pode ser só a URL do checkout OU o bloco
   * inteiro que ele copia (URL + resumo do carrinho: parque, datas, pax). A URL
   * é extraída no service; o texto completo também vira contexto pra extração.
   */
  @ApiProperty({
    example:
      'https://reservas.orlandofastpass.com.br/pt/checkout/uuid\n\nDISNEY 4 PARKS [4 dias]\n29/07/2026\n3 Adultos\n1 Criança',
  })
  @IsString()
  checkoutUrl: string;
}
