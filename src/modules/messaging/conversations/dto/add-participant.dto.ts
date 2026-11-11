import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class AddParticipantDto {
  /** Vendedor que vai ser incluído na conversa. */
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  userId!: string;
}
