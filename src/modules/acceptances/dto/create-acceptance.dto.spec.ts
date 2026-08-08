import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { OrderSentDto } from './create-acceptance.dto';

/**
 * Estes testes rodam o pipe REAL, com a mesma config do `main.ts`. Validar com
 * um pipe mais frouxo que o de produção seria pior que não testar: passaria por
 * cobertura sem cobrir o que o servidor de verdade faz.
 */
describe('OrderSentDto sob o ValidationPipe global', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const validate = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: OrderSentDto });

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

  const voucher = (n: number) => ({
    url: `https://api.x/api/v1/uploads/media/2026-08-06/${n}.pdf`,
    filename: `voucher-${n}.pdf`,
    size: 1024,
  });

  it('aceita um body bem-formado e entrega só url/filename/size por voucher', async () => {
    const out: any = await validate({
      withAcceptance: true,
      items: [{ description: 'Magic Kingdom', ref: 'ABC123' }],
      orderRef: '61293',
      vouchers: [voucher(1)],
    });

    expect(out.orderRef).toBe('61293');
    expect(out.items[0].ref).toBe('ABC123');
    expect(Object.keys(out.vouchers[0]).sort()).toEqual(['filename', 'size', 'url']);
  });

  it('aceita 20 vouchers e recusa 21', async () => {
    const vinte = Array.from({ length: 20 }, (_, i) => voucher(i));
    const out: any = await validate({ vouchers: vinte });
    expect(out.vouchers).toHaveLength(20);

    // O teto não é estética: cada voucher vira uma leitura no storage dentro do
    // mesmo request (`withHashes`), então o tamanho do array é o fan-out.
    expect(await messagesFor({ vouchers: [...vinte, voucher(21)] })).toMatch(
      /vouchers/,
    );
  });

  it('aceita orderRef de 64 caracteres e recusa 65', async () => {
    const out: any = await validate({ orderRef: 'x'.repeat(64) });
    expect(out.orderRef).toHaveLength(64);

    expect(await messagesFor({ orderRef: 'x'.repeat(65) })).toMatch(/orderRef/);
  });

  it('recusa url com esquema perigoso e aceita a URL de upload legítima', async () => {
    // Esta `url` é persistida no aceite e vira `href` em /aceite/[token] — uma
    // página PÚBLICA, sem sessão, onde o cliente assina. Com `@IsString()` puro,
    // um membro autenticado da org plantava `javascript:` num link ao vivo na
    // página de assinatura do próprio cliente. A trava é de ESQUEMA, no
    // boundary, porque a mesma string ainda vai pro PDF e pro `content.mediaUrl`.
    for (const url of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      // Relativa continua recusada de propósito: `POST messages/uploads/media`
      // devolve absoluta (`${APP_URL}/api/v1/uploads/...`).
      '/api/v1/uploads/media/2026-08-06/a.pdf',
    ]) {
      expect(await messagesFor({ vouchers: [{ ...voucher(1), url }] })).toMatch(
        /url/,
      );
    }

    const legitimas = [
      'https://api.explotek.pro/api/v1/uploads/media/2026-08-06/a1b2.pdf',
      // Valor documentado de APP_URL no dev local (.env.production.example).
      'http://localhost:3001/api/v1/uploads/media/2026-08-06/a1b2.pdf',
    ];
    for (const url of legitimas) {
      const out: any = await validate({ vouchers: [{ ...voucher(1), url }] });
      expect(out.vouchers[0].url).toBe(url);
    }
  });

  /**
   * O ciclo fechado da feature: a extração devolve `passengers`, o modal manda
   * os mesmos itens de volta neste body e o PDF do comprovante os lista. Se o
   * DTO não aceitasse o campo, o `forbidNonWhitelisted` recusaria o "Pedido
   * enviado" INTEIRO com 400 — a extração funcionaria e a entrega quebraria.
   */
  describe('passageiros do item', () => {
    const item = (over: Record<string, unknown> = {}) => ({
      description: 'WALT DISNEY WORLD - INGRESSO 1 DIA EPCOT',
      ...over,
    });

    it('aceita o item com passageiros e preserva nome e nascimento', async () => {
      const passengers = [
        { name: 'Rodolpho Carvalho Costa da Rocha', birthDate: '07/11/1988' },
        { name: 'Maria Helena Dantas Carvalho da Rocha', birthDate: '20/04/2020' },
      ];

      const out: any = await validate({
        items: [item({ qty: 3, date: '14/09/2026', passengers })],
      });

      expect(out.items[0].passengers).toEqual(passengers);
    });

    it('aceita passageiro sem nascimento e item sem passageiros', async () => {
      const semData: any = await validate({
        items: [item({ passengers: [{ name: 'Ana Souza' }] })],
      });
      expect(semData.items[0].passengers).toEqual([{ name: 'Ana Souza' }]);

      const semLista: any = await validate({ items: [item()] });
      expect(semLista.items[0].passengers).toBeUndefined();
    });

    it('recusa passageiro sem nome', async () => {
      expect(
        await messagesFor({ items: [item({ passengers: [{ birthDate: '07/11/1988' }] })] }),
      ).toMatch(/name/);
    });

    it('recusa campo desconhecido dentro do passageiro', async () => {
      expect(
        await messagesFor({
          items: [item({ passengers: [{ name: 'Ana', cpf: '000.000.000-00' }] })],
        }),
      ).toMatch(/cpf/);
    });

    // Sem teto, um body forjado vira um comprovante de mil páginas — a lista
    // cai no Json do aceite e no PDF sem mais nenhuma trava depois daqui.
    it('recusa lista de passageiros e campos absurdamente grandes', async () => {
      const muitos = Array.from({ length: 51 }, (_, n) => ({ name: `P${n}` }));
      expect(await messagesFor({ items: [item({ passengers: muitos })] })).toMatch(
        /passengers/,
      );

      expect(
        await messagesFor({ items: [item({ passengers: [{ name: 'a'.repeat(121) }] })] }),
      ).toMatch(/name/);

      expect(
        await messagesFor({
          items: [item({ passengers: [{ name: 'Ana', birthDate: 'b'.repeat(41) }] })],
        }),
      ).toMatch(/birthDate/);
    });
  });

  it('recusa sha256 contrabandeado dentro de um voucher', async () => {
    // A premissa da feature inteira: o hash é prova que o SERVIDOR produziu
    // lendo o arquivo. Se o cliente conseguisse afirmar o sha256, o aceite
    // provaria apenas que o cliente digitou um hash.
    const messages = await messagesFor({
      vouchers: [{ ...voucher(1), sha256: 'a'.repeat(64) }],
    });
    expect(messages).toMatch(/sha256/);
  });
});
