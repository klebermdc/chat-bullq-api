import { IsString, MaxLength, MinLength } from 'class-validator';

export class ParseContractTextDto {
  @IsString() @MinLength(5) @MaxLength(10_000) rawText!: string;
}
