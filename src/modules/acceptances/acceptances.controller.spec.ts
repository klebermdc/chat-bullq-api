import { PATH_METADATA } from '@nestjs/common/constants';
import { AcceptancesController } from './acceptances.controller';

/**
 * A ordem das rotas é comportamento, não estilo: o Nest casa na ordem de
 * declaração, então `@Post(':id/resend')` declarado antes engoliria
 * "extract-voucher-text" como se fosse um `:id` — e o endpoint responderia 404
 * (ou pior, tentaria reenviar um aceite inexistente) sem nenhum erro de tipo.
 * Só um comentário no arquivo não segura isso num refactor.
 */
describe('AcceptancesController — ordem das rotas', () => {
  function pathsInDeclarationOrder(): string[] {
    const proto = AcceptancesController.prototype;
    return Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor')
      .map((name) => Reflect.getMetadata(PATH_METADATA, (proto as any)[name]))
      .filter((path): path is string => typeof path === 'string');
  }

  it('declara as rotas literais antes da rota com :id', () => {
    const paths = pathsInDeclarationOrder();
    const resend = paths.indexOf(':id/resend');

    expect(resend).toBeGreaterThanOrEqual(0);
    expect(paths.indexOf('extract-voucher')).toBeLessThan(resend);
    expect(paths.indexOf('extract-voucher-text')).toBeLessThan(resend);
  });

  // O caminho do PDF não foi substituído pelo do texto colado: o dono quer as
  // duas fontes se complementando, então as duas rotas coexistem.
  it('mantém as duas rotas de extração', () => {
    const paths = pathsInDeclarationOrder();

    expect(paths).toContain('extract-voucher');
    expect(paths).toContain('extract-voucher-text');
  });
});

describe('AcceptancesController.extractVoucherText', () => {
  it('delega ao serviço com o org da sessão, não com nada vindo do body', async () => {
    const service = {
      extractVoucherText: jest
        .fn()
        .mockResolvedValue({ items: [], orderRef: null }),
    } as any;
    const controller = new AcceptancesController(service);

    await controller.extractVoucherText({ text: 'voucher colado' }, 'org-1');

    expect(service.extractVoucherText).toHaveBeenCalledWith('org-1', {
      text: 'voucher colado',
    });
  });
});
