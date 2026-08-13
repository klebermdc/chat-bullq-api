import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ExchangeCodeDto {
  @ApiProperty({
    description:
      'Token de usuario CURTO (1-2h) devolvido pelo FB.login no navegador. Nao e o code: o fluxo de code exige repetir o redirect_uri interno do dialogo, que o servidor nao tem como reproduzir.',
  })
  @IsString()
  @IsNotEmpty()
  accessToken!: string;
}
