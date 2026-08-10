import { ArrayMaxSize, IsArray, IsBoolean, IsNumber, IsOptional, IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Uma entrega são alguns PDFs, não um lote. O teto existe porque cada voucher
 * vira uma leitura no storage dentro do mesmo request (`withHashes`): sem ele,
 * um body com centenas de URLs vira centenas de leituras simultâneas.
 */
const MAX_VOUCHERS = 20;

/** Nº do pedido do operador: um punhado de caracteres, não texto livre. */
const MAX_ORDER_REF_LENGTH = 64;

/**
 * Tetos dos passageiros. A lista chega do modal (que a preencheu com o que a
 * IA leu, editável à mão) e vai direto para o Json do aceite e para o PDF do
 * comprovante — sem limite, um body forjado vira um documento legal de mil
 * páginas. Os números são folgados para um voucher real de família/excursão.
 */
const MAX_PASSENGERS_PER_ITEM = 50;
const MAX_PASSENGER_NAME_LENGTH = 120;
/** A data vai como ESTÁ ESCRITA ("20/04/2020", "20 de abril de 2020"). */
const MAX_PASSENGER_BIRTHDATE_LENGTH = 40;

export class AcceptancePassengerDto {
  @IsString()
  @MaxLength(MAX_PASSENGER_NAME_LENGTH)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_PASSENGER_BIRTHDATE_LENGTH)
  birthDate?: string;
}

export class AcceptanceItemDto {
  @IsString()
  description!: string;

  @IsOptional()
  @IsNumber()
  qty?: number;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  ref?: string;

  /**
   * Passageiros nominais. SEM este campo aqui, o `forbidNonWhitelisted` do pipe
   * global recusa o "Pedido enviado" INTEIRO com 400 assim que o modal manda um
   * item lido do voucher — a extração devolveria os nomes e a entrega falharia.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PASSENGERS_PER_ITEM)
  @ValidateNested({ each: true })
  @Type(() => AcceptancePassengerDto)
  passengers?: AcceptancePassengerDto[];
}

/**
 * Voucher entregue junto com o aceite. Só o arquivo — o `sha256` NÃO entra
 * aqui de propósito: quem calcula é o backend, lendo o objeto do storage.
 */
export class VoucherRefDto {
  /**
   * FRONTEIRA DE SEGURANÇA, não formatação. Esta URL é persistida no aceite e
   * renderizada como `href` em /aceite/[token] — página PÚBLICA e sem sessão,
   * onde o cliente assina. Sem a trava de esquema, um membro autenticado da org
   * planta `javascript:` num link ao vivo na página de assinatura do próprio
   * cliente; a mesma string ainda segue pro PDF do comprovante e pro
   * `content.mediaUrl` do WhatsApp, então filtrar no render seria tarde demais.
   *
   * `require_tld: false` porque o APP_URL do dev local é `http://localhost:3001`
   * (.env.production.example) e o default `require_tld: true` recusaria os
   * uploads da máquina do desenvolvedor. Isso NÃO afrouxa a trava que importa:
   * a lista de protocolos segue barrando `javascript:`, `data:` e afins, e URL
   * relativa continua recusada.
   */
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  url!: string;

  @IsString()
  filename!: string;

  @IsNumber()
  size!: number;
}

/** Body opcional do `order-sent`. Sem ele, o endpoint só move o card (legado). */
export class OrderSentDto {
  @IsOptional()
  @IsBoolean()
  withAcceptance?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcceptanceItemDto)
  items?: AcceptanceItemDto[];

  @IsOptional()
  @IsString()
  termText?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_VOUCHERS)
  @ValidateNested({ each: true })
  @Type(() => VoucherRefDto)
  vouchers?: VoucherRefDto[];

  @IsOptional()
  @IsString()
  @MaxLength(MAX_ORDER_REF_LENGTH)
  orderRef?: string;
}
