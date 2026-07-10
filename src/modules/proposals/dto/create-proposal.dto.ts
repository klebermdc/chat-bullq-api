import { IsString, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProposalDto {
  @ApiProperty({ example: 'conversation-id' })
  @IsString()
  conversationId: string;

  @ApiProperty({ example: 'https://reservas.orlandofastpass.com.br/pt/checkout/uuid' })
  @IsUrl()
  checkoutUrl: string;
}
