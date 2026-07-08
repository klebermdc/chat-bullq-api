import { MediaResolverService } from './media-resolver.service';

/**
 * Regressão: mídia inbound de canais Baileys (Zappfy/Uazapi, WasenderAPI) chega
 * com `content.mediaUrl` = URL criptografada `.enc` em mmg.whatsapp.net, que o
 * navegador não consegue exibir. O resolver dava curto-circuito em QUALQUER
 * mediaUrl truthy e devolvia a URL `.enc` crua — imagem/sticker nunca abriam.
 */
function makeService(opts: {
  content: Record<string, any>;
  externalId?: string | null;
  channelType?: string;
  resolveInbound?: jest.Mock;
}) {
  const message = {
    id: 'msg1',
    externalId: opts.externalId === undefined ? 'ext1' : opts.externalId,
    content: opts.content,
    conversation: {
      organizationId: 'org1',
      channelId: 'chan1',
      assignedToId: null,
      channel: { id: 'chan1', type: opts.channelType ?? 'ZAPPFY' },
    },
  };
  const prisma = {
    message: {
      findUnique: jest.fn().mockResolvedValue(message),
      update: jest.fn().mockResolvedValue(message),
    },
  } as any;
  const adapter = { resolveInboundMediaUrl: opts.resolveInbound };
  const adapterRegistry = { getOutbound: jest.fn().mockReturnValue(adapter) } as any;
  const svc = new MediaResolverService(prisma, adapterRegistry);
  return { svc, prisma, adapterRegistry, message };
}

describe('MediaResolverService.resolve', () => {
  it('descriptografa URL .enc do WhatsApp em vez de devolver a criptografada', async () => {
    const resolveInbound = jest
      .fn()
      .mockResolvedValue({ fileUrl: 'https://cdn.app/decrypted.webp', mimeType: 'image/webp' });
    const { svc, prisma } = makeService({
      content: {
        mediaUrl: 'https://mmg.whatsapp.net/v/t62.7118-24/abc.enc?ccb=11-4',
        mimeType: 'image/webp',
      },
      resolveInbound,
    });

    const result = await svc.resolve('msg1', 'org1');

    expect(resolveInbound).toHaveBeenCalledTimes(1);
    expect(result.url).toBe('https://cdn.app/decrypted.webp');
    // e cacheia a URL tocável de volta na mensagem
    expect(prisma.message.update).toHaveBeenCalledTimes(1);
  });

  it('devolve direto uma mediaUrl já tocável (nosso upload) sem re-resolver', async () => {
    const resolveInbound = jest.fn();
    const { svc } = makeService({
      content: { mediaUrl: '/api/v1/uploads/2026/07/foto.jpg', mimeType: 'image/jpeg' },
      resolveInbound,
    });

    const result = await svc.resolve('msg1', 'org1');

    expect(resolveInbound).not.toHaveBeenCalled();
    expect(result.url).toBe('/api/v1/uploads/2026/07/foto.jpg');
  });
});
