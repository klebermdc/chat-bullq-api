import { PATH_METADATA } from '@nestjs/common/constants';
import { NotFoundException } from '@nestjs/common';
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
    const controller = new AcceptancesController(service, {} as never, {} as never);

    await controller.extractVoucherText({ text: 'voucher colado' }, 'org-1');

    expect(service.extractVoucherText).toHaveBeenCalledWith('org-1', {
      text: 'voucher colado',
    });
  });
});

describe('AcceptancesController — acesso por conversa no PDF e no reenvio', () => {
  const actor = ['org-1', 'AGENT', 'u-1', new Set(['ch-1'])] as const;

  it('reenvio confere a conversa antes de renovar', async () => {
    const order: string[] = [];
    const access = { assertAccess: jest.fn().mockImplementation(async () => { order.push('access'); }) };
    const service = { resend: jest.fn().mockImplementation(async () => { order.push('resend'); return { link: 'l' }; }) };
    const controller = new AcceptancesController(service as any, {} as never, access as any);
    await controller.resend('acc-1', ...actor);
    expect(access.assertAccess).toHaveBeenCalledWith(
      { organizationId: 'org-1', role: 'AGENT', userId: 'u-1', channelAccess: actor[3] }, 'acc-1');
    expect(order).toEqual(['access', 'resend']);
  });

  it('sem acesso à conversa: nem reenvia nem busca o PDF', async () => {
    const access = { assertAccess: jest.fn().mockRejectedValue(new NotFoundException()) };
    const service = { resend: jest.fn(), pdfKeyForOrg: jest.fn() };
    const controller = new AcceptancesController(service as any, {} as never, access as any);
    await expect(controller.resend('acc-1', ...actor)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.pdf('acc-1', ...actor, {} as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(service.resend).not.toHaveBeenCalled();
    expect(service.pdfKeyForOrg).not.toHaveBeenCalled();
  });
});
