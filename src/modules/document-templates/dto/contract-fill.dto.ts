import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { IsStringRecord } from './string-record.validator';
import {
  MAX_DEFAULT_ENTRIES,
  MAX_DEFAULT_VALUE_LENGTH,
  isDefaultKey,
} from '../field-defaults.util';

/**
 * Booleano estrito: com `enableImplicitConversion`, "false" (texto) viraria
 * `true` — e `send: "false"` mandaria mensagem ao cliente. Valida o valor cru.
 */
const strictBoolean = ({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key];

/** Texto colado para a IA ler (mensagem, e-mail, ficha). */
export const MAX_AI_TEXT_LENGTH = 20_000;

/**
 * `{ "[Campo]": "valor" }` dos dados da agência: chave de campo válida,
 * valor texto até 500 caracteres, no máximo 80 chaves.
 */
@ValidatorConstraint({ name: 'isFieldDefaults', async: false })
export class IsFieldDefaultsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const entries = Object.entries(value);
    if (entries.length > MAX_DEFAULT_ENTRIES) return false;
    return entries.every(
      ([key, v]) =>
        isDefaultKey(key.trim()) && typeof v === 'string' && v.trim().length <= MAX_DEFAULT_VALUE_LENGTH,
    );
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} deve ser { "[Campo]": "texto" } com até ${MAX_DEFAULT_ENTRIES} campos e até ${MAX_DEFAULT_VALUE_LENGTH} caracteres por valor.`;
  }
}

function IsFieldDefaults(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: IsFieldDefaultsConstraint,
    });
}

export class UpdateFieldDefaultsDto {
  @IsFieldDefaults()
  values!: Record<string, string>;
}

export class DataRequestDto {
  @IsString()
  @IsNotEmpty({ message: 'Escolha o modelo de contrato.' })
  @MaxLength(64)
  templateId!: string;

  @Transform(strictBoolean)
  @IsBoolean({ message: 'send deve ser true ou false.' })
  send!: boolean;
}

export class AiFillDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  conversationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_AI_TEXT_LENGTH, { message: `O texto colado passa de ${MAX_AI_TEXT_LENGTH} caracteres.` })
  text?: string;

  @IsOptional()
  @Transform(strictBoolean)
  @IsBoolean({ message: 'useConversation deve ser true ou false.' })
  useConversation?: boolean;

  @IsOptional()
  @IsStringRecord()
  currentValues?: Record<string, string>;
}
