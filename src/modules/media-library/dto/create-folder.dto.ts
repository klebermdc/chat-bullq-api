import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateFolderDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;
}
