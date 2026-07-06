import { TemplateComponents, VariableExamples, GraphComponent } from './template-components.types';

export function countBodyVariables(text: string): number {
  const matches = text.match(/\{\{\s*\d+\s*\}\}/g);
  return matches ? new Set(matches.map((m) => m.replace(/\D/g, ''))).size : 0;
}

export function toGraphComponents(c: TemplateComponents, examples: VariableExamples): GraphComponent[] {
  const out: GraphComponent[] = [];
  if (c.header) {
    if (c.header.format === 'TEXT') {
      const h: GraphComponent = { type: 'HEADER', format: 'TEXT', text: c.header.text };
      if (c.header.example) (h as any).example = { header_text: [c.header.example] };
      out.push(h);
    } else {
      const h: GraphComponent = { type: 'HEADER', format: c.header.format };
      if (c.header.exampleHandle) (h as any).example = { header_handle: [c.header.exampleHandle] };
      out.push(h);
    }
  }
  const nVars = countBodyVariables(c.body.text);
  const body: GraphComponent = { type: 'BODY', text: c.body.text };
  if (nVars > 0) {
    const row = Array.from({ length: nVars }, (_, i) => examples[String(i + 1)] ?? '');
    (body as any).example = { body_text: [row] };
  }
  out.push(body);
  if (c.footer) out.push({ type: 'FOOTER', text: c.footer.text });
  if (c.buttons?.length) {
    out.push({ type: 'BUTTONS', buttons: c.buttons.map((b) => {
      if (b.type === 'URL') return { type: 'URL', text: b.text, url: b.url };
      if (b.type === 'PHONE_NUMBER') return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone };
      return { type: 'QUICK_REPLY', text: b.text };
    }) });
  }
  return out;
}
