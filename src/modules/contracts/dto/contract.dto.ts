import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PARK_IDS } from '../contracts.constants';
import { present } from './validators';

/** Link do chat antigo: só https, com protocolo explícito. */
const HTTPS_URL = { protocols: ['https'], require_protocol: true };

export class ParkDateDto {
  @IsIn([...PARK_IDS])
  parkId!: string;

  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;
}

export class CreateContractDto {
  @IsString() @MinLength(3) @MaxLength(100)
  fullName!: string;

  @Matches(/^(\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})$/, { message: 'CPF inválido' })
  cpf!: string;

  @IsString() @MinLength(10) @MaxLength(200)
  address!: string;

  @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP inválido' })
  cep!: string;

  @IsEmail() @MaxLength(255)
  email!: string;

  @IsString() @MinLength(8) @MaxLength(20)
  phone!: string;

  @IsString() @MinLength(2) @MaxLength(100)
  guideName!: string;

  @IsOptional() @IsString() @MaxLength(100)
  sellerName?: string;

  @IsInt() @Min(1) @Max(500)
  people!: number;

  /** Texto final como no Lovable: "2190,00" ou "$ 150.00". */
  @IsString() @MaxLength(20) @Matches(/^(\$\s?)?\d{1,3}([.,]?\d{3})*([.,]\d{1,2})?$/, { message: 'Valor inválido' })
  amount!: string;

  @IsOptional() @IsString() @MaxLength(60)
  paymentMethod?: string;

  @IsOptional() @IsString() @MaxLength(120)
  pixKey?: string;

  @IsBoolean()
  disneyGuest!: boolean;

  /** Sem o campo e com parkDates preenchido, vale false. */
  @IsOptional() @IsBoolean()
  datesToBeDefined?: boolean;

  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ParkDateDto)
  parkDates!: ParkDateDto[];

  @IsOptional() @IsString() @MaxLength(5000)
  notes?: string;

  @IsOptional() @IsUrl(HTTPS_URL) @MaxLength(500)
  legacyChatUrl?: string;

  /** Cria o login do cliente no Planejador OFP (etapa 2C). */
  @IsOptional() @IsBoolean()
  createPlanejadorAccess?: boolean;
}

/**
 * Todos os campos opcionais; contrato já aceito só aceita as flags (rota própria).
 * Campos não anuláveis usam `@ValidateIf(v !== undefined)`: ausente passa, null dá 400.
 */
export class UpdateContractDto {
  @ValidateIf(present) @IsString() @MinLength(3) @MaxLength(100) fullName?: string;
  @ValidateIf(present) @Matches(/^(\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})$/) cpf?: string;
  @ValidateIf(present) @IsString() @MinLength(10) @MaxLength(200) address?: string;
  @ValidateIf(present) @Matches(/^\d{5}-?\d{3}$/) cep?: string;
  @ValidateIf(present) @IsEmail() @MaxLength(255) email?: string;
  @ValidateIf(present) @IsString() @MinLength(8) @MaxLength(20) phone?: string;
  @ValidateIf(present) @IsString() @MinLength(2) @MaxLength(100) guideName?: string;
  @IsOptional() @IsString() @MaxLength(100) sellerName?: string | null;
  @ValidateIf(present) @IsInt() @Min(1) @Max(500) people?: number;
  @ValidateIf(present) @IsString() @MaxLength(20) @Matches(/^(\$\s?)?\d{1,3}([.,]?\d{3})*([.,]\d{1,2})?$/) amount?: string;
  @IsOptional() @IsString() @MaxLength(60) paymentMethod?: string | null;
  @IsOptional() @IsString() @MaxLength(120) pixKey?: string | null;
  @ValidateIf(present) @IsBoolean() disneyGuest?: boolean;
  @ValidateIf(present) @IsBoolean() datesToBeDefined?: boolean;
  @ValidateIf(present) @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ParkDateDto)
  parkDates?: ParkDateDto[];
  @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;
  @IsOptional() @IsUrl(HTTPS_URL) @MaxLength(500) legacyChatUrl?: string | null;
}

export class UpdateFlagsDto {
  @IsOptional() @IsBoolean() purchased?: boolean;
  @IsOptional() @IsBoolean() paid?: boolean;
  @IsOptional() @IsBoolean() invoiceIssued?: boolean;
}

/** Arrastar no calendário: troca uma data por outra (parkId desempata dois parques no mesmo dia). */
export class MoveDateDto {
  @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) from!: string;
  @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) to!: string;
  @IsOptional() @IsIn([...PARK_IDS]) parkId?: string;
}
