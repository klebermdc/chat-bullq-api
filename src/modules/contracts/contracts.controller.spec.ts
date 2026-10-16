import { BadRequestException, Logger, NotFoundException, ParseEnumPipe } from '@nestjs/common';
import { GUARDS_METADATA, HEADERS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
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
    updateFlags: jest.fn().mockResolvedValue({ id: 'c1', acceptanceToken: 'tok', purchased: true }),
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
  const parser = { parse: jest.fn().mockResolvedValue({ fullName: 'Ana', parkDates: [] }) } as any;
  const planejador = {
    sync: jest.fn().mockResolvedValue(undefined),
    revealPassword: jest.fn().mockResolvedValue({ email: 'c@example.com', password: 'Senha!234' }),
  } as any;
  return {
    controller: new ContractsController(contracts, files, settings, reports, parser, planejador),
    contracts, files, settings, reports, parser, planejador,
  };
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
      'moveDate', 'token', 'upload', 'file', 'pdf', 'parse', 'retryPlanejador', 'planejadorCredentials',
    ];
    for (const m of open) expect(reflector.get(ROLES_KEY, proto[m])).toBeUndefined();
  });

  it('PDF tem limite próprio: 20 por minuto no throttler geral', () => {
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}geral`, proto.pdf)).toBe(20);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}geral`, proto.pdf)).toBe(60_000);
  });

  it('parse por IA tem limite próprio: 20 por minuto no throttler geral', () => {
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}geral`, proto.parse)).toBe(20);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}geral`, proto.parse)).toBe(60_000);
  });

  it.each(['retryPlanejador', 'planejadorCredentials'])('%s tem limite próprio: 10 por minuto no throttler geral', (m) => {
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}geral`, proto[m])).toBe(10);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}geral`, proto[m])).toBe(60_000);
  });

  it('credenciais do Planejador saem com Cache-Control: no-store', () => {
    expect(Reflect.getMetadata(HEADERS_METADATA, proto.planejadorCredentials)).toEqual(
      expect.arrayContaining([{ name: 'Cache-Control', value: 'no-store' }]),
    );
  });

  it('rotas fixas vêm antes de :id', () => {
    const names = Object.getOwnPropertyNames(proto);
    const idx = (n: string) => names.indexOf(n);
    expect(idx('get')).toBeGreaterThan(-1);
    for (const fixed of [
      'stats', 'billing', 'calendar', 'reminders', 'getSettings', 'putSettings', 'blocked', 'block', 'unblock', 'parse',
    ]) {
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

describe('ContractsController (IA e Planejador)', () => {
  it('parse repassa org e texto ao parser', async () => {
    const { controller, parser } = make();
    await expect(controller.parse('org1', { rawText: 'Ana, 2 pessoas' })).resolves.toEqual({ fullName: 'Ana', parkDates: [] });
    expect(parser.parse).toHaveBeenCalledWith('org1', 'Ana, 2 pessoas');
  });

  it('tentar de novo carrega com o escopo do ator, sincroniza e devolve o estado relido', async () => {
    const { controller, contracts, planejador } = make();
    const before = { id: 'c1', planejadorSyncedAt: null, planejadorError: 'timeout' };
    const syncedAt = new Date('2026-10-16T12:00:00Z');
    contracts.get.mockResolvedValueOnce(before).mockResolvedValueOnce({ ...before, planejadorSyncedAt: syncedAt, planejadorError: null });
    await expect(controller.retryPlanejador('org1', 'u1', AGENT, 'c1')).resolves.toEqual({ syncedAt, error: null });
    expect(contracts.get).toHaveBeenNthCalledWith(1, 'org1', { userId: 'u1', role: AGENT }, 'c1');
    expect(planejador.sync).toHaveBeenCalledWith(before, { force: false });
  });

  it.each([
    [ADMIN, { force: true }, true],
    [OrgRole.OWNER, { force: true }, true],
    [ADMIN, {}, false],
    [ADMIN, undefined, false],
    [AGENT, { force: true }, false],
    [undefined, { force: true }, false],
  ])('papel %p com body %p: force=%p', async (role, body, force) => {
    const { controller, contracts, planejador } = make();
    contracts.get.mockResolvedValue({ id: 'c1', planejadorSyncedAt: new Date(), planejadorError: null });
    await controller.retryPlanejador('org1', 'u1', role as OrgRole | undefined, 'c1', body as any);
    expect(planejador.sync).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }), { force });
  });

  it('tentar de novo em contrato fora do escopo propaga o 404 e não sincroniza', async () => {
    const { controller, contracts, planejador } = make();
    contracts.get.mockRejectedValue(new NotFoundException());
    await expect(controller.retryPlanejador('org1', 'u1', AGENT, 'c9')).rejects.toBeInstanceOf(NotFoundException);
    expect(planejador.sync).not.toHaveBeenCalled();
  });

  it('credenciais usam o escopo do ator: AGENT filtra pelo criador, staff vê a org', async () => {
    const { controller, planejador } = make();
    await expect(controller.planejadorCredentials('org1', 'u1', AGENT, 'c1')).resolves.toEqual({
      email: 'c@example.com', password: 'Senha!234',
    });
    expect(planejador.revealPassword).toHaveBeenCalledWith('org1', 'c1', { createdById: 'u1' });
    await controller.planejadorCredentials('org1', 'a1', ADMIN, 'c1');
    expect(planejador.revealPassword).toHaveBeenLastCalledWith('org1', 'c1', {});
  });

  it('revelar credenciais deixa log de auditoria sem senha nem e-mail', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const { controller } = make();
      await controller.planejadorCredentials('org1', 'u1', AGENT, 'c1');
      expect(log).toHaveBeenCalledWith('contract_planejador_credentials_revealed contract=c1 user=u1 role=AGENT');
      const all = JSON.stringify(log.mock.calls);
      expect(all).not.toContain('Senha!234');
      expect(all).not.toContain('c@example.com');
    } finally {
      log.mockRestore();
    }
  });

  it('credenciais negadas (404) não registram revelação', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const { controller, planejador } = make();
      planejador.revealPassword.mockRejectedValue(new NotFoundException());
      await expect(controller.planejadorCredentials('org1', 'u1', AGENT, 'c1')).rejects.toBeInstanceOf(NotFoundException);
      expect(log).not.toHaveBeenCalledWith(expect.stringContaining('contract_planejador_credentials_revealed'));
    } finally {
      log.mockRestore();
    }
  });

  it('detalhe não devolve a senha cifrada, só o estado do Planejador', async () => {
    const { controller, contracts } = make();
    const syncedAt = new Date('2026-10-16T12:00:00Z');
    contracts.get.mockResolvedValue({
      id: 'c1', acceptanceToken: 'tok', planejadorPasswordEnc: 'v1:abc:def', planejadorSyncedAt: syncedAt,
      planejadorError: null,
    });
    const r: any = await controller.get('org1', 'u1', AGENT, 'c1');
    expect(r).not.toHaveProperty('planejadorPasswordEnc');
    expect(r).toMatchObject({ planejadorSyncedAt: syncedAt, planejadorError: null });
  });
});

describe('ContractsController (nenhuma resposta vaza segredos)', () => {
  const HIDDEN = [
    'planejadorPasswordEnc', 'signatureKey', 'signedContractKey', 'paymentReceiptKey', 'acceptancePdfKey', 'clientUserAgent',
  ];
  const RAW = {
    id: 'c1', acceptanceToken: 'tok', fullName: 'Ana', clientUserAgent: 'Mozilla', planejadorPasswordEnc: 'v1:abc:def',
    planejadorSyncedAt: null, planejadorError: null, signatureKey: 'contracts/org1/s.png',
    signedContractKey: 'contracts/org1/c.pdf', paymentReceiptKey: 'contracts/org1/p.png', acceptancePdfKey: 'contracts/org1/a.pdf',
  };

  function makeWithRaw() {
    const m = make();
    for (const fn of ['get', 'create', 'update', 'updateFlags', 'moveDate', 'regenerateToken']) {
      m.contracts[fn] = jest.fn().mockResolvedValue({ ...RAW });
    }
    return m;
  }

  const calls: Array<[string, (c: ContractsController) => Promise<unknown>]> = [
    ['GET :id', (c) => c.get('org1', 'u1', AGENT, 'c1')],
    ['POST /', (c) => c.create('org1', 'u1', {} as any)],
    ['PATCH :id', (c) => c.update('org1', 'u1', AGENT, 'c1', {} as any)],
    ['PATCH :id/flags', (c) => c.flags('org1', 'u1', AGENT, 'c1', { purchased: true })],
    ['PATCH :id/dates', (c) => c.moveDate('org1', 'u1', AGENT, 'c1', { from: '2026-12-02', to: '2026-12-03' } as any)],
    ['POST :id/token', (c) => c.token('org1', 'u1', AGENT, 'c1')],
  ];

  it.each(calls)('%s devolve a visão do detalhe, sem chaves cruas, user agent nem senha cifrada', async (_n, call) => {
    const { controller } = makeWithRaw();
    const r: any = await call(controller);
    for (const k of HIDDEN) expect(r).not.toHaveProperty(k);
    expect(r).toMatchObject({
      id: 'c1', fullName: 'Ana', acceptLinkPath: '/aceitar/tok', hasSignature: true, hasSignedContract: true,
      hasPaymentReceipt: true, hasAcceptancePdf: true, planejadorSyncedAt: null, planejadorError: null,
    });
  });

  it('create repassa org, criador e dto ao serviço', async () => {
    const { controller, contracts } = makeWithRaw();
    const dto = { fullName: 'Ana' } as any;
    await controller.create('org1', 'u1', dto);
    expect(contracts.create).toHaveBeenCalledWith('org1', 'u1', dto);
  });

  it('update, datas e token repassam o ator', async () => {
    const { controller, contracts } = makeWithRaw();
    const actor = { userId: 'u1', role: AGENT };
    await controller.update('org1', 'u1', AGENT, 'c1', { notes: 'x' } as any);
    expect(contracts.update).toHaveBeenCalledWith('org1', actor, 'c1', { notes: 'x' });
    const move = { from: '2026-12-02', to: '2026-12-03' } as any;
    await controller.moveDate('org1', 'u1', AGENT, 'c1', move);
    expect(contracts.moveDate).toHaveBeenCalledWith('org1', actor, 'c1', move);
    await controller.token('org1', 'u1', AGENT, 'c1');
    expect(contracts.regenerateToken).toHaveBeenCalledWith('org1', actor, 'c1');
  });
});
