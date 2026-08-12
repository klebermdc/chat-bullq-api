import { AdConnectionStatus } from '@prisma/client';
import { classifyMetaError } from './meta-error.util';

/** Molda o erro do axios como a Graph API devolve. */
function graphError(code: number, subcode?: number, message = 'boom') {
  return {
    response: { status: 400, data: { error: { code, error_subcode: subcode, message } } },
  };
}

describe('classifyMetaError', () => {
  it('trata token expirado como credencial invalida', () => {
    const result = classifyMetaError(graphError(190, 463));
    expect(result.kind).toBe('credential');
    expect(result).toMatchObject({ status: AdConnectionStatus.INVALID_TOKEN });
  });

  it('trata permissao removida pelo usuario como revogada', () => {
    const result = classifyMetaError(graphError(190, 458));
    expect(result.kind).toBe('credential');
    expect(result).toMatchObject({ status: AdConnectionStatus.REVOKED });
  });

  it('trata OAuthException sem subcodigo como credencial invalida', () => {
    const result = classifyMetaError(graphError(190));
    expect(result).toMatchObject({ kind: 'credential', status: AdConnectionStatus.INVALID_TOKEN });
  });

  it('trata limite de requisicao como rate_limit', () => {
    expect(classifyMetaError(graphError(17)).kind).toBe('rate_limit');
    expect(classifyMetaError(graphError(80004)).kind).toBe('rate_limit');
  });

  it('trata erro desconhecido como transitorio', () => {
    expect(classifyMetaError(graphError(1)).kind).toBe('transient');
  });

  it('trata erro sem resposta HTTP como transitorio', () => {
    expect(classifyMetaError(new Error('ECONNRESET')).kind).toBe('transient');
  });

  it('preserva a mensagem da Meta', () => {
    const result = classifyMetaError(graphError(190, 463, 'Session has expired'));
    expect(result.message).toContain('Session has expired');
  });
});
