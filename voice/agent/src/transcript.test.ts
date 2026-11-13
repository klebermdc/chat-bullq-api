import { describe, expect, it } from 'vitest';
import { speakerOf, transcriberCallId, TranscriptCollector } from './transcript.js';

describe('transcriberCallId', () => {
  it('só aceita a missão de transcrição com callId válido', () => {
    expect(transcriberCallId('{"missao":"transcrever_vendedor","callId":"cmw5tdui619rwle06s5xgyx2c"}')).toBe('cmw5tdui619rwle06s5xgyx2c');
    expect(transcriberCallId('{"missao":"retorno_cotacao","callId":"cmw5tdui619rwle06s5xgyx2c"}')).toBeNull();
    expect(transcriberCallId('{"missao":"transcrever_vendedor","callId":"../x"}')).toBeNull();
    expect(transcriberCallId('não é json')).toBeNull();
    expect(transcriberCallId(undefined)).toBeNull();
  });
});

describe('speakerOf', () => {
  it('o SIP do cliente é "cliente"; o navegador do vendedor é "vendedor"', () => {
    expect(speakerOf('cliente')).toBe('cliente');
    expect(speakerOf('vendedor-u1')).toBe('vendedor');
  });
});

describe('TranscriptCollector', () => {
  it('ordena as falas, junta falas seguidas da mesma pessoa e conta a duração desde o atendimento', () => {
    const c = new TranscriptCollector();
    c.markAnswered(1_000);
    c.add('vendedor', 'Oi, aqui é a Renata.', 3_000);
    c.add('cliente', ' Oi   Renata! ', 2_000);
    c.add('vendedor', 'Viu a cotação?', 4_000);
    c.add('cliente', '   ', 5_000);
    expect(c.payload('call1', 61_400)).toEqual({
      callId: 'call1',
      answered: true,
      durationSec: 60,
      segments: [
        { quem: 'cliente', texto: 'Oi Renata!' },
        { quem: 'vendedor', texto: 'Oi, aqui é a Renata. Viu a cotação?' },
      ],
    });
  });

  it('sem atendimento: não atendida, duração zero', () => {
    expect(new TranscriptCollector().payload('call1', 9_000)).toEqual({ callId: 'call1', answered: false, durationSec: 0, segments: [] });
  });
});
