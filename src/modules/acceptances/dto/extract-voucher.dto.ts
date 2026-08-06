import { IsString, MaxLength } from 'class-validator';

export class ExtractVoucherDto {
  @IsString()
  @MaxLength(2048)
  mediaUrl!: string;
}
