import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { AcceptContractDto } from './dto/accept.dto';
import { PublicContractsController } from './public-contracts.controller';

const THROTTLER_LIMIT = 'THROTTLER:LIMIT';
const THROTTLER_TTL = 'THROTTLER:TTL';
const TOKEN = 'a'.repeat(43);

function make() {
  const acceptance = {
    view: jest.fn().mockResolvedValue({ fullName: 'Ana' }),
    accept: jest.fn().mockResolvedValue({ accepted: true }),
    pdfByToken: jest.fn(),
    uploadReceipt: jest.fn().mockResolvedValue({ received: true }),
  } as any;
  const files = { stream: jest.fn().mockResolvedValue(undefined) } as any;
  return { ctrl: new PublicContractsController(acceptance, files), acceptance, files };
}

describe('PublicContractsController', () => {
  const proto = PublicContractsController.prototype;

  it('é público e sem guards', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, PublicContractsController)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, PublicContractsController)).toBeUndefined();
  });

  it('throttle: 30/min na classe, 5/min em accept e receipt', () => {
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}geral`, PublicContractsController)).toBe(30);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}geral`, PublicContractsController)).toBe(60_000);
    for (const m of [proto.accept, proto.receipt]) {
      expect(Reflect.getMetadata(`${THROTTLER_LIMIT}geral`, m)).toBe(5);
      expect(Reflect.getMetadata(`${THROTTLER_TTL}geral`, m)).toBe(60_000);
    }
  });

  it('token malformado dá 400 sem chamar o service', () => {
    const { ctrl, acceptance } = make();
    for (const bad of ['../x', 'a'.repeat(19), 'a'.repeat(65), `${'a'.repeat(20)}/`, `${'a'.repeat(20)}.`]) {
      expect(() => ctrl.view(bad)).toThrow(BadRequestException);
    }
    expect(acceptance.view).not.toHaveBeenCalled();
  });

  it('aceita token legado do Lovable (24 hex) e o novo (43 base64url)', () => {
    const { ctrl, acceptance } = make();
    expect(() => ctrl.view('934d56314e0144f98b5788ba')).not.toThrow();
    expect(() => ctrl.view('AbC_-0123456789abcdefghijklmnopqrstuvwxyzAB')).not.toThrow();
    expect(acceptance.view).toHaveBeenCalledTimes(2);
  });

  it('accept usa req.ip e user-agent', async () => {
    const { ctrl, acceptance } = make();
    await ctrl.accept(TOKEN, { signature: 's', agree: true }, { ip: '1.2.3.4', get: () => 'UA' } as any);
    expect(acceptance.accept).toHaveBeenCalledWith(TOKEN, { signature: 's', agree: true }, { ip: '1.2.3.4', userAgent: 'UA' });
  });

  it('accept sem ip nem user-agent passa null', async () => {
    const { ctrl, acceptance } = make();
    await ctrl.accept(TOKEN, { signature: 's', agree: true }, { ip: undefined, get: () => undefined } as any);
    expect(acceptance.accept).toHaveBeenCalledWith(TOKEN, expect.anything(), { ip: null, userAgent: null });
  });

  it('pdf com chave guardada faz stream; sem chave entrega o buffer sem cache', async () => {
    const { ctrl, acceptance, files } = make();
    const res = { setHeader: jest.fn(), end: jest.fn() } as any;
    acceptance.pdfByToken.mockResolvedValueOnce({ key: 'contracts/org1/c1/acceptance-1.pdf' });
    await ctrl.pdf(TOKEN, res);
    expect(files.stream).toHaveBeenCalledWith('contracts/org1/c1/acceptance-1.pdf', res, 'contrato.pdf');

    acceptance.pdfByToken.mockResolvedValueOnce({ buffer: Buffer.from('%PDF') });
    await ctrl.pdf(TOKEN, res);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=0, no-store');
    expect(res.end).toHaveBeenCalledWith(Buffer.from('%PDF'));
  });

  it('receipt sem arquivo dá 400', () => {
    const { ctrl } = make();
    expect(() => ctrl.receipt(TOKEN, undefined)).toThrow(BadRequestException);
  });

  it('receipt passa a URL pública do app sem barra final', async () => {
    const prev = process.env.APP_PUBLIC_URL;
    process.env.APP_PUBLIC_URL = 'https://app.example/';
    try {
      const { ctrl, acceptance } = make();
      const file = { buffer: Buffer.from('%PDF-1'), mimetype: 'application/pdf', size: 6 };
      await ctrl.receipt(TOKEN, file);
      expect(acceptance.uploadReceipt).toHaveBeenCalledWith(TOKEN, file, 'https://app.example');
    } finally {
      process.env.APP_PUBLIC_URL = prev;
    }
  });
});

describe('AcceptContractDto', () => {
  const errors = (body: unknown) => validateSync(plainToInstance(AcceptContractDto, body));

  it('aceita assinatura e concordância', () => {
    expect(errors({ signature: 'data:image/png;base64,AAAA', agree: true })).toHaveLength(0);
  });

  it('recusa assinatura acima de 85.000 caracteres e agree não booleano', () => {
    expect(errors({ signature: 'x'.repeat(85_001), agree: true })).not.toHaveLength(0);
    expect(errors({ signature: 'x', agree: 'sim' })).not.toHaveLength(0);
    expect(errors({ agree: true })).not.toHaveLength(0);
  });
});
