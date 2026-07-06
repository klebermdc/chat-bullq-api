export type TemplateCategory = 'MARKETING' | 'UTILITY';

export type TemplateHeader =
  | { format: 'TEXT'; text: string; example?: string }
  | { format: 'IMAGE' | 'VIDEO' | 'DOCUMENT'; exampleHandle?: string };

export type TemplateButton =
  | { type: 'QUICK_REPLY'; text: string }
  | { type: 'URL'; text: string; url: string; example?: string }
  | { type: 'PHONE_NUMBER'; text: string; phone: string };

export interface TemplateComponents {
  header?: TemplateHeader;
  body: { text: string };
  footer?: { text: string };
  buttons?: TemplateButton[];
}

export type VariableExamples = Record<string, string>;

export interface GraphComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  [k: string]: unknown;
}

export interface GraphCreatePayload {
  name: string;
  language: string;
  category: TemplateCategory;
  components: GraphComponent[];
}
