import { ChannelType } from '@prisma/client';
import { ConversationsService } from './conversations.service';
import { ConversationsRepository } from './conversations.repository';

/**
 * Regressão: `channelTypes` chegava tipado em findInbox mas NÃO era copiado
 * para o objeto InboxFilters entregue ao repositório. O filtro sumia em
 * silêncio — o Inbox Instagram listava WhatsApp junto, e o inbox geral
 * listava tudo, sem nenhum erro em lugar nenhum.
 *
 * O teste é no service de propósito: um teste de repositório passaria, já
 * que o `where` estava certo. O elo quebrado era o repasse.
 */
describe('ConversationsService.findInbox — repasse de channelTypes', () => {
  function buildService() {
    const findInbox = jest
      .fn()
      .mockResolvedValue({ conversations: [], total: 0 });
    const repository = { findInbox } as unknown as ConversationsRepository;
    // Só o repositório importa aqui. As outras dependências entram como
    // objetos vazios via spread, e não uma a uma: findInbox não toca em
    // nenhuma delas, e listá-las faria este teste quebrar toda vez que
    // alguém injetasse mais um serviço no construtor.
    const service = new (ConversationsService as unknown as new (
      ...args: unknown[]
    ) => ConversationsService)(repository, ...Array(14).fill({}));
    return { service, findInbox };
  }

  const filtersOf = (fn: jest.Mock) => fn.mock.calls[0][0];

  it('entrega os tipos pedidos ao repositório', async () => {
    const { service, findInbox } = buildService();

    await service.findInbox(
      'org-1',
      { channelTypes: [ChannelType.INSTAGRAM] },
      1,
      30,
    );

    expect(filtersOf(findInbox).channelTypes).toEqual([ChannelType.INSTAGRAM]);
  });

  it('entrega os três sabores de WhatsApp juntos', async () => {
    const { service, findInbox } = buildService();
    const whatsapp = [
      ChannelType.WHATSAPP_OFFICIAL,
      ChannelType.WHATSAPP_ZAPPFY,
      ChannelType.WHATSAPP_WASENDER,
    ];

    await service.findInbox('org-1', { channelTypes: whatsapp }, 1, 30);

    expect(filtersOf(findInbox).channelTypes).toEqual(whatsapp);
  });

  it('sem o filtro, não inventa nenhum tipo', async () => {
    const { service, findInbox } = buildService();

    await service.findInbox('org-1', {}, 1, 30);

    expect(filtersOf(findInbox).channelTypes).toBeUndefined();
  });
});
