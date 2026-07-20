import { BadRequestException } from '@nestjs/common';
import { MessageTemplatesService } from './message-templates.service';

const channel = {
  id: 'ch1',
  type: 'WHATSAPP_OFFICIAL',
  config: { businessAccountId: 'WABA1' },
};

const build = () => {
  const repo = {
    create: jest.fn().mockResolvedValue({ id: 't1', name: 'promo', status: 'DRAFT' }),
    findById: jest.fn().mockResolvedValue({
      id: 't1',
      channelId: 'ch1',
      name: 'promo',
      category: 'MARKETING',
      language: 'pt_BR',
      status: 'DRAFT',
      components: { body: { text: 'Olá {{1}}' } },
      variableExamples: { '1': 'Ana' },
    }),
    update: jest.fn().mockResolvedValue({ id: 't1', status: 'PENDING' }),
    findManyByChannel: jest.fn().mockResolvedValue([]),
    updateByMetaId: jest.fn().mockResolvedValue({ count: 1 }),
    delete: jest.fn().mockResolvedValue({ id: 't1' }),
  };
  const http = {
    createTemplate: jest
      .fn()
      .mockResolvedValue({ id: 'META1', status: 'PENDING', category: 'MARKETING' }),
    listTemplates: jest.fn().mockResolvedValue([]),
    deleteTemplate: jest.fn().mockResolvedValue(undefined),
  };
  // ChannelsService real: findOne(channelId, organizationId) — retorna o canal ou lança.
  const channels = { findOne: jest.fn().mockResolvedValue(channel) };
  const service = new MessageTemplatesService(
    repo as any,
    http as any,
    channels as any,
  );
  return { repo, http, channels, service };
};

describe('MessageTemplatesService', () => {
  it('create rejeita nome inválido', async () => {
    const { service } = build();
    await expect(
      service.create('org1', 'ch1', {
        name: 'Nome Ruim',
        category: 'MARKETING',
        components: { body: { text: 'oi' } },
      } as any),
    ).rejects.toThrow();
  });

  it('create salva DRAFT com nome válido', async () => {
    const { repo, service } = build();
    await service.create('org1', 'ch1', {
      name: 'promo',
      category: 'MARKETING',
      components: { body: { text: 'oi' } },
    } as any);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'promo',
        status: 'DRAFT',
        channelId: 'ch1',
        organizationId: 'org1',
      }),
    );
  });

  it('submit envia à Meta e marca PENDING com metaTemplateId', async () => {
    const { repo, http, service } = build();
    await service.submit('org1', 't1');
    expect(http.createTemplate).toHaveBeenCalledWith(
      channel,
      expect.objectContaining({ name: 'promo', category: 'MARKETING' }),
    );
    expect(repo.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ status: 'PENDING', metaTemplateId: 'META1' }),
    );
  });

  it('create traduz nome duplicado (P2002) em erro legível, não 500', async () => {
    const { repo, service } = build();
    repo.create.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    await expect(
      service.create('org1', 'ch1', {
        name: 'promo',
        category: 'MARKETING',
        components: { body: { text: 'oi' } },
      } as any),
    ).rejects.toMatchObject({
      status: 409,
      response: { message: expect.stringContaining('promo') },
    });
  });

  it('submit propaga o erro da Meta (BadRequest), não deixa virar 500', async () => {
    const { http, service } = build();
    http.createTemplate.mockRejectedValueOnce(
      new BadRequestException('Meta recusou a operação: categoria inválida'),
    );
    await expect(service.submit('org1', 't1')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('applyStatusUpdate atualiza por metaTemplateId', async () => {
    const { repo, service } = build();
    await service.applyStatusUpdate('META1', 'APPROVED');
    expect(repo.updateByMetaId).toHaveBeenCalledWith(
      'META1',
      expect.objectContaining({ status: 'APPROVED' }),
    );
  });
});
