import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  CreateDocumentTemplateDto,
  ListDocumentTemplatesQueryDto,
  MAX_BODY_LENGTH,
  UpdateDocumentTemplateDto,
} from './document-template.dto';
import { CreateContractDto, FillTemplateDto } from './fill-template.dto';
import { MAX_VALUE_KEYS, MAX_VALUE_LENGTH } from '../placeholders.util';

/** Mesma config do `main.ts`: testar com pipe mais frouxo não cobriria nada. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const run = (metatype: any, value: unknown, type: 'body' | 'query' = 'body') =>
  pipe.transform(value, { type, metatype });

async function rejects(metatype: any, value: unknown, type: 'body' | 'query' = 'body') {
  await expect(run(metatype, value, type)).rejects.toBeInstanceOf(BadRequestException);
}

describe('CreateDocumentTemplateDto', () => {
  const ok = { title: '  Contrato  ', category: 'Viagem', audience: 'CLIENT', body: 'Eu, [Nome do Cliente]' };

  it('aceita body válido e apara título/categoria', async () => {
    const out: any = await run(CreateDocumentTemplateDto, ok);
    expect(out.title).toBe('Contrato');
    expect(out.audience).toBe('CLIENT');
  });

  it('recusa título vazio, longo demais e audience inválida', async () => {
    await rejects(CreateDocumentTemplateDto, { ...ok, title: '   ' });
    await rejects(CreateDocumentTemplateDto, { ...ok, title: 'x'.repeat(201) });
    await rejects(CreateDocumentTemplateDto, { ...ok, audience: 'PUBLIC' });
  });

  it('recusa corpo vazio ou acima do teto', async () => {
    await rejects(CreateDocumentTemplateDto, { ...ok, body: '' });
    await rejects(CreateDocumentTemplateDto, { ...ok, body: 'x'.repeat(MAX_BODY_LENGTH + 1) });
  });

  it('recusa campo desconhecido (organizationId não entra pelo body)', async () => {
    await rejects(CreateDocumentTemplateDto, { ...ok, organizationId: 'outra-org' });
  });
});

describe('UpdateDocumentTemplateDto', () => {
  it('aceita patch parcial e isActive', async () => {
    const out: any = await run(UpdateDocumentTemplateDto, { isActive: false });
    expect(out.isActive).toBe(false);
  });

  it('recusa título só com espaço', async () => {
    await rejects(UpdateDocumentTemplateDto, { title: '  ' });
  });
});

describe('ListDocumentTemplatesQueryDto', () => {
  it('"false" na query vira false (não true)', async () => {
    const out: any = await run(ListDocumentTemplatesQueryDto, { includeInactive: 'false' }, 'query');
    expect(out.includeInactive).toBe(false);
  });

  it('"true" vira true e audience é validada', async () => {
    const out: any = await run(ListDocumentTemplatesQueryDto, { includeInactive: 'true', audience: 'INTERNAL' }, 'query');
    expect(out).toEqual(expect.objectContaining({ includeInactive: true, audience: 'INTERNAL' }));
    await rejects(ListDocumentTemplatesQueryDto, { audience: 'X' }, 'query');
    await rejects(ListDocumentTemplatesQueryDto, { includeInactive: 'talvez' }, 'query');
  });
});

describe('FillTemplateDto / CreateContractDto', () => {
  it('aceita values como objeto de strings', async () => {
    const out: any = await run(FillTemplateDto, { values: { 'Nome do Cliente': 'Ana' } });
    expect(out.values).toEqual({ 'Nome do Cliente': 'Ana' });
  });

  it('recusa values com valor não-string, array, chaves demais ou valor longo demais', async () => {
    await rejects(FillTemplateDto, { values: { a: 1 } });
    await rejects(FillTemplateDto, { values: ['a'] });
    await rejects(FillTemplateDto, { values: 'x' });
    const many = Object.fromEntries(Array.from({ length: MAX_VALUE_KEYS + 1 }, (_, i) => [`k${i}`, 'v']));
    await rejects(FillTemplateDto, { values: many });
    await rejects(FillTemplateDto, { values: { a: 'x'.repeat(MAX_VALUE_LENGTH + 1) } });
  });

  it('contrato exige templateId e limita expiresInDays', async () => {
    await rejects(CreateContractDto, { values: {} });
    await rejects(CreateContractDto, { templateId: 't1', expiresInDays: 0 });
    await rejects(CreateContractDto, { templateId: 't1', expiresInDays: 91 });
    const out: any = await run(CreateContractDto, { templateId: 't1', expiresInDays: 7, values: {} });
    expect(out.expiresInDays).toBe(7);
  });
});
