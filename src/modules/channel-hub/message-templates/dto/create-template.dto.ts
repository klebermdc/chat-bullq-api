import { IsString, IsIn, IsObject, IsOptional } from 'class-validator';
import {
  TemplateComponents,
  VariableExamples,
} from '../template-components.types';

export class CreateTemplateDto {
  @IsString() name: string;

  @IsOptional() @IsString() displayName?: string;

  @IsIn(['MARKETING', 'UTILITY']) category: 'MARKETING' | 'UTILITY';

  @IsOptional() @IsString() language?: string;

  @IsObject() components: TemplateComponents;

  @IsOptional() @IsObject() variableExamples?: VariableExamples;
}
