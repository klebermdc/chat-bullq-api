import { BadRequestException } from '@nestjs/common';
import { countBodyVariables } from './template-components.mapper';
import { VariableExamples } from './template-components.types';

export function validateTemplateName(name: string): boolean {
  return /^[a-z0-9_]+$/.test(name);
}

export function assertExamplesComplete(bodyText: string, examples: VariableExamples): void {
  const n = countBodyVariables(bodyText);
  for (let i = 1; i <= n; i++) {
    if (!examples[String(i)]?.trim()) {
      throw new BadRequestException(`Falta exemplo para a variável {{${i}}}`);
    }
  }
}
