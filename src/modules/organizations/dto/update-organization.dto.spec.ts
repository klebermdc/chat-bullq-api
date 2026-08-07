import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateOrganizationDto } from './update-organization.dto';

/**
 * Estes testes rodam o pipe REAL, com a mesma config do `main.ts`. Validar com
 * um pipe mais frouxo que o de produção seria pior que não testar: passaria por
 * cobertura sem cobrir o que o servidor de verdade faz.
 *
 * O alvo aqui é a política de cancelamento. O teste de serviço prova que o
 * campo chega ao repositório; este prova que ele SOBREVIVE ao boundary —
 * decorator faltando ou `whitelist: true` engolindo o campo dariam o mesmo
 * sintoma silencioso (o dono salva, a tela mostra sucesso e nada muda) sem
 * quebrar aquele outro teste.
 */
describe('UpdateOrganizationDto sob o ValidationPipe global', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const validate = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: UpdateOrganizationDto });

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

  it('deixa passar a política de cancelamento', async () => {
    const out: any = await validate({
      cancellationPolicy: 'Cancelamento em até 7 dias com reembolso integral.',
    });

    expect(out.cancellationPolicy).toBe(
      'Cancelamento em até 7 dias com reembolso integral.',
    );
  });

  it('null sobrevive ao whitelist e chega como null (é assim que se limpa a política)', async () => {
    // O `@ValidateIf` pula os validadores quando o valor é null. O risco é o
    // `whitelist: true` interpretar "não validado" como "não permitido" e
    // descartar o campo — aí limpar a política viraria um no-op silencioso.
    const out: any = await validate({ cancellationPolicy: null });

    expect(out).toHaveProperty('cancellationPolicy');
    expect(out.cancellationPolicy).toBeNull();
  });

  it('aceita 5000 caracteres e recusa 5001', async () => {
    // O texto real tem ~900 caracteres; o teto é folgado de propósito, mas
    // existe: sem ele a coluna TEXT aceita um upload inteiro por engano.
    const out: any = await validate({ cancellationPolicy: 'x'.repeat(5000) });
    expect(out.cancellationPolicy).toHaveLength(5000);

    expect(await messagesFor({ cancellationPolicy: 'x'.repeat(5001) })).toMatch(
      /cancellationPolicy/,
    );
  });

  it('recusa política que não é string', async () => {
    expect(await messagesFor({ cancellationPolicy: 123 })).toMatch(
      /cancellationPolicy/,
    );
  });
});
