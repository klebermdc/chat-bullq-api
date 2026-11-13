import { IsString, MaxLength } from 'class-validator';

export class ScenarioDto {
  @IsString()
  @MaxLength(500)
  scenario!: string;
}
