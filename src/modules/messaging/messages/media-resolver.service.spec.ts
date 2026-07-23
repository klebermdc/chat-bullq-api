import { MediaResolverService } from './media-resolver.service';

/**
 * O resolver RE-HOSPEDA mídia inbound no NOSSO domínio em vez de entregar a URL
 * do provedor ao navegador. Motivo: mídia do WhatsApp via Uazapi/Wasender é
 * servida em `*.uazapi.com`, e filtros de segurança de rede (ex.: CUJO/ISP)
 * bloqueiam esse domínio no cliente — a imagem não carrega, mesmo a URL sendo
 * válida. Baixando os bytes server-side (fora do filtro) e servindo do nosso
 * domínio, nenhum cliente toca no domínio do provedor. Espelha o áudio.
 */
const OUR_URL =
  'https://api-ofpchat.example/api/v1/uploads/inbound/chan1/2026-07-10/abc.jpg';

function makeService(opts: {
  content: Record<string, any>;
  externalId?: string | null;
  channelType?: string;
  resolveInbound?: jest.Mock;
  downloadMedia?: jest.Mock;
  saveInboundMedia?: jest.Mock;
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
  const adapter = {
    resolveInboundMediaUrl: opts.resolveInbound,
    downloadMedia:
      opts.downloadMedia ?? jest.fn().mockResolvedValue(Buffer.from('IMGBYTES')),
  };
  const adapterRegistry = { getOutbound: jest.fn().mockReturnValue(adapter) } as any;
  const uploads = {
    saveInboundMedia:
      opts.saveInboundMedia ??
      jest.fn().mockResolvedValue({
        url: OUR_URL,
        mimeType: 'image/jpeg',
        size: 8,
        filename: 'abc.jpg',
      }),
  } as any;
  const svc = new MediaResolverService(prisma, adapterRegistry, uploads);
  return { svc, prisma, adapter, uploads, message };
}

describe('MediaResolverService.resolve — re-hospedagem', () => {
  it('re-hospeda URL do provedor (uazapi) no nosso domínio e cacheia', async () => {
    const { svc, adapter, uploads, prisma } = makeService({
      content: {
        mediaUrl: 'https://zappfy-v2.uazapi.com/files/x.jpg',
        mimeType: 'image/jpeg',
      },
    });

    const res = await svc.resolve('msg1', 'org1');

    expect(adapter.downloadMedia).toHaveBeenCalledWith(
      expect.anything(),
      'https://zappfy-v2.uazapi.com/files/x.jpg',
    );
    expect(uploads.saveInboundMedia).toHaveBeenCalledTimes(1);
    expect(res.url).toBe(OUR_URL);
    expect(res.url).not.toContain('uazapi');
    expect(prisma.message.update).toHaveBeenCalledTimes(1);
  });

  it('.enc → decrypt do provedor → re-hospeda no nosso domínio', async () => {
    const resolveInbound = jest.fn().mockResolvedValue({
      fileUrl: 'https://zappfy-v2.uazapi.com/files/dec.webp',
      mimeType: 'image/webp',
    });
    const { svc, adapter, uploads } = makeService({
      content: {
        mediaUrl: 'https://mmg.whatsapp.net/v/t62/x.enc?ccb=11-4',
        mimeType: 'image/webp',
      },
      resolveInbound,
    });

    const res = await svc.resolve('msg1', 'org1');

    expect(resolveInbound).toHaveBeenCalledTimes(1);
    expect(adapter.downloadMedia).toHaveBeenCalledWith(
      expect.anything(),
      'https://zappfy-v2.uazapi.com/files/dec.webp',
    );
    expect(uploads.saveInboundMedia).toHaveBeenCalledTimes(1);
    expect(res.url).toBe(OUR_URL);
  });

  it('upload já no nosso domínio passa direto (não baixa nem re-hospeda)', async () => {
    const { svc, adapter, uploads } = makeService({
      content: { mediaUrl: '/api/v1/uploads/2026/07/foto.jpg', mimeType: 'image/jpeg' },
    });

    const res = await svc.resolve('msg1', 'org1');

    expect(adapter.downloadMedia).not.toHaveBeenCalled();
    expect(uploads.saveInboundMedia).not.toHaveBeenCalled();
    expect(res.url).toBe('/api/v1/uploads/2026/07/foto.jpg');
  });

  it('fallback: se a re-hospedagem falhar, devolve a URL do provedor sem cachear', async () => {
    const downloadMedia = jest.fn().mockRejectedValue(new Error('boom'));
    const { svc, uploads, prisma } = makeService({
      content: {
        mediaUrl: 'https://zappfy-v2.uazapi.com/files/x.jpg',
        mimeType: 'image/jpeg',
      },
      downloadMedia,
    });

    const res = await svc.resolve('msg1', 'org1');

    expect(res.url).toBe('https://zappfy-v2.uazapi.com/files/x.jpg');
    expect(uploads.saveInboundMedia).not.toHaveBeenCalled();
    expect(prisma.message.update).not.toHaveBeenCalled();
  });
});
