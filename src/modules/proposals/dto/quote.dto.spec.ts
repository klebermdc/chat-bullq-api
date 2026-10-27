import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateProposalDto } from './create-proposal.dto';

/** Mesmo pipe global do main.ts (ver create-proposal.dto.spec.ts). */
describe('CreateProposalDto — cotação por link', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const validate = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: CreateProposalDto });

  async function messagesFor(body: unknown): Promise<string> {
    try {
      await validate(body);
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const res = (err as BadRequestException).getResponse() as any;
      return [].concat(res?.message ?? []).join(' | ');
    }
    throw new Error('esperava que o pipe recusasse este body, mas ele passou');
  }

  const item = (over: Record<string, unknown> = {}) => ({
    provider: 'Universal Orlando Resort',
    title: 'Ingresso 2 parques 3 dias',
    startDate: '2026-12-10',
    endDate: '2026-12-12',
    description: null,
    adults: 2,
    children: 1,
    priceAdult: null,
    priceChild: null,
    total: 9000.5,
    cancellationPolicy: 'Não reembolsável',
    ...over,
  });
  const quote = (over: Record<string, unknown> = {}) => ({
    items: [item()],
    currency: 'BRL',
    total: 9000.5,
    pixTotal: 8500,
    installments: { count: 10, value: 900.05 },
    notes: null,
    ...over,
  });
  const image = { url: 'https://api.x/api/v1/uploads/media/2026-10-26/1.png', mimeType: 'image/png' };
  const base = {
    conversationId: 'conv-1',
    checkoutUrl: '',
    includeLink: false,
    format: 'LINK',
    images: [image],
  };

  it('aceita uma cotação completa e entrega os campos como vieram', async () => {
    const out: any = await validate({ ...base, quote: quote(), customerName: 'Ana Souza', validityHours: 48 });

    expect(out.format).toBe('LINK');
    expect(out.customerName).toBe('Ana Souza');
    expect(out.validityHours).toBe(48);
    expect(out.quote.items[0].title).toBe('Ingresso 2 parques 3 dias');
    expect(out.quote.installments).toEqual({ count: 10, value: 900.05 });
  });

  it('format é opcional e só aceita TEXT ou LINK', async () => {
    const out: any = await validate({ conversationId: 'conv-1', checkoutUrl: 'https://x/c' });
    expect(out.format).toBeUndefined();

    expect(await messagesFor({ ...base, format: 'PDF' })).toMatch(/format/);
  });

  it('campos nulos opcionais passam (datas, preços, descrição, Pix, parcelas)', async () => {
    const out: any = await validate({
      ...base,
      quote: quote({
        items: [item({ startDate: null, endDate: null, priceAdult: null, cancellationPolicy: null })],
        pixTotal: null,
        installments: null,
      }),
    });

    expect(out.quote.items[0].startDate).toBeNull();
    expect(out.quote.pixTotal).toBeNull();
  });

  it('validityHours inteiro de 1 a 168', async () => {
    expect(((await validate({ ...base, validityHours: 1 })) as any).validityHours).toBe(1);
    expect(((await validate({ ...base, validityHours: 168 })) as any).validityHours).toBe(168);
    expect(await messagesFor({ ...base, validityHours: 0 })).toMatch(/validade/i);
    expect(await messagesFor({ ...base, validityHours: 169 })).toMatch(/validade/i);
    expect(await messagesFor({ ...base, validityHours: 1.5 })).toMatch(/validade/i);
  });

  it('customerName até 60', async () => {
    expect(((await validate({ ...base, customerName: 'x'.repeat(60) })) as any).customerName).toHaveLength(60);
    expect(await messagesFor({ ...base, customerName: 'x'.repeat(61) })).toMatch(/60/);
  });

  it('de 1 a 10 itens', async () => {
    expect(await messagesFor({ ...base, quote: quote({ items: [] }) })).toMatch(/item/i);
    const ten = Array.from({ length: 10 }, () => item());
    expect(((await validate({ ...base, quote: quote({ items: ten }) })) as any).quote.items).toHaveLength(10);
    expect(await messagesFor({ ...base, quote: quote({ items: [...ten, item()] }) })).toMatch(/10/);
  });

  it.each([
    ['provider', 'x'.repeat(81), /80/],
    ['title', 'x'.repeat(201), /200/],
    ['title', '', /título/i],
    ['description', 'x'.repeat(601), /600/],
    ['cancellationPolicy', 'x'.repeat(601), /600/],
    ['adults', 21, /adultos/i],
    ['adults', -1, /adultos/i],
    ['children', 21, /crianças/i],
    ['adults', 1.5, /adultos/i],
    ['total', 0, /total/i],
    ['total', -10, /total/i],
    ['priceAdult', -1, /preço/i],
    ['startDate', '10/12/2026', /data/i],
    ['startDate', '2026-02-30', /data/i],
    ['endDate', '2026-13-01', /data/i],
  ])('item: recusa %s = %p', async (field, value, expected) => {
    expect(await messagesFor({ ...base, quote: quote({ items: [item({ [field]: value })] }) })).toMatch(
      expected,
    );
  });

  it.each([
    ['total', 0, /total/i],
    ['currency', 'real', /moeda/i],
    ['pixTotal', 0, /pix/i],
    ['notes', 'x'.repeat(601), /600/],
    ['installments', { count: 0, value: 10 }, /parcelas/i],
    ['installments', { count: 11, value: 10 }, /parcelas/i],
    ['installments', { count: 10, value: 0 }, /parcela/i],
  ])('quote: recusa %s = %p', async (field, value, expected) => {
    expect(await messagesFor({ ...base, quote: quote({ [field]: value }) })).toMatch(expected);
  });

  it('recusa campo desconhecido (CPF, nome de viajante) na cotação e no item', async () => {
    expect(await messagesFor({ ...base, quote: quote({ cpf: '123.456.789-00' }) })).toMatch(/cpf/);
    expect(await messagesFor({ ...base, quote: quote({ items: [item({ travelerName: 'João' })] }) })).toMatch(
      /travelerName/,
    );
  });

  it('valor acima do teto de sanidade é recusado', async () => {
    expect(await messagesFor({ ...base, quote: quote({ total: 10_000_000 }) })).toMatch(/total/i);
  });
});
