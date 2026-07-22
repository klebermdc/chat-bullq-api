import { IsEmail, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateMemberEmailDto {
  @ApiProperty({ example: 'contato@orlandofastpass.com.br' })
  // E-mail é chave de login e é `@unique` no banco. Normalizar na
  // entrada evita que "Contato@..." e "contato@..." virem contas
  // diferentes e que um espaço colado do clipboard trave o login.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  email: string;
}
