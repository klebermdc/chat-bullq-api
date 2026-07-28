import { IsString, IsOptional, IsEmail, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StartConversationDto {
  @ApiProperty()
  @IsString()
  channelId: string;

  @ApiPropertyOptional({ description: 'Telefone (novo ou existente). Um de phone/contactId é obrigatório.' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  contactId?: string;

  @ApiPropertyOptional({ description: 'Nome do cliente (aplicado só ao criar contato novo)' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Email (aplicado só ao criar contato novo)' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'Observações (aplicado só ao criar contato novo)' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ description: 'Mensagem de texto livre. Obrigatória em canais não-oficiais (Baileys/Zappfy).' })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional({
    description:
      'Payload de template HSM no formato da Graph API { name, language: { code }, components }. Obrigatório para iniciar conversa no canal WhatsApp Oficial (1º contato exige template aprovado).',
  })
  @IsOptional()
  @IsObject()
  template?: Record<string, any>;
}
