import { DocumentTemplateAudience } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const MAX_TITLE_LENGTH = 200;
export const MAX_CATEGORY_LENGTH = 100;
/** Contrato longo de verdade tem ~60k caracteres; folga para o maior modelo. */
export const MAX_BODY_LENGTH = 200_000;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Query string chega como texto: com `enableImplicitConversion`, "false"
 * viraria `true` (Boolean("false")). Lê o valor cru do objeto.
 */
const queryBoolean = ({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
  const raw = obj[key];
  if (raw === true || raw === 'true' || raw === '1') return true;
  if (raw === false || raw === 'false' || raw === '0') return false;
  return raw;
};

export class ListDocumentTemplatesQueryDto {
  @IsOptional()
  @IsEnum(DocumentTemplateAudience, { message: 'audience deve ser CLIENT ou INTERNAL.' })
  audience?: DocumentTemplateAudience;

  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean({ message: 'includeInactive deve ser true ou false.' })
  includeInactive?: boolean;
}

export class CreateDocumentTemplateDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Informe o título do modelo.' })
  @MaxLength(MAX_TITLE_LENGTH)
  title!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Informe a categoria do modelo.' })
  @MaxLength(MAX_CATEGORY_LENGTH)
  category!: string;

  @IsEnum(DocumentTemplateAudience, { message: 'audience deve ser CLIENT ou INTERNAL.' })
  audience!: DocumentTemplateAudience;

  @IsString()
  @IsNotEmpty({ message: 'O texto do modelo não pode ficar vazio.' })
  @MaxLength(MAX_BODY_LENGTH)
  body!: string;
}

export class UpdateDocumentTemplateDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'O título não pode ficar vazio.' })
  @MaxLength(MAX_TITLE_LENGTH)
  title?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'A categoria não pode ficar vazia.' })
  @MaxLength(MAX_CATEGORY_LENGTH)
  category?: string;

  @IsOptional()
  @IsEnum(DocumentTemplateAudience, { message: 'audience deve ser CLIENT ou INTERNAL.' })
  audience?: DocumentTemplateAudience;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'O texto do modelo não pode ficar vazio.' })
  @MaxLength(MAX_BODY_LENGTH)
  body?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
