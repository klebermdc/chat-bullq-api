import * as crypto from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ResendWebhookController } from './resend-webhook.controller';
import { EmailConfig } from './email.config';

const SECRET = 'whsec_' + Buffer.from('chave-secreta-do-webhook').toString('base64');

function assinar(id: string, ts: string, body: string, secret = SECRET) {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const sig = crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  return `v1,${sig}`;
}

function headersFor(id: string, ts: string, body: string, secret = SECRET) {
  return {
    'svix-id': id,
    'svix-timestamp': ts,
    'svix-signature': assinar(id, ts, body, secret),
  };
}

function agora() {
  return String(Math.floor(Date.now() / 1000));
}

function makeReq(body: string) {
  return { rawBody: Buffer.from(body) } as any;
}

function makeDeps() {
  const eventsFake = { applyByProviderId: jest.fn(async () => undefined) };
  const notificationsFake = { notifyOrgAgents: jest.fn(async () => undefined) };
  const prismaFake = {
    organization: { findMany: jest.fn(async () => [{ id: 'org_1' }, { id: 'org_2' }]) },
  };
  const cfgFake: EmailConfig = {
    apiKey: 'k',
    webhookSecret: SECRET,
    from: 'a@b.com',
    unsubscribeSecret: 'u',
    publicUrl: 'https://example.com',
  };
  const controller = new ResendWebhookController(
    eventsFake as any,
    notificationsFake as any,
    prismaFake as any,
    cfgFake,
  );
  return { controller, eventsFake, notificationsFake, prismaFake };
}

describe('ResendWebhookController.handle', () => {
  it('assinatura válida → chama applyByProviderId com o evento parseado', async () => {
    const { controller, eventsFake, notificationsFake } = makeDeps();
    const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'resend_1' } });
    const id = 'msg_1';
    const ts = agora();

    const result = await controller.handle(makeReq(body), headersFor(id, ts, body));

    expect(eventsFake.applyByProviderId).toHaveBeenCalledWith({
      type: 'email.delivered',
      data: { email_id: 'resend_1' },
    });
    expect(notificationsFake.notifyOrgAgents).not.toHaveBeenCalled();
    expect(result).toEqual({ received: true });
  });

  it('assinatura inválida → 401, NÃO aplica evento, e alerta o OWNER', async () => {
    const { controller, eventsFake, notificationsFake } = makeDeps();
    const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'resend_1' } });
    const id = 'msg_1';
    const ts = agora();
    const outro = 'whsec_' + Buffer.from('segredo-errado').toString('base64');

    await expect(
      controller.handle(makeReq(body), headersFor(id, ts, body, outro)),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(eventsFake.applyByProviderId).not.toHaveBeenCalled();
    expect(notificationsFake.notifyOrgAgents).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        roles: ['OWNER'],
        title: expect.any(String),
        body: expect.any(String),
      }),
    );
    expect(notificationsFake.notifyOrgAgents).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org_2' }),
    );
  });

  it('corpo não-JSON com assinatura válida → 401', async () => {
    const { controller, eventsFake } = makeDeps();
    const body = 'isto não é json';
    const id = 'msg_1';
    const ts = agora();

    await expect(
      controller.handle(makeReq(body), headersFor(id, ts, body)),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(eventsFake.applyByProviderId).not.toHaveBeenCalled();
  });

  it('falha ao notificar não impede a rejeição', async () => {
    const { controller, notificationsFake } = makeDeps();
    notificationsFake.notifyOrgAgents.mockRejectedValue(new Error('fila fora do ar'));
    const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'resend_1' } });
    const id = 'msg_1';
    const ts = agora();
    const outro = 'whsec_' + Buffer.from('segredo-errado').toString('base64');

    await expect(
      controller.handle(makeReq(body), headersFor(id, ts, body, outro)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
