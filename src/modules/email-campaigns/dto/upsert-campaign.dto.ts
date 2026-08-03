import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpsertCampaignDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  preheader?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  fromName?: string;

  /** `{ blocks: [...] }` — validado por `parseEmailContent` no service. */
  @IsObject()
  content!: Record<string, unknown>;

  /** `{ source?, tagIds? }` — vazio significa "toda a base inscrita". */
  @IsOptional()
  @IsObject()
  audienceFilter?: Record<string, unknown>;
}
