import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class AddSimulatedNumberDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  profileName?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  channelId!: string;
}
