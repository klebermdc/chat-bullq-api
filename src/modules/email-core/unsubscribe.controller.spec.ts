import { NotFoundException } from '@nestjs/common';
import { EmailSubscriberStatus } from '@prisma/client';
import { UnsubscribeController } from './unsubscribe.controller';
import { signUnsubscribeToken } from './unsubscribe-token.util';
import { EmailConfig } from './email.config';

const SECRET = 'segredo-de-descadastro';

function makeDeps() {
  const sub = {
    id: 'sub_1',
    organizationId: 'org_1',
    email: 'destinatario@exemplo.com',
    status: EmailSubscriberStatus.SUBSCRIBED,
  };
  const subscribers = {
    findById: jest.fn(async (id: string) => (id === sub.id ? sub : null)),
    unsubscribe: jest.fn(async (id: string, organizationId: string) => {
      if (id !== sub.id || organizationId !== sub.organizationId) {
        throw new NotFoundException('destinatário não encontrado');
      }
      return { ...sub, status: EmailSubscriberStatus.UNSUBSCRIBED };
    }),
  };
  const cfgFake: EmailConfig = {
    apiKey: 'k',
    webhookSecret: 'w',
    from: 'a@b.com',
    unsubscribeSecret: SECRET,
    publicUrl: 'https://example.com',
    apiUrl: 'https://api.example.com',
  };
  const controller = new UnsubscribeController(subscribers as any, cfgFake);
  return { controller, subscribers, sub };
}

describe('UnsubscribeController', () => {
  describe('GET :token (peek)', () => {
    it('token válido devolve email e status do destinatário', async () => {
      const { controller, sub } = makeDeps();
      const token = signUnsubscribeToken(sub.id, SECRET);

      const result = await controller.peek(token);

      expect(result).toEqual({ email: sub.email, status: sub.status });
    });

    it('token adulterado lança NotFoundException', async () => {
      const { controller, sub } = makeDeps();
      const token = signUnsubscribeToken(sub.id, SECRET);
      const adulterado = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');

      await expect(controller.peek(adulterado)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('token válido mas destinatário inexistente lança NotFoundException', async () => {
      const { controller } = makeDeps();
      const token = signUnsubscribeToken('sub_inexistente', SECRET);

      await expect(controller.peek(token)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('POST :token (confirm)', () => {
    it('token válido chama subscribers.unsubscribe e devolve status UNSUBSCRIBED', async () => {
      const { controller, subscribers, sub } = makeDeps();
      const token = signUnsubscribeToken(sub.id, SECRET);

      const result = await controller.confirm(token);

      expect(subscribers.unsubscribe).toHaveBeenCalledWith(
        sub.id,
        sub.organizationId,
        expect.any(String),
      );
      expect(result).toEqual({ email: sub.email, status: EmailSubscriberStatus.UNSUBSCRIBED });
    });

    it('token adulterado lança NotFoundException', async () => {
      const { controller, sub } = makeDeps();
      const token = signUnsubscribeToken(sub.id, SECRET);
      const adulterado = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');

      await expect(controller.confirm(adulterado)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('token válido mas destinatário inexistente lança NotFoundException', async () => {
      const { controller } = makeDeps();
      const token = signUnsubscribeToken('sub_inexistente', SECRET);

      await expect(controller.confirm(token)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
