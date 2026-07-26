import { IsString, MinLength } from 'class-validator';

export class SignAcceptanceDto {
  @IsString()
  @MinLength(2)
  name!: string;
}
