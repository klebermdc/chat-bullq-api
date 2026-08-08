import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  ExtractVoucherTextDto,
  VOUCHER_TEXT_MAX_LENGTH,
} from './extract-voucher-text.dto';

/**
 * Roda o pipe REAL, com a mesma config do `main.ts`, pelo mesmo motivo do
 * `create-acceptance.dto.spec.ts`: validar com pipe mais frouxo que o de
 * produção passa por cobertura sem cobrir o que o servidor faz.
 */
describe('ExtractVoucherTextDto sob o ValidationPipe global', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const validate = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: ExtractVoucherTextDto });

  it('aceita o texto colado de um voucher', async () => {
    const text = 'Ingressos\n\nWALT DISNEY WORLD - INGRESSO 1 DIA EPCOT';

    await expect(validate({ text })).resolves.toMatchObject({ text });
  });

  // Voucher com vários passageiros e regras de uso passa fácil de alguns
  // milhares de caracteres — o corte tem que barrar abuso, não voucher real.
  it('aceita texto longo até o limite', async () => {
    const text = 'a'.repeat(VOUCHER_TEXT_MAX_LENGTH);

    await expect(validate({ text })).resolves.toMatchObject({ text });
  });

  it('recusa texto acima do limite', async () => {
    const text = 'a'.repeat(VOUCHER_TEXT_MAX_LENGTH + 1);

    await expect(validate({ text })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa body sem campo `text`, nulo ou array', async () => {
    await expect(validate({})).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ text: null })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(validate({ text: ['a', 'b'] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  /**
   * Comportamento REAL do pipe global, não o que a intuição diz: com
   * `enableImplicitConversion`, o class-transformer converte para string ANTES
   * de o `@IsString()` rodar, então número e booleano passam como "123"/"true".
   * Idêntico ao irmão `ExtractVoucherDto` (`mediaUrl: 123` vira "123") — é
   * config do `main.ts`, não deste DTO, e apertar só aqui criaria divergência.
   *
   * Documentado em vez de "corrigido" porque a consequência é inofensiva: o
   * valor coagido é uma string curta e sem sentido, o `@MaxLength` continua
   * valendo, e o prompt grounded devolve `{items: [], orderRef: null}` para
   * texto que não é voucher. Um teste afirmando que isto é recusado passaria a
   * mentir sobre o servidor de verdade.
   */
  it('escalar não-string é COAGIDO pelo pipe global, não recusado', async () => {
    await expect(validate({ text: 123 })).resolves.toMatchObject({
      text: '123',
    });
    await expect(validate({ text: true })).resolves.toMatchObject({
      text: 'true',
    });
  });

  it('recusa campo desconhecido no body (whitelist do pipe global)', async () => {
    await expect(
      validate({ text: 'voucher', organizationId: 'org-de-outro' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // O texto vazio é decidido no serviço (devolve vazio sem chamar o LLM), não
  // aqui: recusar com 400 obrigaria o modal a tratar um erro que não é erro.
  it('deixa passar texto vazio — quem decide o que fazer com ele é o serviço', async () => {
    await expect(validate({ text: '   ' })).resolves.toMatchObject({
      text: '   ',
    });
  });
});
