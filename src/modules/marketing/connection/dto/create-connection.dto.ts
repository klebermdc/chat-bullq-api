import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateConnectionDto {
  @ApiProperty({
    description:
      'Identificador devolvido por /meta/exchange. O code do OAuth e de uso unico, por isso o passo 2 nao o recebe de novo.',
  })
  @IsString()
  @IsNotEmpty()
  handshakeId!: string;

  @ApiProperty({ description: 'ID da conta de anuncios escolhida, no formato act_123' })
  @IsString()
  @IsNotEmpty()
  adAccountId!: string;
}
