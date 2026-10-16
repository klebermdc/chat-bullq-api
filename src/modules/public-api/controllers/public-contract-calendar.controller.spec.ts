import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { OrgRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApiKeyAuthGuard } from '../../../common/guards';
import { ContractCalendarQueryDto } from '../dto/contract-calendar.public.dto';
import { ApiKeyThrottleGuard } from '../guards/api-key-throttle.guard';
import { PublicContractCalendarController } from './public-contract-calendar.controller';

// 16/10/2026 01:30 UTC = 15/10/2026 21:30 em Orlando (EDT, UTC-4).
const NOW = new Date('2026-10-16T01:30:00Z');
const TODAY_ORLANDO = '2026-10-15';

function make() {
  const calendar = { events: jest.fn().mockResolvedValue({ timezone: 'America/New_York', events: [] }) } as any;
  return { controller: new PublicContractCalendarController(calendar), calendar };
}

async function errorsFor(query: Record<string, unknown>) {
  const dto = plainToInstance(ContractCalendarQueryDto, query);
  return (await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property);
}

describe('PublicContractCalendarController (metadata)', () => {
  it('usa chave de API e throttle por chave na classe', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PublicContractCalendarController)).toEqual([
      ApiKeyAuthGuard,
      ApiKeyThrottleGuard,
    ]);
  });

  it('rota fora de public/contracts (que é do aceite por token)', () => {
    expect(Reflect.getMetadata(PATH_METADATA, PublicContractCalendarController)).toBe('public/contract-calendar');
  });
});

describe('ContractCalendarQueryDto', () => {
  it('aceita vazio e datas YYYY-MM-DD', async () => {
    expect(await errorsFor({})).toEqual([]);
    expect(await errorsFor({ from: '2026-10-15', to: '2026-12-31', guide: 'Kleber' })).toEqual([]);
  });

  it('recusa formato errado, guia longo e guia repetido', async () => {
    expect(await errorsFor({ from: '15/10/2026' })).toEqual(['from']);
    expect(await errorsFor({ to: '2026-10-15T00:00' })).toEqual(['to']);
    expect(await errorsFor({ guide: 'x'.repeat(101) })).toEqual(['guide']);
    expect(await errorsFor({ guide: ['a', 'b'] })).toEqual(['guide']);
  });
});

describe('PublicContractCalendarController.list', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  it('AGENT: repassa o ator com papel para o serviço aplicar o escopo', async () => {
    const { controller, calendar } = make();
    await controller.list('org1', 'u1', OrgRole.AGENT, {});
    expect(calendar.events).toHaveBeenCalledWith(
      'org1',
      { userId: 'u1', role: OrgRole.AGENT },
      expect.any(Object),
      undefined,
    );
  });

  it('janela padrão: hoje em Orlando até +90 dias', async () => {
    const { controller, calendar } = make();
    await controller.list('org1', 'u1', OrgRole.OWNER, { guide: 'Kleber' });
    expect(calendar.events).toHaveBeenCalledWith(
      'org1',
      { userId: 'u1', role: OrgRole.OWNER },
      { from: TODAY_ORLANDO, to: '2027-01-13', today: TODAY_ORLANDO },
      'Kleber',
    );
  });

  it('só from: to = from + 90 dias', async () => {
    const { controller, calendar } = make();
    await controller.list('org1', 'u1', OrgRole.ADMIN, { from: '2026-12-01' });
    expect(calendar.events.mock.calls[0][2]).toEqual({ from: '2026-12-01', to: '2027-03-01', today: TODAY_ORLANDO });
  });

  it('aceita janela de exatamente 180 dias', async () => {
    const { controller, calendar } = make();
    await controller.list('org1', 'u1', OrgRole.ADMIN, { from: '2026-10-15', to: '2027-04-13' });
    expect(calendar.events).toHaveBeenCalled();
  });

  it('400 se a janela passa de 180 dias', async () => {
    const { controller, calendar } = make();
    await expect(
      controller.list('org1', 'u1', OrgRole.ADMIN, { from: '2026-10-15', to: '2027-04-14' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(calendar.events).not.toHaveBeenCalled();
  });

  it('400 se to < from', async () => {
    const { controller } = make();
    await expect(
      controller.list('org1', 'u1', OrgRole.ADMIN, { from: '2026-11-10', to: '2026-11-09' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('devolve o corpo do serviço sem alterar (complete/count)', async () => {
    const { controller, calendar } = make();
    const body = { timezone: 'America/New_York', from: 'a', to: 'b', complete: true, count: 0, events: [] };
    calendar.events.mockResolvedValue(body);
    await expect(controller.list('org1', 'u1', OrgRole.ADMIN, {})).resolves.toBe(body);
  });

  it('400 (não 500) se from é inválido e to foi omitido', async () => {
    const { controller, calendar } = make();
    await expect(controller.list('org1', 'u1', OrgRole.ADMIN, { from: '2026-13-45' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(calendar.events).not.toHaveBeenCalled();
  });

  it('400 se a data não existe no calendário', async () => {
    const { controller } = make();
    await expect(controller.list('org1', 'u1', OrgRole.ADMIN, { from: '2026-02-30' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
