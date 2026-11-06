import { buildPushPayload, PUSH_TITLE_MAX } from './push-payload';
import { PushIntent } from './push.types';

describe('buildPushPayload', () => {
  const base: PushIntent = { kind: 'message', contactName: 'Maria Silva', conversationId: 'c1' };

  it('título é o nome do cliente, corpo é frase fixa do tipo', () => {
    expect(buildPushPayload(base)).toEqual({
      title: 'Maria Silva',
      body: 'mandou mensagem',
      tag: 'conv:c1',
      href: '/inbox?conversationId=c1',
    });
  });

  it.each([
    ['handoff', 'foi passado para você'],
    ['seller_note', 'tem recado do plantão para você'],
    ['support_ticket', 'abriu chamado de suporte'],
  ] as const)('corpo de %s', (kind, body) => {
    expect(buildPushPayload({ ...base, kind }).body).toBe(body);
  });

  it('mesma tag para tipos diferentes da mesma conversa (um aviso só)', () => {
    expect(buildPushPayload({ ...base, kind: 'handoff' }).tag).toBe(buildPushPayload(base).tag);
  });

  it('nunca carrega campo extra do produtor (ex.: prévia do texto)', () => {
    const intent = { ...base, preview: 'meu cartão é 1234' } as unknown as PushIntent;
    const payload = buildPushPayload(intent);
    expect(Object.keys(payload).sort()).toEqual(['body', 'href', 'tag', 'title']);
    expect(JSON.stringify(payload)).not.toContain('1234');
  });

  it('nome vazio vira "Cliente"; nome longo é cortado', () => {
    expect(buildPushPayload({ ...base, contactName: '   ' }).title).toBe('Cliente');
    const long = buildPushPayload({ ...base, contactName: 'x'.repeat(200) }).title;
    expect(long.length).toBe(PUSH_TITLE_MAX);
    expect(long.endsWith('…')).toBe(true);
  });

  it('id da conversa é codificado no link', () => {
    expect(buildPushPayload({ ...base, conversationId: 'a&b' }).href).toBe('/inbox?conversationId=a%26b');
  });
});
