import { IsString, MaxLength, MinLength } from 'class-validator';

export class SimulatorMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;
}
