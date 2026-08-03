import { BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { WhatsAppOfficialHttpClient } from './whatsapp-official.http-client';
import { isRetryableSendError } from '../../../messaging/pipeline/outbound-message.processor';

jest.mock('axios');

const channel = {
  id: 'ch1',
  config: {
    accessToken: 'tok',
    phoneNumberId: 'PN1',
    businessAccountId: 'WABA1',
    apiVersion: 'v21.0',
  },
} as any;

describe('WhatsAppOfficialHttpClient.createTemplate', () => {
  it('converte erro da Meta em BadRequest com o motivo real (não 500)', async () => {
    const post = jest.fn().mockRejectedValue({
      response: {
        data: {
          error: {
            message: 'Invalid parameter',
            code: 100,
            error_user_title: 'Categoria incorreta',
            error_user_msg: 'O conteúdo não corresponde à categoria UTILITY.',
          },
        },
      },
    });
    (axios.create as jest.Mock).mockReturnValue({ post });

    const client = new WhatsAppOfficialHttpClient();
    const promise = client.createTemplate(channel, { name: 'x' } as any);

    await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    await expect(promise).rejects.toMatchObject({
      response: {
        message: expect.stringContaining('O conteúdo não corresponde'),
      },
    });
  });
});

describe('WhatsAppOfficialHttpClient.sendMessage', () => {
  const rejectWith = (payload: any) => {
    const post = jest.fn().mockRejectedValue(payload);
    (axios.create as jest.Mock).mockReturnValue({ post });
    return new WhatsAppOfficialHttpClient();
  };

  /**
   * O motivo real da recusa vive em `error_data.details` — é lá que a Meta
   * diz QUAL template não existe. Sem isto o `failedReason` gravado pelo
   * OutboundMessageProcessor era o `error.message` do axios, ou seja
   * "Request failed with status code 400", e o atendente não tinha como
   * saber por que o template não saiu.
   */
  it('põe o motivo real da Meta na .message (template inexistente)', async () => {
    const client = rejectWith({
      message: 'Request failed with status code 400',
      response: {
        status: 400,
        data: {
          error: {
            message: '(#132001) Template name does not exist in the translation',
            code: 132001,
            error_data: {
              messaging_product: 'whatsapp',
              details: 'template name (continuidade_atendimento) does not exist in pt_BR',
            },
          },
        },
      },
    });

    await expect(client.sendMessage(channel, {})).rejects.toMatchObject({
      message: expect.stringContaining(
        'template name (continuidade_atendimento) does not exist in pt_BR',
      ),
    });
  });

  it('inclui o código da Meta para dar pra procurar na doc', async () => {
    const client = rejectWith({
      message: 'Request failed with status code 401',
      response: {
        status: 401,
        data: {
          error: { message: 'Session has expired', code: 190 },
        },
      },
    });

    await expect(client.sendMessage(channel, {})).rejects.toMatchObject({
      message: expect.stringContaining('190'),
    });
  });

  /**
   * REGRESSÃO: o `isRetryableSendError` do OutboundMessageProcessor decide
   * retry lendo `error.response.status`. Se traduzíssemos o erro num
   * BadRequestException (como fazem os outros métodos daqui), todo 429/5xx
   * viraria 400 e o backoff do BullMQ pararia de reenviar — a mensagem
   * morreria FAILED no primeiro rate-limit. Por isso o erro traduzido tem
   * que preservar o shape do axios.
   */
  it('preserva response.status para o retry do BullMQ continuar valendo', async () => {
    const client = rejectWith({
      message: 'Request failed with status code 429',
      response: {
        status: 429,
        data: { error: { message: 'Too many requests', code: 130429 } },
      },
    });

    const err = await client.sendMessage(channel, {}).catch((e) => e);

    expect(err.response.status).toBe(429);
    expect(isRetryableSendError(err)).toBe(true);
  });

  it('não quebra quando o erro não veio da Meta (rede/timeout)', async () => {
    const client = rejectWith(
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
    );

    const err = await client.sendMessage(channel, {}).catch((e) => e);

    expect(err.message).toContain('socket hang up');
    expect(isRetryableSendError(err)).toBe(true);
  });
});
