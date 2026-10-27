import { BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { PublicQuotesController } from './public-quotes.controller';

const THROTTLER_LIMIT = 'THROTTLER:LIMIT';
const THROTTLER_TTL = 'THROTTLER:TTL';
const TOKEN = 'a'.repeat(32);

function make() {
  const service = {
    view: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
    markViewed: jest.fn().mockResolvedValue({ ok: true }),
    pdf: jest.fn().mockResolvedValue({ buffer: Buffer.from('%PDF'), filename: 'cotacao-ABC123.pdf' }),
  } as any;
  return { ctrl: new PublicQuotesController(service), service };
}

function fakeRes() {
  return { setHeader: jest.fn(), end: jest.fn() } as any;
}

describe('PublicQuotesController', () => {
  const proto = PublicQuotesController.prototype;

  it('é público, sem guards, em /public/quotes', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, PublicQuotesController)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, PublicQuotesController)).toBeUndefined();
    expect(Reflect.getMetadata(PATH_METADATA, PublicQuotesController)).toBe('public/quotes');
  });

  it('throttle: 30/min na classe, 10/min em view e pdf', () => {
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}geral`, PublicQuotesController)).toBe(30);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}geral`, PublicQuotesController)).toBe(60_000);
    for (const m of [proto.markViewed, proto.pdf]) {
      expect(Reflect.getMetadata(`${THROTTLER_LIMIT}geral`, m)).toBe(10);
      expect(Reflect.getMetadata(`${THROTTLER_TTL}geral`, m)).toBe(60_000);
    }
  });

  it('POST view responde 200', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto.markViewed)).toBe(HttpStatus.OK);
  });

  it('token malformado é 400 nas três rotas, sem chamar o service', async () => {
    const { ctrl, service } = make();
    for (const bad of ['../x', 'a'.repeat(19), 'a'.repeat(65), `${'a'.repeat(20)}/`, `${'a'.repeat(20)}.`]) {
      expect(() => ctrl.view(bad)).toThrow(BadRequestException);
      expect(() => ctrl.markViewed(bad)).toThrow(BadRequestException);
      await expect(ctrl.pdf(bad, fakeRes())).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(service.view).not.toHaveBeenCalled();
    expect(service.markViewed).not.toHaveBeenCalled();
    expect(service.pdf).not.toHaveBeenCalled();
  });

  it('repassa token válido e propaga 404', async () => {
    const { ctrl, service } = make();
    service.view.mockRejectedValueOnce(new NotFoundException());

    await expect(ctrl.view(TOKEN)).rejects.toBeInstanceOf(NotFoundException);
    await expect(ctrl.markViewed(TOKEN)).resolves.toEqual({ ok: true });
    expect(service.markViewed).toHaveBeenCalledWith(TOKEN);
  });

  it('pdf: application/pdf inline com o nome da cotação e sem cache', async () => {
    const { ctrl } = make();
    const res = fakeRes();

    await ctrl.pdf(TOKEN, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'inline; filename="cotacao-ABC123.pdf"');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=0, no-store');
    expect(res.end).toHaveBeenCalledWith(Buffer.from('%PDF'));
  });
});
