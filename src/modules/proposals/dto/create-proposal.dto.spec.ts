import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateProposalDto } from './create-proposal.dto';

/**
 * Pipe REAL, com a mesma config do `main.ts` (mesmo motivo do
 * create-acceptance.dto.spec.ts): validar com um pipe mais frouxo que o de
 * produção passaria por cobertura sem cobrir o que o servidor faz.
 */
describe('CreateProposalDto sob o ValidationPipe global', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const validate = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: CreateProposalDto });

  /** Coleta as mensagens de erro do pipe; falha o teste se o body passar. */
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

  const image = (n: number) => ({
    url: `https://api.x/api/v1/uploads/media/2026-10-07/${n}.png`,
    mimeType: 'image/png',
    filename: `print-${n}.png`,
    size: 2048,
  });
  const base = { conversationId: 'conv-1', checkoutUrl: '', includeLink: false };

  it('body de hoje (sem images) continua passando', async () => {
    const out: any = await validate({ conversationId: 'conv-1', checkoutUrl: 'https://x/checkout' });

    expect(out.images).toBeUndefined();
  });

  it('aceita checkoutUrl vazio com imagens e entrega cada imagem como veio', async () => {
    const out: any = await validate({ ...base, images: [image(1)] });

    expect(out.checkoutUrl).toBe('');
    expect(out.images).toEqual([image(1)]);
  });

  it('filename e size são opcionais', async () => {
    const { url, mimeType } = image(1);
    const out: any = await validate({ ...base, images: [{ url, mimeType }] });

    expect(Object.keys(out.images[0]).sort()).toEqual(['mimeType', 'url']);
  });

  it('aceita 10 imagens e recusa 11', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => i + 1);
    const out: any = await validate({ ...base, images: ten.map(image) });
    expect(out.images).toHaveLength(10);

    expect(await messagesFor({ ...base, images: [...ten, 11].map(image) })).toBe(
      'Envie no máximo 10 imagens.',
    );
  });

  it.each(['image/png', 'image/jpeg', 'image/webp'])('aceita %s', async (mimeType) => {
    const out: any = await validate({ ...base, images: [{ ...image(1), mimeType }] });

    expect(out.images[0].mimeType).toBe(mimeType);
  });

  it.each(['image/gif', 'image/svg+xml', 'application/pdf', 'video/mp4', ''])(
    'recusa mimeType %p',
    async (mimeType) => {
      expect(await messagesFor({ ...base, images: [{ ...image(1), mimeType }] })).toContain(
        'Imagem inválida.',
      );
    },
  );

  it.each([
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    '/api/v1/uploads/media/2026-10-07/1.png',
    'media/2026-10-07/1.png',
    '',
  ])('recusa url que não é http(s) absoluta: %p', async (url) => {
    // Esta url é persistida em `details.images` e vira `content.mediaUrl` de
    // uma mensagem ao cliente — a trava de esquema é no boundary.
    expect(await messagesFor({ ...base, images: [{ ...image(1), url }] })).toContain(
      'Imagem inválida.',
    );
  });

  it('aceita a URL de upload do dev local (sem TLD)', async () => {
    const url = 'http://localhost:3001/api/v1/uploads/media/2026-10-07/1.png';
    const out: any = await validate({ ...base, images: [{ ...image(1), url }] });

    expect(out.images[0].url).toBe(url);
  });

  it('recusa campo desconhecido dentro da imagem e images que não é lista', async () => {
    expect(await messagesFor({ ...base, images: [{ ...image(1), sha256: 'x' }] })).toMatch(/sha256/);
    expect(await messagesFor({ ...base, images: 'print.png' })).toMatch(/images/);
  });

  it('checkoutUrl continua tendo que ser texto', async () => {
    expect(await messagesFor({ conversationId: 'conv-1', images: [image(1)] })).toMatch(/checkoutUrl/);
  });

  it('text é opcional e tem o teto de tamanho do texto do WhatsApp', async () => {
    const out: any = await validate({ ...base, images: [image(1)], text: 'Olá!' });
    expect(out.text).toBe('Olá!');

    expect((await validate({ ...base, text: 'x'.repeat(4096) }) as any).text).toHaveLength(4096);
    expect(await messagesFor({ ...base, text: 'x'.repeat(4097) })).toMatch(/4096/);
  });

  describe('storeLink (carrinho da loja)', () => {
    const LINK = 'https://reservas.orlandofastpass.com.br/pt/checkout/ce6098a76c64497384c1874896d64317';
    const STORE_ERROR = /link do carrinho da loja/;

    it('é opcional', async () => {
      const out: any = await validate({ ...base, images: [image(1)] });

      expect(out.storeLink).toBeUndefined();
    });

    it.each([
      LINK,
      'https://reservas.orlandofastpass.com.br/en/checkout/ce6098a76c64497384c1874896d64317',
      'https://reservas.orlandofastpass.com.br/pt/checkout/ce6098a76c64497384c1874896d64317/',
      'https://reservas.orlandofastpass.com.br/pt/checkout/abc-123?utm_source=x',
    ])('aceita o carrinho da loja: %s', async (storeLink) => {
      const out: any = await validate({ ...base, storeLink });

      expect(out.storeLink).toBe(storeLink);
    });

    it.each([
      ['http em vez de https', LINK.replace('https:', 'http:')],
      ['outro host', 'https://evil.com/pt/checkout/abc'],
      ['subdomínio parecido', 'https://reservas.orlandofastpass.com.br.evil.com/pt/checkout/abc'],
      ['usuário embutido', 'https://evil.com@reservas.orlandofastpass.com.br/pt/checkout/abc'],
      ['host com usuário', 'https://x@reservas.orlandofastpass.com.br/pt/checkout/abc'],
      ['porta', 'https://reservas.orlandofastpass.com.br:8443/pt/checkout/abc'],
      ['outro caminho', 'https://reservas.orlandofastpass.com.br/pt/minha-conta'],
      ['checkout sem id', 'https://reservas.orlandofastpass.com.br/pt/checkout/'],
      ['idioma com 3 letras', 'https://reservas.orlandofastpass.com.br/por/checkout/abc'],
      ['IP interno', 'https://169.254.169.254/pt/checkout/abc'],
      ['file://', 'file:///etc/passwd'],
      ['texto qualquer', 'carrinho'],
    ])('recusa %s com mensagem amigável', async (_, storeLink) => {
      expect(await messagesFor({ ...base, storeLink })).toMatch(STORE_ERROR);
    });

    it('recusa link com mais de 500 caracteres', async () => {
      const storeLink = `${LINK}?x=${'a'.repeat(500)}`;

      expect(await messagesFor({ ...base, storeLink })).toMatch(/500/);
    });

    it('recusa storeLink que não é texto', async () => {
      expect(await messagesFor({ ...base, storeLink: 123 })).toMatch(STORE_ERROR);
    });
  });
});
