import { IsString, MaxLength, MinLength } from 'class-validator';

export class StartBotDto {
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  persona!: string;
}
