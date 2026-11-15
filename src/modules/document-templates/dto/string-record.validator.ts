import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { MAX_PLACEHOLDER_KEY_LENGTH, MAX_VALUE_KEYS, MAX_VALUE_LENGTH } from '../placeholders.util';

/** Chave `[Campo]`: o mesmo teto que torna um colchete campo (+ colchetes). */
export const MAX_KEY_LENGTH = MAX_PLACEHOLDER_KEY_LENGTH;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `{ "Campo": "valor" }` com tetos: o whitelist do ValidationPipe só olha as
 * propriedades decoradas do DTO, nunca as chaves de um objeto livre — sem
 * isto, `values` aceitaria qualquer coisa de qualquer tamanho.
 */
@ValidatorConstraint({ name: 'isStringRecord', async: false })
export class IsStringRecordConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!isPlainObject(value)) return false;
    const entries = Object.entries(value);
    if (entries.length > MAX_VALUE_KEYS) return false;
    return entries.every(
      ([key, v]) =>
        key.length > 0 &&
        key.length <= MAX_KEY_LENGTH &&
        typeof v === 'string' &&
        v.length <= MAX_VALUE_LENGTH,
    );
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} deve ser um objeto { "Campo": "texto" } com até ${MAX_VALUE_KEYS} campos e até ${MAX_VALUE_LENGTH} caracteres por valor.`;
  }
}

export function IsStringRecord(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: IsStringRecordConstraint,
    });
}
