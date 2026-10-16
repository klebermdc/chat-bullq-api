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
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PARK_IDS } from '../contracts.constants';

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
  @IsString() @Matches(/^(\$\s?)?\d{1,3}([.,]?\d{3})*([.,]\d{1,2})?$/, { message: 'Valor inválido' })
  amount!: string;

  @IsOptional() @IsString() @MaxLength(60)
  paymentMethod?: string;

  @IsOptional() @IsString() @MaxLength(120)
  pixKey?: string;

  @IsBoolean()
  disneyGuest!: boolean;

  @IsBoolean()
  datesToBeDefined!: boolean;

  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ParkDateDto)
  parkDates!: ParkDateDto[];

  @IsOptional() @IsString() @MaxLength(5000)
  notes?: string;

  @IsOptional() @IsString() @MaxLength(500)
  legacyChatUrl?: string;

  /** Cria o login do cliente no Planejador OFP (etapa 2C). */
  @IsOptional() @IsBoolean()
  createPlanejadorAccess?: boolean;
}

/** Todos os campos opcionais; contrato já aceito só aceita as flags (rota própria). */
export class UpdateContractDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(100) fullName?: string;
  @IsOptional() @Matches(/^(\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})$/) cpf?: string;
  @IsOptional() @IsString() @MinLength(10) @MaxLength(200) address?: string;
  @IsOptional() @Matches(/^\d{5}-?\d{3}$/) cep?: string;
  @IsOptional() @IsEmail() @MaxLength(255) email?: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(20) phone?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) guideName?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(100) sellerName?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(500) people?: number;
  @IsOptional() @Matches(/^(\$\s?)?\d{1,3}([.,]?\d{3})*([.,]\d{1,2})?$/) amount?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(60) paymentMethod?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120) pixKey?: string | null;
  @IsOptional() @IsBoolean() disneyGuest?: boolean;
  @IsOptional() @IsBoolean() datesToBeDefined?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ParkDateDto)
  parkDates?: ParkDateDto[];
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(5000) notes?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) legacyChatUrl?: string | null;
}

export class UpdateFlagsDto {
  @IsOptional() @IsBoolean() purchased?: boolean;
  @IsOptional() @IsBoolean() paid?: boolean;
  @IsOptional() @IsBoolean() invoiceIssued?: boolean;
}

/** Arrastar no calendário: troca uma data por outra. */
export class MoveDateDto {
  @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) from!: string;
  @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) to!: string;
}
