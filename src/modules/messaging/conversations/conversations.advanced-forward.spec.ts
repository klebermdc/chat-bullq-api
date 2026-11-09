import { ConversationsService } from './conversations.service';
import { ConversationsRepository } from './conversations.repository';
import { parseAdvancedQuery } from './inbox-advanced-query';

/**
 * Regressão: `phases` (Com a IA / Na fila) era lido da URL mas não era
 * copiado para o InboxFilters entregue ao repositório. O filtro "Na fila"
 * devolvia a caixa de entrada inteira, sem erro. Mesmo elo quebrado do
 * channelTypes (ver conversations.channel-types.spec.ts): o teste fica no
 * service e cobre TODO filtro avançado, para o próximo campo não sumir igual.
 */
describe('ConversationsService.findInbox — repasse dos filtros avançados', () => {
  function buildService() {
    const findInbox = jest.fn().mockResolvedValue({ conversations: [], total: 0 });
    const repository = { findInbox } as unknown as ConversationsRepository;
    const service = new (ConversationsService as unknown as new (
      ...args: unknown[]
    ) => ConversationsService)(repository, ...Array(14).fill({}));
    return { service, findInbox };
  }

  it('entrega a fase "Na fila" ao repositório', async () => {
    const { service, findInbox } = buildService();

    await service.findInbox('org-1', { tab: 'inbox', phases: ['queue'] }, 1, 30);

    expect(findInbox.mock.calls[0][0].phases).toEqual(['queue']);
  });

  it('entrega todo campo que parseAdvancedQuery produz', async () => {
    const { service, findInbox } = buildService();
    const parsed = parseAdvancedQuery(
      {
        tagMode: 'all',
        excludeTagIds: 't1',
        stageIds: 's1',
        lost: 'only',
        lostReasons: 'PRICE',
        origin: 'ad',
        idleHours: '5',
        dateField: 'created',
        phase: 'sdr,queue',
      },
      new Date('2026-11-09T12:00:00Z'),
    );
    const { channelIds: _channels, ...advanced } = parsed;

    await service.findInbox('org-1', advanced, 1, 30);

    const sent = findInbox.mock.calls[0][0];
    for (const [key, value] of Object.entries(advanced)) {
      if (value === undefined) continue;
      expect({ key, value: sent[key] }).toEqual({ key, value });
    }
  });
});
