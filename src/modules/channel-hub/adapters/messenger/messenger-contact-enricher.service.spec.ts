import { Channel } from '@prisma/client';
import { MessengerContactEnricherService } from './messenger-contact-enricher.service';
import { MessengerHttpClient } from './messenger.http-client';
import { PrismaService } from '../../../../database/prisma.service';

function makeChannel(): Channel {
  return { id: 'ch_1', config: {} } as unknown as Channel;
}

describe('MessengerContactEnricherService', () => {
  let httpClient: jest.Mocked<Pick<MessengerHttpClient, 'getUserProfile'>>;
  let prisma: {
    contactChannel: { findUnique: jest.Mock; update: jest.Mock };
    contact: { update: jest.Mock };
  };
  let service: MessengerContactEnricherService;

  beforeEach(() => {
    httpClient = { getUserProfile: jest.fn() };
    prisma = {
      contactChannel: { findUnique: jest.fn(), update: jest.fn() },
      contact: { update: jest.fn() },
    };
    service = new MessengerContactEnricherService(
      prisma as unknown as PrismaService,
      httpClient as unknown as MessengerHttpClient,
    );
  });

  it('junta first_name + last_name e grava no ContactChannel e no Contact vazios', async () => {
    httpClient.getUserProfile.mockResolvedValue({
      first_name: 'Maria',
      last_name: 'Silva',
      profile_pic: 'https://x/avatar.jpg',
    });
    prisma.contactChannel.findUnique.mockResolvedValue({
      id: 'cc_1',
      contactId: 'contact_1',
      profileName: null,
      profileAvatarUrl: null,
      contact: { name: null, avatarUrl: null },
    });

    await service.enrich(makeChannel(), 'PSID_1');

    expect(prisma.contactChannel.update).toHaveBeenCalledWith({
      where: { id: 'cc_1' },
      data: { profileName: 'Maria Silva', profileAvatarUrl: 'https://x/avatar.jpg' },
    });
    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: 'contact_1' },
      data: { name: 'Maria Silva', avatarUrl: 'https://x/avatar.jpg' },
    });
  });

  it('nao sobrescreve nome/avatar que o Contact ja tinha', async () => {
    httpClient.getUserProfile.mockResolvedValue({
      first_name: 'Maria',
      last_name: 'Silva',
      profile_pic: 'https://x/avatar.jpg',
    });
    prisma.contactChannel.findUnique.mockResolvedValue({
      id: 'cc_1',
      contactId: 'contact_1',
      profileName: 'Maria Silva',
      profileAvatarUrl: 'https://x/avatar.jpg',
      contact: { name: 'Nome Que Ja Existia', avatarUrl: 'https://existente/avatar.jpg' },
    });

    await service.enrich(makeChannel(), 'PSID_1');

    expect(prisma.contactChannel.update).not.toHaveBeenCalled();
    expect(prisma.contact.update).not.toHaveBeenCalled();
  });

  it('nao faz nada quando o Graph nao devolve perfil', async () => {
    httpClient.getUserProfile.mockResolvedValue(null);

    await service.enrich(makeChannel(), 'PSID_1');

    expect(prisma.contactChannel.findUnique).not.toHaveBeenCalled();
  });

  it('nao faz nada quando nao existe ContactChannel pro PSID', async () => {
    httpClient.getUserProfile.mockResolvedValue({ first_name: 'Maria' });
    prisma.contactChannel.findUnique.mockResolvedValue(null);

    await service.enrich(makeChannel(), 'PSID_1');

    expect(prisma.contactChannel.update).not.toHaveBeenCalled();
  });

  // Contrato central do enriquecimento: e enfeite, nunca pode derrubar a
  // entrega da mensagem. Cobre tanto erro de rede/Graph quanto erro de banco.
  it('nunca lanca quando o httpClient rejeita', async () => {
    httpClient.getUserProfile.mockRejectedValue(new Error('Graph indisponivel'));

    await expect(service.enrich(makeChannel(), 'PSID_1')).resolves.toBeUndefined();
  });

  it('nunca lanca quando o Prisma rejeita', async () => {
    httpClient.getUserProfile.mockResolvedValue({ first_name: 'Maria' });
    prisma.contactChannel.findUnique.mockRejectedValue(new Error('conexao caiu'));

    await expect(service.enrich(makeChannel(), 'PSID_1')).resolves.toBeUndefined();
  });
});
