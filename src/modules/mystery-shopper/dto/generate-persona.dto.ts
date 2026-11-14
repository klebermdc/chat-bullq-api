import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PERSONA_BRIEF_MAX_CHARS, PERSONA_BRIEF_MIN_CHARS } from '../bot/persona-generator.constants';

/** Prévia curta do cliente oculto; a IA escreve a persona completa a partir dela. */
export class GeneratePersonaDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(PERSONA_BRIEF_MIN_CHARS)
  @MaxLength(PERSONA_BRIEF_MAX_CHARS)
  brief!: string;
}
