import { isRetryableSendError } from './outbound-message.processor';

describe('isRetryableSendError', () => {
  it('429 (status) é retentável', () => {
    expect(isRetryableSendError({ response: { status: 429 } })).toBe(true);
    expect(isRetryableSendError({ status: 429 })).toBe(true);
  });

  it('mensagem do Wasender "account protection" é retentável', () => {
    expect(
      isRetryableSendError({
        message:
          'Wasender API error: You have account protection enabled. You can only send 1 message every 5 seconds.',
      }),
    ).toBe(true);
    expect(
      isRetryableSendError({ message: 'Request failed with status code 429' }),
    ).toBe(true);
  });

  it('5xx do provider é retentável', () => {
    expect(isRetryableSendError({ response: { status: 503 } })).toBe(true);
  });

  it('quedas de rede são retentáveis', () => {
    expect(isRetryableSendError({ message: 'socket hang up' })).toBe(true);
    expect(isRetryableSendError({ message: 'ETIMEDOUT' })).toBe(true);
  });

  it('erros definitivos NÃO são retentáveis', () => {
    expect(isRetryableSendError({ response: { status: 400 } })).toBe(false);
    expect(isRetryableSendError({ message: 'Contact channel not found' })).toBe(
      false,
    );
    expect(isRetryableSendError({ response: { status: 401 } })).toBe(false);
  });
});
