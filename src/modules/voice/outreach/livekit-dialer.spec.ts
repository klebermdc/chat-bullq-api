import * as crypto from 'crypto';
import { isSdpRejection, LiveKitDialer, liveKitToken, readLiveKitConfig } from './livekit-dialer';

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

describe('LiveKitDialer (vendedor)', () => {
  it('liga só para o cliente (sem despachar a Aline) e dá acesso do vendedor à sala', async () => {
    const urls: string[] = [];
    const d = LiveKitDialer.withConfig(CFG, async (url) => {
      urls.push(url);
      return new Response('{}');
    });
    await d.dialForSeller({ room: 'vendedor-cv1-1', phoneE164: '+5511999990000', contactName: 'Kleber' });
    expect(urls).toEqual(['https://lk.exemplo/twirp/livekit.SIP/CreateSIPParticipant']);
    const { url, token } = d.joinAccess({ room: 'vendedor-cv1-1', identity: 'vendedor-u1', name: 'Renata' });
    expect(url).toBe('wss://lk.exemplo');
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    expect(payload).toMatchObject({ sub: 'vendedor-u1', name: 'Renata', video: { roomJoin: true, room: 'vendedor-cv1-1', canPublish: true } });
  });

  it('encerrar apaga a sala', async () => {
    const calls: string[] = [];
    const d = LiveKitDialer.withConfig(CFG, async (url) => {
      calls.push(url);
      return new Response('{}');
    });
    await d.endRoom('vendedor-cv1-1');
    expect(calls).toEqual(['https://lk.exemplo/twirp/livekit.RoomService/DeleteRoom']);
  });
});

const SDP_403 = 'twirp error unknown: unexpected status from INVITE response: sip status: 403: SDP Validation Error: Provided SDP is invalid';

/** LiveKit falso: CreateSIPParticipant responde conforme a fila (erro, ok ou "chamando" sem responder). */
function fakeLiveKit(sipReplies: ('sdp403' | 'ok' | 'chamando' | 'outro')[]) {
  const calls: { url: string; body: any }[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body });
    if (!url.endsWith('CreateSIPParticipant')) return new Response('{}');
    const reply = sipReplies.shift();
    if (reply === 'sdp403') return new Response(JSON.stringify({ code: 'unknown', msg: SDP_403 }), { status: 500 });
    if (reply === 'outro') return new Response(JSON.stringify({ code: 'unknown', msg: 'sip status: 486: Busy Here' }), { status: 500 });
    if (reply === 'chamando') return new Promise<Response>(() => undefined);
    return new Response('{}');
  };
  return { calls, dialer: LiveKitDialer.withConfig(CFG, fetchImpl, 20) };
}

describe('recusa de SDP da Meta (403 antes de tocar)', () => {
  it('reconhece só o 403 de SDP', () => {
    expect(isSdpRejection(new Error(`LiveKit CreateSIPParticipant 500: ${SDP_403}`))).toBe(true);
    expect(isSdpRejection(new Error('LiveKit CreateSIPParticipant 500: sip status: 486: Busy Here'))).toBe(false);
    expect(isSdpRejection(new Error('LiveKit CreateSIPParticipant 403: forbidden'))).toBe(false);
  });

  it('Aline: disca de novo numa sala nova (a primeira a Aline já encerrou) e devolve a sala usada', async () => {
    const { calls, dialer } = fakeLiveKit(['sdp403', 'ok']);
    const room = await dialer.dial({ room: 'retorno-pr1', phoneE164: '+5511999990000', missionMetadata: '{}', contactName: 'Kleber' });
    expect(room).toBe('retorno-pr1-2');
    expect(calls.map((c) => [c.url.split('/').pop(), c.body.room ?? c.body.roomName])).toEqual([
      ['CreateDispatch', 'retorno-pr1'],
      ['CreateSIPParticipant', 'retorno-pr1'],
      ['CreateDispatch', 'retorno-pr1-2'],
      ['CreateSIPParticipant', 'retorno-pr1-2'],
    ]);
    expect(calls[1].body).toMatchObject({ waitUntilAnswered: true, ringingTimeout: '50s' });
  });

  it('vendedor: disca de novo na mesma sala', async () => {
    const { calls, dialer } = fakeLiveKit(['sdp403', 'ok']);
    await dialer.dialForSeller({ room: 'vendedor-cv1-1', phoneE164: '+5511999990000', contactName: 'Kleber' });
    expect(calls.map((c) => c.body.roomName)).toEqual(['vendedor-cv1-1', 'vendedor-cv1-1']);
  });

  it('tenta até 3 vezes e não repete outros erros', async () => {
    const terceira = fakeLiveKit(['sdp403', 'sdp403', 'ok']);
    await terceira.dialer.dialForSeller({ room: 'r', phoneE164: '+5511999990000', contactName: 'x' });
    expect(terceira.calls).toHaveLength(3);
    await expect(fakeLiveKit(['sdp403', 'sdp403', 'sdp403', 'ok']).dialer.dialForSeller({ room: 'r', phoneE164: '+5511999990000', contactName: 'x' })).rejects.toThrow('SDP');
    const ocupado = fakeLiveKit(['outro', 'ok']);
    await expect(ocupado.dialer.dialForSeller({ room: 'r', phoneE164: '+5511999990000', contactName: 'x' })).rejects.toThrow('486');
    expect(ocupado.calls).toHaveLength(1);
  });

  it('chamando sem recusa: não espera o cliente atender', async () => {
    const { dialer } = fakeLiveKit(['chamando']);
    await expect(dialer.dial({ room: 'r', phoneE164: '+5511999990000', missionMetadata: '{}', contactName: 'x' })).resolves.toBe('r');
  });
});

describe('dispatchAgent', () => {
  it('despacha o agente com a missão na sala', async () => {
    const { calls, dialer } = fakeLiveKit([]);
    await dialer.dispatchAgent('vendedor-cv1-1', '{"missao":"transcrever_vendedor","callId":"c1"}');
    expect(calls[0]).toEqual({
      url: 'https://lk.exemplo/twirp/livekit.AgentDispatchService/CreateDispatch',
      body: { room: 'vendedor-cv1-1', agentName: 'aline-voz', metadata: '{"missao":"transcrever_vendedor","callId":"c1"}' },
    });
  });
});
