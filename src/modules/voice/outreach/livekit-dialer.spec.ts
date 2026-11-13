import * as crypto from 'crypto';
import { LiveKitDialer, liveKitToken, readLiveKitConfig } from './livekit-dialer';

const CFG = { url: 'https://lk.exemplo', apiKey: 'APIk', apiSecret: 'segredo', outboundTrunkId: 'ST_out', agentName: 'aline-voz' };

describe('liveKitToken', () => {
  it('é um JWT HS256 válido com emissor = API key e as permissões pedidas', () => {
    const now = new Date('2026-11-16T15:00:00Z');
    const t = liveKitToken(CFG, { sip: { call: true } }, now, 300);
    const [h, p, s] = t.split('.');
    expect(crypto.createHmac('sha256', 'segredo').update(`${h}.${p}`).digest('base64url')).toBe(s);
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(payload).toMatchObject({ iss: 'APIk', sip: { call: true }, exp: now.getTime() / 1000 + 300 });
  });
});

describe('readLiveKitConfig', () => {
  it('sem qualquer variável, não configura (não disca)', () => {
    const get = (k: string) => ({ LIVEKIT_URL: 'wss://lk.exemplo', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' } as any)[k];
    expect(readLiveKitConfig({ get } as any)).toBeNull();
  });
  it('converte wss:// em https:// para a API', () => {
    const env: any = { LIVEKIT_URL: 'wss://lk.exemplo/', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's', LIVEKIT_SIP_OUTBOUND_TRUNK_ID: 'ST' };
    expect(readLiveKitConfig({ get: (k: string) => env[k] } as any)).toMatchObject({ url: 'https://lk.exemplo', agentName: 'aline-voz' });
  });
});

describe('LiveKitDialer.dial', () => {
  it('despacha a Aline com a missão e depois liga pelo tronco de saída', async () => {
    const calls: { url: string; body: any }[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response('{}', { status: 200 });
    };
    const d = LiveKitDialer.withConfig(CFG, fetchImpl);
    await d.dial({ room: 'retorno-ap1', phoneE164: '+5511999990000', missionMetadata: '{"missao":"retorno_cotacao"}', contactName: 'Kleber' });
    expect(calls.map((c) => c.url)).toEqual([
      'https://lk.exemplo/twirp/livekit.AgentDispatchService/CreateDispatch',
      'https://lk.exemplo/twirp/livekit.SIP/CreateSIPParticipant',
    ]);
    expect(calls[0].body).toEqual({ room: 'retorno-ap1', agentName: 'aline-voz', metadata: '{"missao":"retorno_cotacao"}' });
    expect(calls[1].body).toMatchObject({ sipTrunkId: 'ST_out', sipCallTo: '+5511999990000', roomName: 'retorno-ap1' });
  });

  it('recusa sem configuração, telefone inválido e erro do LiveKit', async () => {
    await expect(LiveKitDialer.withConfig(null, fetch as any).dial({ room: 'r', phoneE164: '+5511999990000', missionMetadata: '{}', contactName: 'x' })).rejects.toThrow('não configurado');
    const ok = LiveKitDialer.withConfig(CFG, async () => new Response('{}'));
    await expect(ok.dial({ room: 'r', phoneE164: '11999', missionMetadata: '{}', contactName: 'x' })).rejects.toThrow('Telefone inválido');
    const erro = LiveKitDialer.withConfig(CFG, async () => new Response('boom', { status: 500 }));
    await expect(erro.dial({ room: 'r', phoneE164: '+5511999990000', missionMetadata: '{}', contactName: 'x' })).rejects.toThrow('CreateDispatch 500');
  });
});
