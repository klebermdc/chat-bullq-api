import { ErrorSource } from '@prisma/client';
import {
  buildFingerprint,
  normalizeMessage,
  topProjectFrame,
} from './error-fingerprint.util';

describe('normalizeMessage', () => {
  it('remove uuid, cuid, telefone, email e numero longo', () => {
    const msg =
      'Falha na conversa cm3x9k2p0000abcd1234efghi para +5511998887766 (a@b.com.br) pedido 987654 uuid 3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    expect(normalizeMessage(msg)).toBe(
      'falha na conversa <id> para <phone> (<email>) pedido <n> uuid <id>',
    );
  });

  it('remove query string mas preserva host e path', () => {
    expect(
      normalizeMessage(
        'GET https://graph.facebook.com/v21.0/messages?access_token=xyz falhou',
      ),
    ).toBe('get https://graph.facebook.com/v21.0/messages falhou');
  });

  it('colapsa espaco e faz trim', () => {
    expect(normalizeMessage('  erro    generico  ')).toBe('erro generico');
  });
});

describe('topProjectFrame', () => {
  it('devolve o primeiro frame do projeto, ignorando node_modules', () => {
    const stack = [
      'Error: boom',
      '    at Object.<anonymous> (/app/node_modules/axios/lib/core.js:10:5)',
      '    at ChannelsService.resolve (/app/src/modules/channel-hub/channels/channels.service.ts:42:11)',
      '    at process (/app/src/main.ts:9:1)',
    ].join('\n');
    expect(topProjectFrame(stack)).toBe(
      'src/modules/channel-hub/channels/channels.service.ts',
    );
  });

  it('devolve null quando nao ha stack', () => {
    expect(topProjectFrame(undefined)).toBeNull();
  });

  it('devolve null quando o stack so tem node_modules', () => {
    const stack = 'Error: boom\n    at x (/app/node_modules/pg/index.js:1:1)';
    expect(topProjectFrame(stack)).toBeNull();
  });
});

describe('buildFingerprint', () => {
  const base = {
    source: ErrorSource.CHANNEL,
    code: 'WEBHOOK_REJECTED',
    message: 'Assinatura invalida para canal cm3x9k2p0000abcd1234efghi',
    stack: 'Error: x\n    at C.f (/app/src/modules/channel-hub/a.ts:1:1)',
  };

  it('agrupa dois erros iguais com ids e telefones diferentes', () => {
    const a = buildFingerprint(base);
    const b = buildFingerprint({
      ...base,
      message: 'Assinatura invalida para canal cm9z9k2p0000zzzz9999wwwwi',
    });
    expect(a).toBe(b);
  });

  it('separa dois erros com a mesma mensagem mas origem diferente', () => {
    const a = buildFingerprint(base);
    const b = buildFingerprint({
      ...base,
      stack: 'Error: x\n    at C.f (/app/src/modules/messaging/b.ts:1:1)',
    });
    expect(a).not.toBe(b);
  });

  it('separa dois erros com codes diferentes', () => {
    expect(buildFingerprint(base)).not.toBe(
      buildFingerprint({ ...base, code: 'WEBHOOK_UNROUTED' }),
    );
  });

  it('e estavel sem stack (falha de negocio)', () => {
    const semStack = { ...base, stack: undefined };
    expect(buildFingerprint(semStack)).toBe(buildFingerprint(semStack));
  });

  it('devolve 32 caracteres hex', () => {
    expect(buildFingerprint(base)).toMatch(/^[0-9a-f]{32}$/);
  });
});
