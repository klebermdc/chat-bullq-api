import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class PreviewEmailDto {
  /** `{ theme?, blocks: [...] }` — validado por `parseEmailContent` no controller. */
  @IsObject()
  content!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  preheader?: string;
}
