import { buildTranscriptHtml, escapeHtml, type TranscriptInput } from './transcript-html';

const baseInput = (over: Partial<TranscriptInput> = {}): TranscriptInput => ({
  contact: { name: 'Bruna Raffaelli', phone: '556699037559' },
  generatedBy: 'Bárbara',
  generatedAt: new Date('2026-08-11T18:00:00Z'),
  conversations: {
    'conv-1': {
      protocol: '20260801-PRLU78',
      channelName: 'Orlando Fast Pass - Comercial',
      startedAt: new Date('2026-08-01T15:27:43Z'),
    },
  },
  messages: [],
  omittedByLimit: 0,
  hiddenByChannelAccess: 0,
  ...over,
});

const message = (over: Partial<TranscriptInput['messages'][0]> = {}) => ({
  id: 'm1',
  conversationId: 'conv-1',
  direction: 'INBOUND' as const,
  type: 'TEXT',
  content: { text: 'Oi' },
  senderName: null,
  sender: null,
  createdAt: new Date('2026-08-01T15:27:43Z'),
  ...over,
});

describe('escapeHtml', () => {
  it('neutraliza markup vindo da mensagem do cliente', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('escapa aspas e e-comercial', () => {
    expect(escapeHtml(`a & "b" 'c'`)).toBe('a &amp; &quot;b&quot; &#39;c&#39;');
  });
});

describe('buildTranscriptHtml', () => {
  it('não deixa markup do cliente virar HTML no documento', () => {
    const html = buildTranscriptHtml(
      baseInput({ messages: [message({ content: { text: '<img src=x onerror=alert(1)>' } })] }),
    );

    expect(html).not.toContain('onerror=alert(1)>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('identifica o cliente e o atendente como autores', () => {
    const html = buildTranscriptHtml(
      baseInput({
        messages: [
          message({ id: 'a', direction: 'INBOUND', content: { text: 'Oi' } }),
          message({
            id: 'b',
            direction: 'OUTBOUND',
            content: { text: 'Olá!' },
            sender: { name: 'Bárbara' },
          }),
        ],
      }),
    );

    expect(html).toContain('Bruna Raffaelli');
    expect(html).toContain('Bárbara');
  });

  it('embute imagem e identifica áudio e documento', () => {
    const html = buildTranscriptHtml(
      baseInput({
        messages: [
          message({ id: 'a', type: 'IMAGE', content: { mediaUrl: 'https://x/y.jpg' } }),
          message({ id: 'b', type: 'AUDIO', content: { mediaUrl: 'https://x/z.ogg' } }),
          message({
            id: 'c',
            type: 'DOCUMENT',
            content: { mediaUrl: 'https://x/v.pdf', fileName: 'voucher.pdf' },
          }),
        ],
      }),
    );

    expect(html).toContain('<img src="https://x/y.jpg"');
    expect(html).toContain('áudio');
    expect(html).toContain('voucher.pdf');
    // Áudio não vira <img> — não existe áudio em PDF.
    expect(html).not.toContain('<img src="https://x/z.ogg"');
  });

  it('abre uma divisória por atendimento com protocolo e canal', () => {
    const html = buildTranscriptHtml(baseInput({ messages: [message()] }));

    expect(html).toContain('20260801-PRLU78');
    expect(html).toContain('Orlando Fast Pass - Comercial');
  });

  it('avisa na capa quando mensagens foram cortadas pelo teto', () => {
    const html = buildTranscriptHtml(baseInput({ messages: [message()], omittedByLimit: 320 }));

    expect(html).toContain('320');
    expect(html.toLowerCase()).toContain('mais antigas');
  });

  it('avisa na capa quando atendimentos ficaram fora por permissão de canal', () => {
    const html = buildTranscriptHtml(
      baseInput({ messages: [message()], hiddenByChannelAccess: 2 }),
    );

    expect(html.toLowerCase()).toContain('canais sem acesso');
  });

  it('não promete histórico completo quando não está completo', () => {
    const completo = buildTranscriptHtml(baseInput({ messages: [message()] }));
    expect(completo.toLowerCase()).not.toContain('canais sem acesso');
    expect(completo.toLowerCase()).not.toContain('mais antigas');
  });

  it('registra quem gerou o documento', () => {
    const html = buildTranscriptHtml(baseInput({ messages: [message()] }));
    expect(html).toContain('Bárbara');
  });
});
