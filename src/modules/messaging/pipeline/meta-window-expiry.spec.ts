import { InboundMessageProcessor } from './inbound-message.processor';

/**
 * `persistMetaWindowExpiry` grava o `conversation.expiration_timestamp` que a
 * Meta manda no webhook de status. Instanciado sem o container do Nest de
 * propósito: o método só toca `prisma` e `logger`, e montar as ~15 dependências
 * do processor não acrescentaria nada ao que está sendo verificado.
 */
function makeProcessor() {
  const updateMany = jest.fn(async (_args: any) => ({ count: 1 }));
  const warn = jest.fn();
  const proc: any = Object.create(InboundMessageProcessor.prototype);
  proc.prisma = { conversation: { updateMany } };
  proc.logger = { warn };
  return { proc, updateMany, warn };
}

describe('persistMetaWindowExpiry', () => {
  // Timestamp real do incidente de 2026-08-06 (72h após a 1ª mensagem do lead).
  const EXPIRATION = 1786303200;

  it('grava a expiração da Meta em segundos convertida para Date', async () => {
    const { proc, updateMany } = makeProcessor();

    await proc.persistMetaWindowExpiry('c1', EXPIRATION);

    expect(updateMany).toHaveBeenCalledTimes(1);
    const arg = updateMany.mock.calls[0][0] as any;
    expect(arg.data.metaWindowExpiresAt).toEqual(new Date(EXPIRATION * 1000));
    expect(arg.where.id).toBe('c1');
  });

  it('é monotônico: só grava quando é null ou menor que o valor novo', async () => {
    const { proc, updateMany } = makeProcessor();

    await proc.persistMetaWindowExpiry('c1', EXPIRATION);

    const where = (updateMany.mock.calls[0][0] as any).where;
    expect(where.OR).toEqual([
      { metaWindowExpiresAt: null },
      { metaWindowExpiresAt: { lt: new Date(EXPIRATION * 1000) } },
    ]);
  });

  it('status sem expiration (ex.: delivered) não apaga o valor já gravado', async () => {
    const { proc, updateMany } = makeProcessor();

    await proc.persistMetaWindowExpiry('c1', undefined);

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('erro de banco é engolido — nunca derruba o processamento do status', async () => {
    const { proc, updateMany, warn } = makeProcessor();
    updateMany.mockRejectedValueOnce(new Error('pool exhausted') as never);

    await expect(
      proc.persistMetaWindowExpiry('c1', EXPIRATION),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
