import { pickEchoReconcileTarget, echoContentSignature } from './echo-reconcile';

describe('echoContentSignature', () => {
  it('TEXT: usa o texto (trim)', () => {
    expect(echoContentSignature('TEXT', { text: '  oi  ' })).toBe('TEXT:oi');
  });

  it('mídia: usa tipo + caption, ignorando mediaUrl (echo traz .enc diferente)', () => {
    const placeholder = echoContentSignature('IMAGE', {
      mediaUrl: 'https://our-cdn/local.jpg',
      caption: 'olha isso',
    });
    const echo = echoContentSignature('IMAGE', {
      mediaUrl: 'https://wa/encrypted.enc',
      caption: 'olha isso',
    });
    expect(placeholder).toBe(echo);
  });
});

describe('pickEchoReconcileTarget', () => {
  const t0 = 1_700_000_000_000;
  const row = (over: Partial<any>) => ({
    id: 'r',
    externalId: 'msgid',
    createdAt: new Date(t0),
    type: 'TEXT',
    content: { text: 'oi' },
    metadata: {},
    ...over,
  });

  it('casa um placeholder de texto idêntico dentro da janela', () => {
    const echo = { type: 'TEXT', content: { text: 'oi' }, externalId: 'WAKEY1' };
    const target = pickEchoReconcileTarget(echo, [row({ id: 'p1' })], {
      nowMs: t0 + 1000,
    });
    expect(target?.id).toBe('p1');
  });

  it('não casa quando o texto difere', () => {
    const echo = { type: 'TEXT', content: { text: 'tchau' }, externalId: 'WAKEY1' };
    const target = pickEchoReconcileTarget(echo, [row({ id: 'p1' })], {
      nowMs: t0 + 1000,
    });
    expect(target).toBeNull();
  });

  it('não casa placeholder fora da janela de tempo', () => {
    const echo = { type: 'TEXT', content: { text: 'oi' }, externalId: 'WAKEY1' };
    const target = pickEchoReconcileTarget(
      echo,
      [row({ id: 'p1', createdAt: new Date(t0) })],
      { nowMs: t0 + 10 * 60 * 1000, windowMs: 5 * 60 * 1000 },
    );
    expect(target).toBeNull();
  });

  it('FIFO: casa o placeholder mais antigo primeiro (sends idênticos repetidos)', () => {
    const echo = { type: 'TEXT', content: { text: 'oi' }, externalId: 'WAKEY1' };
    const target = pickEchoReconcileTarget(
      echo,
      [
        row({ id: 'p2', createdAt: new Date(t0 + 2000) }),
        row({ id: 'p1', createdAt: new Date(t0 + 1000) }),
      ],
      { nowMs: t0 + 3000 },
    );
    expect(target?.id).toBe('p1');
  });

  it('pula placeholders já reconciliados (metadata.echoReconciled)', () => {
    const echo = { type: 'TEXT', content: { text: 'oi' }, externalId: 'WAKEY2' };
    const target = pickEchoReconcileTarget(
      echo,
      [
        row({ id: 'p1', createdAt: new Date(t0 + 1000), metadata: { echoReconciled: true } }),
        row({ id: 'p2', createdAt: new Date(t0 + 2000) }),
      ],
      { nowMs: t0 + 3000 },
    );
    expect(target?.id).toBe('p2');
  });

  it('mídia: casa por tipo+caption apesar do mediaUrl diferente', () => {
    const echo = {
      type: 'IMAGE',
      content: { mediaUrl: 'https://wa/enc.enc', caption: 'foto' },
      externalId: 'WAKEY1',
    };
    const target = pickEchoReconcileTarget(
      echo,
      [
        row({
          id: 'p1',
          type: 'IMAGE',
          content: { mediaUrl: 'https://our-cdn/local.jpg', caption: 'foto' },
        }),
      ],
      { nowMs: t0 + 1000 },
    );
    expect(target?.id).toBe('p1');
  });
});
