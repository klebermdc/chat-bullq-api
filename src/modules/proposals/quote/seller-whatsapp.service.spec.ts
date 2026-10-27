import { SellerWhatsappService, toWhatsappDigits } from './seller-whatsapp.service';

const official = (config: Record<string, unknown> = { phoneNumberId: 'pn-1' }) =>
  ({ id: 'chan-1', type: 'WHATSAPP_OFFICIAL', config }) as any;

function make(display: string | Error = '+55 11 5198-4190') {
  const http = {
    verifyPhoneNumber: jest.fn(async () => {
      if (display instanceof Error) throw display;
      return { display_phone_number: display };
    }),
  } as any;
  return { svc: new SellerWhatsappService(http), http };
}

describe('toWhatsappDigits', () => {
  it('só dígitos, com DDI, de 10 a 15', () => {
    expect(toWhatsappDigits('+55 11 5198-4190')).toBe('551151984190');
    expect(toWhatsappDigits('123')).toBeNull();
    expect(toWhatsappDigits('1'.repeat(16))).toBeNull();
    expect(toWhatsappDigits(42)).toBeNull();
  });
});

describe('SellerWhatsappService', () => {
  afterEach(() => jest.useRealTimers());

  it('sem canal: null', async () => {
    expect(await make().svc.resolve(null)).toBeNull();
  });

  it('número salvo na config do canal vale sem chamar a Meta', async () => {
    const { svc, http } = make();

    expect(await svc.resolve(official({ displayPhoneNumber: '+55 11 99999-0000' }))).toBe('5511999990000');
    expect(http.verifyPhoneNumber).not.toHaveBeenCalled();
  });

  it('WhatsApp oficial: busca o display_phone_number na Meta e guarda em cache', async () => {
    const { svc, http } = make();

    expect(await svc.resolve(official())).toBe('551151984190');
    expect(await svc.resolve(official())).toBe('551151984190');
    expect(http.verifyPhoneNumber).toHaveBeenCalledTimes(1);
  });

  it('cache vence depois de 1h', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-26T12:00:00Z') });
    const { svc, http } = make();
    await svc.resolve(official());

    jest.setSystemTime(new Date('2026-10-26T13:00:01Z'));
    await svc.resolve(official());

    expect(http.verifyPhoneNumber).toHaveBeenCalledTimes(2);
  });

  it('falha na Meta vira null (a página esconde o botão), sem lançar, e tenta de novo após 5 min', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-26T12:00:00Z') });
    const { svc, http } = make(new Error('token vencido'));

    expect(await svc.resolve(official())).toBeNull();
    await svc.resolve(official());
    expect(http.verifyPhoneNumber).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date('2026-10-26T12:05:01Z'));
    await svc.resolve(official());
    expect(http.verifyPhoneNumber).toHaveBeenCalledTimes(2);
  });

  it('Instagram/Messenger sem número: null sem chamar a Meta', async () => {
    const { svc, http } = make();

    expect(await svc.resolve({ id: 'c2', type: 'INSTAGRAM', config: {} } as any)).toBeNull();
    expect(http.verifyPhoneNumber).not.toHaveBeenCalled();
  });
});
