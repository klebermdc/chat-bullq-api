import { mapSonaxStatus } from './sonax-status.util';

describe('mapSonaxStatus', () => {
  it('mapeia os status conhecidos', () => {
    expect(mapSonaxStatus('discando').status).toBe('DIALING');
    expect(mapSonaxStatus('andamento').status).toBe('RINGING');
    expect(mapSonaxStatus('falando').status).toBe('TALKING');
    expect(mapSonaxStatus('ramal atendeu').status).toBe('ANSWERED');
    expect(mapSonaxStatus('ocupado').status).toBe('BUSY');
    expect(mapSonaxStatus('indisponível').status).toBe('NO_ANSWER');
    expect(mapSonaxStatus('ramal falhou').status).toBe('NO_ANSWER');
    expect(mapSonaxStatus('desligada').status).toBe('FINISHED');
  });
  it('é case-insensitive e tolera acento ausente', () => {
    expect(mapSonaxStatus('INDISPONIVEL').status).toBe('NO_ANSWER');
  });
  it('deriva answered de statusAtendimento=S', () => {
    expect(mapSonaxStatus('desligada', 'S').answered).toBe(true);
    expect(mapSonaxStatus('desligada', 'N').answered).toBe(false);
  });
  it('status desconhecido cai em FINISHED sem quebrar', () => {
    expect(mapSonaxStatus('qualquer-coisa').status).toBe('FINISHED');
  });
});
