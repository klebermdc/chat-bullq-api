import { BadRequestException, ParseEnumPipe } from '@nestjs/common';
import { GUARDS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { ContractsController } from './contracts.controller';

function make() {
  const contracts = {
    get: jest.fn().mockResolvedValue({ id: 'c1', acceptanceToken: 'tok' }),
    stats: jest.fn().mockResolvedValue({ total: 1 }),
    pdfFor: jest.fn(),
  } as any;
  const files = { upload: jest.fn().mockResolvedValue('contracts/org1/c1/x.pdf'), stream: jest.fn() } as any;
  const settings = { unblockDate: jest.fn() } as any;
  const reports = { billing: jest.fn(), multipassReminders: jest.fn() } as any;
  return { controller: new ContractsController(contracts, files, settings, reports), contracts, files, settings, reports };
}

/** Pipes declarados em @Param('kind', pipe) do método. */
function kindPipe(method: string): ParseEnumPipe {
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, ContractsController, method) as Record<
    string,
    { data?: string; pipes: unknown[] }
  >;
  const kind = Object.values(args).find((a) => a.data === 'kind');
  return kind!.pipes[0] as ParseEnumPipe;
}

describe('ContractsController (metadata)', () => {
  const reflector = new Reflector();
  const proto = ContractsController.prototype as any;

  it('usa JWT, Org e Roles', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ContractsController)).toEqual([JwtAuthGuard, OrgGuard, RolesGuard]);
  });

  it('apagar e editar configurações são só OWNER/ADMIN', () => {
    expect(reflector.get(ROLES_KEY, proto.remove)).toEqual([OrgRole.OWNER, OrgRole.ADMIN]);
    expect(reflector.get(ROLES_KEY, proto.putSettings)).toEqual([OrgRole.OWNER, OrgRole.ADMIN]);
  });

  it('o resto não exige papel', () => {
    for (const m of ['list', 'create', 'update', 'flags', 'upload', 'getSettings', 'block']) {
      expect(reflector.get(ROLES_KEY, proto[m])).toBeUndefined();
    }
  });

  it('rotas fixas vêm antes de :id', () => {
    const names = Object.getOwnPropertyNames(proto);
    const idx = (n: string) => names.indexOf(n);
    expect(idx('get')).toBeGreaterThan(-1);
    for (const fixed of ['stats', 'billing', 'calendar', 'reminders', 'getSettings', 'putSettings', 'blocked', 'block', 'unblock']) {
      expect(idx(fixed)).toBeGreaterThan(-1);
      expect(idx(fixed)).toBeLessThan(idx('get'));
    }
  });

  it('kind do upload aceita só arquivos do operador', async () => {
    const pipe = kindPipe('upload');
    await expect(pipe.transform('signed-contract', { type: 'param' })).resolves.toBe('signed-contract');
    await expect(pipe.transform('signature', { type: 'param' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('kind de leitura aceita assinatura e PDF de aceite', async () => {
    const pipe = kindPipe('file');
    await expect(pipe.transform('acceptance-pdf', { type: 'param' })).resolves.toBe('acceptance-pdf');
    await expect(pipe.transform('../etc', { type: 'param' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ContractsController (handlers)', () => {
  it('detalhe inclui o caminho do link de aceite', async () => {
    const { controller } = make();
    await expect(controller.get('org1', 'c1')).resolves.toMatchObject({ acceptLinkPath: '/aceitar/tok' });
  });

  it('detalhe sem token devolve acceptLinkPath null', async () => {
    const { controller, contracts } = make();
    contracts.get.mockResolvedValue({ id: 'c1', acceptanceToken: null });
    await expect(controller.get('org1', 'c1')).resolves.toMatchObject({ acceptLinkPath: null });
  });

  it('upload sem arquivo dá 400', async () => {
    const { controller, files } = make();
    await expect(controller.upload('org1', 'c1', 'signed-contract', undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(files.upload).not.toHaveBeenCalled();
  });

  it('upload devolve a chave gravada', async () => {
    const { controller } = make();
    const file = { buffer: Buffer.from('%PDF'), mimetype: 'application/pdf', size: 4 };
    await expect(controller.upload('org1', 'c1', 'signed-contract', file)).resolves.toEqual({ key: 'contracts/org1/c1/x.pdf' });
  });

  it('billing exige ano', () => {
    const { controller } = make();
    expect(() => controller.billing('org1', {} as any)).toThrow(BadRequestException);
  });

  it('desbloquear recusa data fora de YYYY-MM-DD', () => {
    const { controller, settings } = make();
    expect(() => controller.unblock('org1', 'Kleber', '02/12/2026')).toThrow(BadRequestException);
    expect(settings.unblockDate).not.toHaveBeenCalled();
  });

  it('lembretes usam a data de hoje em Orlando', () => {
    const { controller, reports } = make();
    controller.reminders('org1', 'Kleber');
    expect(reports.multipassReminders).toHaveBeenCalledWith('org1', 'Kleber', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it('pdf com chave guardada vai por stream', async () => {
    const { controller, contracts, files } = make();
    contracts.pdfFor.mockResolvedValue({ key: 'contracts/org1/c1/acceptance.pdf' });
    const res = { setHeader: jest.fn(), end: jest.fn() } as any;
    await controller.pdf('org1', 'c1', res);
    expect(files.stream).toHaveBeenCalledWith('contracts/org1/c1/acceptance.pdf', res, 'contrato.pdf');
    expect(res.end).not.toHaveBeenCalled();
  });

  it('pdf gerado na hora sai sem cache', async () => {
    const { controller, contracts } = make();
    contracts.pdfFor.mockResolvedValue({ buffer: Buffer.from('%PDF') });
    const res = { setHeader: jest.fn(), end: jest.fn() } as any;
    await controller.pdf('org1', 'c1', res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=0, no-store');
    expect(res.end).toHaveBeenCalledWith(Buffer.from('%PDF'));
  });
});
