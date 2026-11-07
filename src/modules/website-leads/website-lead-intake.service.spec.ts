import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { WebsiteLeadIntakeService } from './website-lead-intake.service';

const NOW = new Date('2026-11-07T15:00:00.000Z');
const BODY = {
  form: { id: 'e79d2c0', name: 'form_agendamento' },
  fields: {
    nome: { value: 'Maria Teste' },
    email: { value: 'maria@exemplo.com' },
    whatsapp: { value: '(11) 98888-7777' },
    fbclid: { value: 'IwAR-teste' },
  },
  meta: { page_url: { value: 'https://orlandofastpass.com.br/?utm_source=ig&utm_campaign=111' } },
};

function make(opts: { config?: any; existingContact?: any; viaChannel?: any; duplicate?: any } = {}) {
  const config =
    opts.config === undefined
      ? { organizationId: 'org-1', enabled: true, channelId: 'ch-5198', templateId: 'tpl-1', delayMinutes: 5 }
      : opts.config;
  const prisma = {
    leadSubmission: {
      findFirst: jest.fn().mockResolvedValue(opts.duplicate ?? null),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'sub-1', ...data })),
    },
    contactChannel: { findFirst: jest.fn().mockResolvedValue(opts.viaChannel ?? null) },
    contact: {
      findFirst: jest.fn().mockResolvedValue(opts.existingContact ?? null),
      create: jest.fn().mockResolvedValue({ id: 'contact-new' }),
      update: jest.fn().mockResolvedValue({}),
    },
    tag: {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation(({ create }: any) => Promise.resolve({ id: `tag-${create.name}` })),
    },
    contactTag: { upsert: jest.fn().mockResolvedValue({}) },
  } as any;
  const settings = { findByToken: jest.fn().mockResolvedValue(config) } as any;
  const idempotency = { withLock: jest.fn().mockImplementation((_k: string, fn: any) => fn()) } as any;
  const leadCard = { ensureContactLeadCard: jest.fn().mockResolvedValue('card-1') } as any;
  const queue = { add: jest.fn().mockResolvedValue({}) } as any;
  return {
    service: new WebsiteLeadIntakeService(prisma, settings, idempotency, leadCard, queue),
    prisma,
    leadCard,
    queue,
  };
}

describe('WebsiteLeadIntakeService.ingest', () => {
  it('token desconhecido → 401', async () => {
    const { service } = make({ config: null });
    await expect(service.ingest({ token: 'x', body: BODY }, NOW)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('sem telefone válido → 400', async () => {
    const { service } = make();
    await expect(
      service.ingest({ token: 't', body: { fields: { nome: { value: 'A' }, whatsapp: { value: '123' } } } }, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('spam é descartado sem gravar nada', async () => {
    const { service, prisma } = make();
    const res = await service.ingest(
      { token: 't', body: { Nome: 'promo http://spam.ru', Whatsapp: '11988887777' } },
      NOW,
    );
    expect(res).toEqual({ accepted: false, reason: 'spam' });
    expect(prisma.leadSubmission.create).not.toHaveBeenCalled();
  });

  it('lead novo: cria contato com atribuição, histórico, etiqueta Site, card e agenda o retorno', async () => {
    const { service, prisma, leadCard, queue } = make();

    const res = await service.ingest({ token: 't', body: BODY }, NOW);

    expect(res).toEqual({ accepted: true, duplicate: false, submissionId: 'sub-1', followup: 'scheduled' });
    expect(prisma.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        phone: '5511988887777',
        name: 'Maria Teste',
        email: 'maria@exemplo.com',
        metadata: {
          attribution: expect.objectContaining({
            utm_source: 'ig',
            utm_campaign: '111',
            fbclid: 'IwAR-teste',
            form_id: 'e79d2c0',
            form_kind: 'main',
            submitted_at: NOW.toISOString(),
          }),
        },
      }),
      select: { id: true },
    });
    expect(prisma.leadSubmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contactId: 'contact-new',
        formKind: 'main',
        phone: '5511988887777',
        followupStatus: 'PENDING',
        followupScheduledAt: new Date(NOW.getTime() + 5 * 60_000),
      }),
    });
    expect(prisma.tag.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { organizationId: 'org-1', name: 'Site' } }));
    expect(leadCard.ensureContactLeadCard).toHaveBeenCalledWith({ organizationId: 'org-1', contactId: 'contact-new' });
    expect(queue.add).toHaveBeenCalledWith(
      'send-followup',
      { submissionId: 'sub-1' },
      expect.objectContaining({ delay: 5 * 60_000, jobId: 'lead-site-sub-1' }),
    );
  });

  it('não duplica contato da Umbler: acha pelo telefone sem o 9 e só acrescenta a atribuição', async () => {
    const { service, prisma } = make({
      existingContact: { id: 'umbler-1', name: 'Maria (Umbler)', email: null, metadata: { umbler: { id: 9 } } },
    });

    await service.ingest({ token: 't', body: BODY }, NOW);

    expect(prisma.contact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1', phone: { in: ['5511988887777', '551188887777'] }, deletedAt: null },
      }),
    );
    expect(prisma.contact.create).not.toHaveBeenCalled();
    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: 'umbler-1' },
      data: {
        email: 'maria@exemplo.com',
        metadata: { umbler: { id: 9 }, attribution: expect.objectContaining({ utm_source: 'ig' }) },
      },
    });
  });

  it('prefere o contato já ligado ao canal do WhatsApp', async () => {
    const { service, prisma } = make({
      viaChannel: { contactId: 'wa-1' },
      existingContact: { id: 'wa-1', name: 'M', email: 'x@y.com', metadata: {} },
    });
    await service.ingest({ token: 't', body: BODY }, NOW);
    expect(prisma.contact.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'wa-1' } }));
  });

  it('envio repetido em seguida devolve o mesmo registro, sem gravar nem agendar de novo', async () => {
    const { service, prisma, queue } = make({ duplicate: { id: 'sub-0', followupStatus: 'PENDING' } });
    const res = await service.ingest({ token: 't', body: BODY }, NOW);
    expect(res).toEqual({ accepted: true, duplicate: true, submissionId: 'sub-0', followup: 'scheduled' });
    expect(prisma.leadSubmission.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('formulário do guiamento ganha também a etiqueta Guiamento', async () => {
    const { service, prisma } = make();
    await service.ingest({ token: 't', body: BODY, formOverride: 'guiamento' }, NOW);
    const names = prisma.tag.upsert.mock.calls.map((c: any) => c[0].create.name);
    expect(names).toEqual(['Site', 'Guiamento']);
  });

  it('com o retorno desligado grava o lead mas não agenda', async () => {
    const { service, prisma, queue } = make({
      config: { organizationId: 'org-1', enabled: false, channelId: null, templateId: null, delayMinutes: 5 },
    });
    const res = await service.ingest({ token: 't', body: BODY }, NOW);
    expect(res).toMatchObject({ accepted: true, followup: 'off' });
    expect(prisma.leadSubmission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ followupStatus: 'SKIPPED', followupReason: 'disabled' }),
    });
    expect(queue.add).not.toHaveBeenCalled();
  });
});
