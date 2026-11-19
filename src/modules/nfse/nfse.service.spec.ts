import { Prisma } from '@prisma/client';
import { NfseService } from './nfse.service';
import { NfseDeliveryError } from './nfse-whatsapp-sender.service';
import { downloadNfsePdf } from './nfse-pdf-downloader';
import { NfseUndeliveredError } from './nfse-delivery-watcher';

jest.mock('./nfse-pdf-downloader', () => {
  const actual = jest.requireActual('./nfse-pdf-downloader');
  return { ...actual, downloadNfsePdf: jest.fn() };
});

const PAYLOAD = {
  envioId: '3f2b8c1e-5d4a-4f6b-9c2d-1a2b3c4d5e6f',
  telefone: '5511988887777',
  nome: 'Maria Souza',
  numeroNfse: '12',
  valor: 1800.48,
  pdfUrl: 'https://hub.example.com/12.pdf',
  pdfNome: 'NFS-e 12.pdf',
};
const CHANNEL = { id: 'ch1', organizationId: 'org1', type: 'WHATSAPP_OFFICIAL', isActive: true };
const HOUR = 60 * 60 * 1000;

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
}

function setup(opts: {
  lastInboundAt?: Date | null;
  template?: { name: string; language: string } | null;
  isNew?: boolean;
  createError?: unknown;
  retryCount?: number;
  sendError?: Error;
  existing?: { status: string; mode: string | null } | null;
  previousAssigneeId?: string | null;
  wasReopened?: boolean;
  watchError?: Error;
  delivered?: boolean;
  earlierMessages?: Array<{ status: string; failedReason: string | null }>;
} = {}) {
  const prisma = {
    nfseDispatch: {
      create: jest.fn(opts.createError ? () => Promise.reject(opts.createError) : () => Promise.resolve({})),
      updateMany: jest.fn().mockResolvedValue({ count: opts.retryCount ?? 0 }),
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(opts.existing ?? { status: 'SENT', mode: 'template' }),
    },
    channel: { findFirst: jest.fn().mockResolvedValue(CHANNEL) },
    conversation: {
      findUnique: jest.fn().mockResolvedValue({ lastInboundAt: opts.lastInboundAt ?? null }),
      update: jest.fn().mockResolvedValue({ id: 'conv1' }),
    },
    messageTemplate: { findFirst: jest.fn().mockResolvedValue(opts.template ?? null) },
    conversationAuditLog: { create: jest.fn().mockResolvedValue({}) },
    message: { findMany: jest.fn().mockResolvedValue(opts.earlierMessages ?? []) },
  };
  const watcher = {
    waitOutcome: jest.fn(opts.watchError
      ? () => Promise.reject(opts.watchError)
      : () => Promise.resolve(opts.delivered ?? true)),
  };
  const sender: { send: jest.Mock<any, any> } = {
    send: jest.fn(opts.sendError
      ? () => Promise.reject(opts.sendError)
      : () => Promise.resolve({ messageId: 'msg1', externalId: 'wamid.1' })),
  };
  const service = new NfseService(
    prisma as any,
    { get: () => 'ch1' } as any,
    { saveMedia: jest.fn().mockResolvedValue({ url: 'https://api/x.pdf' }) } as any,
    {
      resolveContact: jest.fn().mockResolvedValue({ contactId: 'c1', externalId: '5511988887777' }),
      toExternalId: (_t: string, phone: string) => phone,
    } as any,
    {
      resolve: jest.fn().mockResolvedValue({
        conversationId: 'conv1',
        isNew: opts.isNew ?? false,
        wasReopened: opts.wasReopened ?? false,
        previousAssigneeId: opts.previousAssigneeId ?? null,
      }),
    } as any,
    sender as any,
    { emitToChannel: jest.fn() } as any,
    watcher as any,
  );
  return { service, prisma, sender, watcher };
}

beforeEach(() => {
  (downloadNfsePdf as jest.Mock).mockReset().mockResolvedValue(Buffer.from('%PDF-1.4'));
});

describe('NfseService.enviar', () => {
  it('sends the text and the pdf when the 24h window is open', async () => {
    const { service, sender, prisma } = setup({ lastInboundAt: new Date(Date.now() - HOUR) });

    const result = await service.enviar(PAYLOAD);

    expect(result).toEqual({ status: 200, body: { ok: true, messageId: 'wamid.1', entregue: true } });
    expect(sender.send.mock.calls.map((c) => c[0].type)).toEqual(['TEXT', 'DOCUMENT']);
    expect(sender.send.mock.calls[1][0].content).toEqual({
      mediaUrl: 'https://api/x.pdf',
      fileName: 'NFS-e 12.pdf',
      mimeType: 'application/pdf',
    });
    expect(prisma.nfseDispatch.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SENT', mode: 'text_and_document' }) }),
    );
  });

  it('uses the approved template when the window is closed', async () => {
    const { service, sender } = setup({
      lastInboundAt: new Date(Date.now() - 30 * HOUR),
      template: { name: 'nfse_guiamento', language: 'pt_BR' },
    });

    const result = await service.enviar(PAYLOAD);

    expect(result.status).toBe(200);
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(sender.send.mock.calls[0][0].type).toBe('TEMPLATE');
    expect(sender.send.mock.calls[0][0].content.name).toBe('nfse_guiamento');
  });

  it('answers 422 when the window is closed and the template is not approved', async () => {
    const { service, sender, prisma } = setup({ lastInboundAt: null, template: null });

    const result = await service.enviar(PAYLOAD);

    expect(result.status).toBe(422);
    expect(sender.send).not.toHaveBeenCalled();
    expect(prisma.nfseDispatch.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
  });

  it('answers 422 with the WhatsApp reason when the send is refused', async () => {
    const { service } = setup({
      lastInboundAt: new Date(),
      sendError: new NfseDeliveryError('[131026] Message undeliverable'),
    });

    const result = await service.enviar(PAYLOAD);

    expect(result).toEqual({ status: 422, body: { ok: false, erro: '[131026] Message undeliverable' } });
  });

  it('does not send again when the envioId was already sent', async () => {
    const { service, sender } = setup({ createError: p2002(), retryCount: 0 });

    const result = await service.enviar(PAYLOAD);

    expect(result).toEqual({ status: 200, body: { ok: true, duplicado: true } });
    expect(sender.send).not.toHaveBeenCalled();
    expect(downloadNfsePdf).not.toHaveBeenCalled();
  });

  it('tries again when the previous attempt with the same envioId failed', async () => {
    const { service, sender } = setup({ createError: p2002(), retryCount: 1, lastInboundAt: new Date() });

    const result = await service.enviar(PAYLOAD);

    expect(result.status).toBe(200);
    expect(sender.send).toHaveBeenCalled();
  });

  it('closes a conversation that was opened only for the invoice', async () => {
    const { service, prisma } = setup({ isNew: true, template: { name: 'nfse_guiamento', language: 'pt_BR' } });

    await service.enviar(PAYLOAD);

    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CLOSED' }) }),
    );
  });

  it('leaves an ongoing conversation open', async () => {
    const { service, prisma } = setup({ isNew: false, lastInboundAt: new Date() });

    await service.enviar(PAYLOAD);

    expect(prisma.conversation.update.mock.calls[0][0].data.status).toBeUndefined();
  });

  it('marks FAILED and rethrows an unexpected error', async () => {
    const { service, prisma } = setup();
    prisma.channel.findFirst.mockRejectedValue(new Error('db down'));

    await expect(service.enviar(PAYLOAD)).rejects.toThrow('db down');
    expect(prisma.nfseDispatch.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
  });
  it('answers 409 while another call is sending the same envioId', async () => {
    const { service, sender } = setup({ createError: p2002(), retryCount: 0, existing: { status: 'SENDING', mode: null } });

    const result = await service.enviar(PAYLOAD);

    expect(result.status).toBe(409);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('sends only the pdf on a retry when the text already went out', async () => {
    const { service, sender } = setup({
      createError: p2002(),
      retryCount: 1,
      existing: { status: 'SENDING', mode: 'text_sent' },
      lastInboundAt: new Date(),
    });

    await service.enviar(PAYLOAD);

    expect(sender.send.mock.calls.map((c) => c[0].type)).toEqual(['DOCUMENT']);
  });

  it('still answers ok when the send worked but recording it failed', async () => {
    const { service, prisma } = setup({ lastInboundAt: new Date() });
    prisma.nfseDispatch.update.mockImplementation((args: any) =>
      args.data.status === 'SENT' ? Promise.reject(new Error('db blip')) : Promise.resolve({}),
    );

    const result = await service.enviar(PAYLOAD);

    expect(result).toEqual({ status: 200, body: { ok: true, messageId: 'wamid.1', entregue: true } });
  });

  it('gives the conversation back to its previous owner when closing it again', async () => {
    const { service, prisma } = setup({
      wasReopened: true,
      previousAssigneeId: 'seller1',
      template: { name: 'nfse_guiamento', language: 'pt_BR' },
    });

    await service.enviar(PAYLOAD);

    expect(prisma.conversation.update.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ status: 'CLOSED', assignedToId: 'seller1' }),
    );
  });

  it('answers 422 when WhatsApp accepts the message and then reports it undeliverable', async () => {
    const { service, prisma } = setup({
      template: { name: 'nfse_guiamento', language: 'pt_BR' },
      watchError: new NfseUndeliveredError('Número sem WhatsApp ([131026] Message undeliverable).'),
    });

    const result = await service.enviar(PAYLOAD);

    expect(result).toEqual({
      status: 422,
      body: { ok: false, erro: 'Número sem WhatsApp ([131026] Message undeliverable).' },
    });
    expect(prisma.nfseDispatch.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', mode: null }) }),
    );
    expect(prisma.nfseDispatch.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SENT' }) }),
    );
  });

  it('answers ok with entregue:false when WhatsApp did not confirm in time', async () => {
    const { service } = setup({ template: { name: 'nfse_guiamento', language: 'pt_BR' }, delivered: false });

    const result = await service.enviar(PAYLOAD);

    expect(result).toEqual({ status: 200, body: { ok: true, messageId: 'wamid.1', entregue: false } });
  });

  it('sends again when the earlier "sent" envioId came back undelivered from WhatsApp', async () => {
    const { service, sender, prisma } = setup({
      createError: p2002(),
      retryCount: 1,
      existing: { status: 'SENT', mode: 'template', messageId: 'old', conversationId: 'conv1' } as any,
      earlierMessages: [{ status: 'FAILED', failedReason: '[131026] Message undeliverable' }],
      template: { name: 'nfse_guiamento', language: 'pt_BR' },
    });

    const result = await service.enviar(PAYLOAD);

    expect(prisma.nfseDispatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'SENT' }),
        data: expect.objectContaining({ status: 'FAILED', mode: null }),
      }),
    );
    expect(result.status).toBe(200);
    expect(sender.send).toHaveBeenCalled();
  });

  it('answers duplicado only when the earlier send was not reported as failed', async () => {
    const { service, sender } = setup({
      createError: p2002(),
      retryCount: 0,
      existing: { status: 'SENT', mode: 'template', messageId: 'old', conversationId: 'conv1' } as any,
      earlierMessages: [{ status: 'DELIVERED', failedReason: null }],
    });

    const result = await service.enviar(PAYLOAD);

    expect(result).toEqual({ status: 200, body: { ok: true, duplicado: true } });
    expect(sender.send).not.toHaveBeenCalled();
  });
});
