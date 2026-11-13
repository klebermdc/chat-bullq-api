import { UnauthorizedException } from '@nestjs/common';
import { VoiceAuthGuard } from './voice-auth.guard';
import { signVoiceRequest } from './voice-signature.util';

function ctx(headers: Record<string, string>, body: string) {
  const req = { header: (h: string) => headers[h.toLowerCase()], rawBody: Buffer.from(body), ip: '127.0.0.1' };
  return { switchToHttp: () => ({ getRequest: () => req }) } as any;
}

describe('VoiceAuthGuard', () => {
  const body = '{"conversationId":"cv1"}';
  const ts = String(Math.floor(Date.now() / 1000));

  it('libera pedido assinado com o segredo configurado', () => {
    const guard = new VoiceAuthGuard({ get: () => 's3gr3d0' } as any);
    const sig = signVoiceRequest('s3gr3d0', ts, Buffer.from(body));
    expect(guard.canActivate(ctx({ 'x-voice-timestamp': ts, 'x-voice-signature': sig }, body))).toBe(true);
  });

  it('barra assinatura errada e barra tudo se o segredo não estiver configurado', () => {
    const sig = signVoiceRequest('s3gr3d0', ts, Buffer.from(body));
    expect(() => new VoiceAuthGuard({ get: () => 'outro' } as any).canActivate(ctx({ 'x-voice-timestamp': ts, 'x-voice-signature': sig }, body))).toThrow(UnauthorizedException);
    expect(() => new VoiceAuthGuard({ get: () => undefined } as any).canActivate(ctx({ 'x-voice-timestamp': ts, 'x-voice-signature': sig }, body))).toThrow(UnauthorizedException);
  });
});
