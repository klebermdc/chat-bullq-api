import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AddNumberDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  phone!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  label!: string;
}
