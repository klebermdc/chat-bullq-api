import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsEmail, IsISO8601, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { present } from './validators';

export class PixKeyOptionDto {
  @IsString() @MinLength(3) @MaxLength(120) value!: string;
  @IsString() @MinLength(1) @MaxLength(80) label!: string;
}

/** Campos não anuláveis (terms, pixKeys, guides, sellers) recusam null com 400. */
export class UpdateContractSettingsDto {
  @ValidateIf(present) @IsString() @MinLength(20) @MaxLength(50_000) terms?: string;
  @ValidateIf(present) @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => PixKeyOptionDto)
  pixKeys?: PixKeyOptionDto[];
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(120) defaultPixKey?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsEmail() receiptNotifyEmail?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(5000) usdPaymentInstructions?: string | null;
  @ValidateIf(present) @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(100, { each: true }) guides?: string[];
  @ValidateIf(present) @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(100, { each: true }) sellers?: string[];
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) companyName?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(40) companyDocument?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(300) companyAddress?: string | null;
}

export class BlockedDateDto {
  @IsString() @MinLength(2) @MaxLength(100) guideName!: string;
  @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsOptional() @IsString() @MaxLength(100) reason?: string;
}
