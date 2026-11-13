import { NotFoundException } from '@nestjs/common';
import { WhatsappCostsService } from './whatsapp-costs.service';

const NOW = new Date('2026-11-13T18:00:00Z');
const D12 = 1794452400; // 12/11 00:00 BRT

function setup(metaImpl?: jest.Mock) {
  const repository = {
    orgTimezone: jest.fn(async () => 'America/Sao_Paulo'),
    listChannels: jest.fn(async () => [
      { id: 'novo', name: 'Orlando Fast Pass', wabaId: 'w1', token: 't1' },
      { id: 'parado', name: 'Parado', wabaId: 'w2', token: 't2' },
      { id: 'sem', name: 'Sem conta', wabaId: null, token: null },
    ]),
    billedMessages: jest.fn(async () => [
      { category: 'SERVICE', conversationId: 'c1', senderId: 'u1', senderName: null, userName: 'Pedro', isAi: false, isAutomated: false, templateName: null, templateCategory: null },
    ]),
  };
  const meta = {
    fetchDaily:
      metaImpl ??
      jest.fn(async (waba: string) =>
        waba === 'w1'
          ? { currency: 'BRL', points: [{ start: D12, end: D12 + 86400, category: 'SERVICE', type: 'REGULAR', volume: 100, cost: 3.5 }] }
          : { currency: 'USD', points: [] },
      ),
  };
  return { service: new WhatsappCostsService(repository as never, meta as never), repository, meta };
}

describe('WhatsappCostsService', () => {
  it('traz só canais com movimento ou erro, e soma por moeda', async () => {
    const { service } = setup();
    const report = await service.getCosts('org', NOW, '2026-11-12', '2026-11-13');
    expect(report.channels.map((c) => c.channelId)).toEqual(['novo', 'sem']);
    expect(report.channels[1]).toMatchObject({ status: 'error', error: 'Canal sem conta da Meta configurada' });
    expect(report.totalsByCurrency).toEqual([{ currency: 'BRL', cost: 3.5 }]);
    expect(report.channels[0].daily.map((d) => d.cost)).toEqual([3.5, 0]);
  });

  it('erro da Meta vira status de erro no canal, sem derrubar os outros', async () => {
    const meta = jest.fn(async () => {
      throw new Error('Meta 400: token expirado');
    });
    const report = await setup(meta).service.getCosts('org', NOW);
    expect(report.channels.find((c) => c.channelId === 'novo')).toMatchObject({ status: 'error', error: 'Meta 400: token expirado' });
  });

  it('guarda o resultado por 10 min', async () => {
    const s = setup();
    await s.service.getCosts('org', NOW, '2026-11-12', '2026-11-12');
    await s.service.getCosts('org', new Date(NOW.getTime() + 60_000), '2026-11-12', '2026-11-12');
    expect(s.meta.fetchDaily).toHaveBeenCalledTimes(2); // 2 canais com conta; a 2ª leitura vem do cache
  });

  it('detalhe usa o preço médio da Meta no período', async () => {
    const detail = await setup().service.getBreakdown('org', 'novo', NOW, '2026-11-12', '2026-11-13');
    expect(detail.unitPrices).toEqual({ SERVICE: 0.035 });
    expect(detail.senders[0]).toMatchObject({ name: 'Pedro', cost: 0.04 });
  });

  it('detalhe de canal de outra org dá 404', async () => {
    await expect(setup().service.getBreakdown('org', 'x', NOW)).rejects.toBeInstanceOf(NotFoundException);
  });
});
