import { BadRequestException, ParseEnumPipe } from '@nestjs/common';
import { GUARDS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { ContractsController } from './contracts.controller';

const THROTTLER_LIMIT = 'THROTTLER:LIMIT';
const THROTTLER_TTL = 'THROTTLER:TTL';
const ADMIN = OrgRole.ADMIN;
const AGENT = OrgRole.AGENT;

function make() {
  const contracts = {
    get: jest.fn().mockResolvedValue({ id: 'c1', acceptanceToken: 'tok' }),
    stats: jest.fn().mockResolvedValue({ total: 1 }),
    list: jest.fn().mockResolvedValue({ items: [] }),
    updateFlags: jest.fn(),
    pdfFor: jest.fn(),
  } as any;
  const files = {
    upload: jest.fn().mockResolvedValue('contracts/org1/c1/x.pdf'),
    stream: jest.fn(),
    keyFor: jest.fn().mockResolvedValue('contracts/org1/c1/signature-1.png'),
    clear: jest.fn(),
  } as any;
  const settings = { unblockDate: jest.fn() } as any;
  const reports = { billing: jest.fn(), multipassReminders: jest.fn(), calendar: jest.fn() } as any;
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

  it.each(['billing', 'putSettings', 'block', 'unblock', 'remove', 'clearFile'])('%s é só OWNER/ADMIN', (m) => {
    expect(reflector.get(ROLES_KEY, proto[m])).toEqual([OrgRole.OWNER, OrgRole.ADMIN]);
  });

  it('o resto não exige papel (o escopo do AGENT vem do serviço)', () => {
    const open = [
      'list', 'stats', 'calendar', 'reminders', 'getSettings', 'blocked', 'create', 'get', 'update', 'flags',
      'moveDate', 'token', 'upload', 'file', 'pdf',
    ];
    for (const m of open) expect(reflector.get(ROLES_KEY, proto[m])).toBeUndefined();
  });

  it('PDF tem limite próprio: 20 por minuto no throttler geral', () => {
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}geral`, proto.pdf)).toBe(20);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}geral`, proto.pdf)).toBe(60_000);
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
    await expect(controller.get('org1', 'u1', ADMIN, 'c1')).resolves.toMatchObject({ acceptLinkPath: '/aceitar/tok' });
  });

  it('detalhe sem token devolve acceptLinkPath null', async () => {
    const { controller, contracts } = make();
    contracts.get.mockResolvedValue({ id: 'c1', acceptanceToken: null });
    await expect(controller.get('org1', 'u1', ADMIN, 'c1')).resolves.toMatchObject({ acceptLinkPath: null });
  });

  it('upload sem arquivo dá 400', async () => {
    const { controller, files } = make();
    await expect(controller.upload('org1', 'u1', ADMIN, 'c1', 'signed-contract', undefined)).rejects.toBeInstanceOf(BadRequestException);
    expect(files.upload).not.toHaveBeenCalled();
  });

  it('upload devolve a chave gravada', async () => {
    const { controller } = make();
    const file = { buffer: Buffer.from('%PDF'), mimetype: 'application/pdf', size: 4 };
    await expect(controller.upload('org1', 'u1', ADMIN, 'c1', 'signed-contract', file)).resolves.toEqual({ key: 'contracts/org1/c1/x.pdf' });
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

  it('desbloquear recusa guia vazio ou acima de 100 caracteres', () => {
    const { controller, settings } = make();
    expect(() => controller.unblock('org1', '   ', '2026-12-24')).toThrow(BadRequestException);
    expect(() => controller.unblock('org1', 'x'.repeat(101), '2026-12-24')).toThrow(BadRequestException);
    expect(settings.unblockDate).not.toHaveBeenCalled();
  });

  it('lembretes usam a data de hoje em Orlando', () => {
    const { controller, reports } = make();
    controller.reminders('org1', 'u1', AGENT, { guide: 'Kleber' });
    expect(reports.multipassReminders).toHaveBeenCalledWith(
      'org1',
      { userId: 'u1', role: AGENT },
      'Kleber',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it('pdf com chave guardada vai por stream', async () => {
    const { controller, contracts, files } = make();
    contracts.pdfFor.mockResolvedValue({ key: 'contracts/org1/c1/acceptance.pdf' });
    const res = { setHeader: jest.fn(), end: jest.fn() } as any;
    await controller.pdf('org1', 'u1', ADMIN, 'c1', res);
    expect(files.stream).toHaveBeenCalledWith('contracts/org1/c1/acceptance.pdf', res, 'contrato.pdf');
    expect(res.end).not.toHaveBeenCalled();
  });

  it('pdf gerado na hora sai sem cache', async () => {
    const { controller, contracts } = make();
    contracts.pdfFor.mockResolvedValue({ buffer: Buffer.from('%PDF') });
    const res = { setHeader: jest.fn(), end: jest.fn() } as any;
    await controller.pdf('org1', 'u1', ADMIN, 'c1', res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=0, no-store');
    expect(res.end).toHaveBeenCalledWith(Buffer.from('%PDF'));
  });
});

describe('ContractsController (ator e resposta)', () => {
  it('detalhe tira user agent e chaves cruas, devolve booleanos', async () => {
    const { controller, contracts } = make();
    contracts.get.mockResolvedValue({
      id: 'c1', acceptanceToken: 'tok', clientUserAgent: 'Mozilla', clientIp: '1.2.3.4',
      signatureKey: 'contracts/org1/s.png', signedContractKey: null, paymentReceiptKey: null,
      acceptancePdfKey: 'contracts/org1/a.pdf',
    });
    const r: any = await controller.get('org1', 'u1', AGENT, 'c1');
    expect(contracts.get).toHaveBeenCalledWith('org1', { userId: 'u1', role: AGENT }, 'c1');
    for (const k of ['clientUserAgent', 'signatureKey', 'signedContractKey', 'paymentReceiptKey', 'acceptancePdfKey']) {
      expect(r).not.toHaveProperty(k);
    }
    expect(r).toMatchObject({
      acceptLinkPath: '/aceitar/tok', hasSignature: true, hasSignedContract: false,
      hasPaymentReceipt: false, hasAcceptancePdf: true,
    });
  });

  it('list, stats, calendário, flags, arquivos e pdf repassam o ator', async () => {
    const { controller, contracts, reports, files } = make();
    const actor = { userId: 'u1', role: AGENT };
    await controller.list('org1', 'u1', AGENT, {} as any);
    expect(contracts.list).toHaveBeenCalledWith('org1', actor, {});
    await controller.stats('org1', 'u1', AGENT, { guide: 'K' });
    expect(contracts.stats).toHaveBeenCalledWith('org1', actor, 'K');
    await controller.calendar('org1', 'u1', AGENT, {});
    expect(reports.calendar).toHaveBeenCalledWith('org1', actor, undefined);
    await controller.flags('org1', 'u1', AGENT, 'c1', { purchased: true });
    expect(contracts.updateFlags).toHaveBeenCalledWith('org1', actor, 'c1', { purchased: true });
    const res = { setHeader: jest.fn(), end: jest.fn() } as any;
    await controller.file('org1', 'u1', AGENT, 'c1', 'signature', res);
    expect(files.keyFor).toHaveBeenCalledWith('org1', actor, 'c1', 'signature');
    expect(files.stream).toHaveBeenCalledWith('contracts/org1/c1/signature-1.png', res, 'signature.png');
    contracts.pdfFor.mockResolvedValue({ buffer: Buffer.from('%PDF') });
    await controller.pdf('org1', 'u1', AGENT, 'c1', res);
    expect(contracts.pdfFor).toHaveBeenCalledWith('org1', actor, 'c1');
  });
});
