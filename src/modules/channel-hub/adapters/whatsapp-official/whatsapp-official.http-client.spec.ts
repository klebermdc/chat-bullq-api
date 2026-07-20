import { BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { WhatsAppOfficialHttpClient } from './whatsapp-official.http-client';

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
