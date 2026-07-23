import { BadRequestException } from '@nestjs/common';
import { AgentsService } from './agents.service';

describe('AgentsService.create — voiceProfile', () => {
  function make() {
    const prisma = {
      aiAgent: { create: jest.fn().mockResolvedValue({ id: 'a1' }) },
      channel: { findMany: jest.fn().mockResolvedValue([]) },
      aiAgentChannel: { createMany: jest.fn() },
    } as any;
    return { svc: new AgentsService(prisma), prisma };
  }

  const baseDto = {
    name: 'Aline',
    modelId: 'sakana/fugu',
    systemPrompt: 'Você é uma consultora de viagens acolhedora.',
  };

  it('persiste voiceProfile quando informado', async () => {
    const { svc, prisma } = make();
    await svc.create('org1', { ...baseDto, voiceProfile: 'warm' } as any);
    expect(prisma.aiAgent.create.mock.calls[0][0].data).toMatchObject({
      voiceProfile: 'warm',
    });
  });

  it('grava voiceProfile null quando omitido (default consultivo)', async () => {
    const { svc, prisma } = make();
    await svc.create('org1', { ...baseDto } as any);
    expect(prisma.aiAgent.create.mock.calls[0][0].data.voiceProfile).toBeNull();
  });
});

describe('AgentsService.assignChannel — tagFilterId', () => {
  function make(opts: { tag?: any } = {}) {
    const prisma = {
      aiAgent: { findFirst: jest.fn().mockResolvedValue({ id: 'a1', channels: [] }) },
      channel: { findFirst: jest.fn().mockResolvedValue({ id: 'ch1' }) },
      tag: { findFirst: jest.fn().mockResolvedValue('tag' in opts ? opts.tag : { id: 'tag-g' }) },
      aiAgentChannel: { upsert: jest.fn().mockResolvedValue({ id: 'ac1' }) },
    } as any;
    return { svc: new AgentsService(prisma), prisma };
  }

  it('grava tagFilterId (validado na org) no create e no update do upsert', async () => {
    const { svc, prisma } = make();
    await svc.assignChannel('org1', 'a1', {
      channelId: 'ch1',
      mode: 'SHADOW' as any,
      tagFilterId: 'tag-g',
    });
    expect(prisma.tag.findFirst).toHaveBeenCalledWith({
      where: { id: 'tag-g', organizationId: 'org1' },
      select: { id: true },
    });
    const arg = prisma.aiAgentChannel.upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({ mode: 'SHADOW', tagFilterId: 'tag-g' });
    expect(arg.update).toMatchObject({ mode: 'SHADOW', tagFilterId: 'tag-g' });
  });

  it('rejeita tagFilterId que não pertence à org', async () => {
    const { svc } = make({ tag: null });
    await expect(
      svc.assignChannel('org1', 'a1', { channelId: 'ch1', tagFilterId: 'nope' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('quando tagFilterId é omitido, não valida tag nem mexe no campo', async () => {
    const { svc, prisma } = make();
    await svc.assignChannel('org1', 'a1', { channelId: 'ch1', mode: 'AUTONOMOUS' as any });
    expect(prisma.tag.findFirst).not.toHaveBeenCalled();
    const arg = prisma.aiAgentChannel.upsert.mock.calls[0][0];
    expect('tagFilterId' in arg.update).toBe(false);
    expect(arg.create.tagFilterId).toBeNull();
  });
});
