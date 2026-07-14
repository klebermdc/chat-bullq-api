import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpsertSonaxSettingsDto {
  @IsBoolean() enabled: boolean;
  @IsString() @MinLength(1) idCliente: string;
  @IsOptional() @IsString() token?: string;
  @IsOptional() @IsString() click2callBaseUrl?: string;
}
