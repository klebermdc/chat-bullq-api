import { ChannelType } from '@prisma/client';
import { SendPrivateReplyHandler } from './send-private-reply.handler';
import { ActionContext } from '../action.types';
import { CommentReceivedPayload } from '../../automations.types';
import { MessengerHttpClient } from '../../../channel-hub/adapters/messenger/messenger.http-client';
import { InstagramHttpClient } from '../../../channel-hub/adapters/instagram/instagram.http-client';

describe('SendPrivateReplyHandler', () => {
  const ORG_ID = 'org1';
  const COMMENT_ID = 'comment-internal-id';
  const EXTERNAL_COMMENT_ID = 'ext-comment-1';

  const baseComment = {
    id: COMMENT_ID,
    organizationId: ORG_ID,
    externalCommentId: EXTERNAL_COMMENT_ID,
    privateReplyAt: null as Date | null,
    privateReplyError: null as string | null,
    channel: { id: 'channel1', type: ChannelType.MESSENGER, config: {} },
  };

  const payload: CommentReceivedPayload = {
    organizationId: ORG_ID,
    contactId: 'contact1',
    channelId: 'channel1',
    commentId: COMMENT_ID,
    postId: 'post1',
    body: 'quero preco',
    isReply: false,
  };

  let prisma: {
    socialComment: { findFirst: jest.Mock; update: jest.Mock };
  };
  let messengerHttpClient: { sendPrivateReply: jest.Mock; replyToComment: jest.Mock; getOwnAccountId: jest.Mock };
  let instagramHttpClient: { sendPrivateReply: jest.Mock; replyToComment: jest.Mock; getOwnAccountId: jest.Mock };
  let handler: SendPrivateReplyHandler;
  let ctx: ActionContext;

  beforeEach(() => {
    prisma = {
      socialComment: {
        findFirst: jest.fn().mockResolvedValue({ ...baseComment }),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    messengerHttpClient = {
      sendPrivateReply: jest.fn().mockResolvedValue({ id: 'sent-1' }),
      replyToComment: jest.fn(),
      getOwnAccountId: jest.fn(),
    };
    instagramHttpClient = {
      sendPrivateReply: jest.fn(),
      replyToComment: jest.fn(),
      getOwnAccountId: jest.fn(),
    };
    handler = new SendPrivateReplyHandler(
      messengerHttpClient as unknown as MessengerHttpClient,
      instagramHttpClient as unknown as InstagramHttpClient,
    );
    ctx = {
      organizationId: ORG_ID,
      payload,
      traceId: 'trace1',
      cascadeDepth: 0,
      visitedAutomations: [],
      outbox: {} as ActionContext['outbox'],
      prisma: prisma as unknown as ActionContext['prisma'],
      actorId: 'actor1',
    };
  });

  describe('validateParams', () => {
    it('aceita message string não vazia', () => {
      expect(() => handler.validateParams({ message: 'Oi! Me chama aqui' })).not.toThrow();
    });
    it('rejeita message ausente', () => {
      expect(() => handler.validateParams({})).toThrow(/message/);
    });
    it('rejeita message vazia', () => {
      expect(() => handler.validateParams({ message: '   ' })).toThrow(/message/);
    });
    it('rejeita message não-string', () => {
      expect(() => handler.validateParams({ message: 123 })).toThrow(/message/);
    });
  });

  describe('execute', () => {
    it('sucesso: chama a Meta e grava privateReplyAt', async () => {
      const res = await handler.execute({ message: 'Oi!' }, ctx);

      expect(res.ok).toBe(true);
      expect(messengerHttpClient.sendPrivateReply).toHaveBeenCalledWith(
        baseComment.channel,
        EXTERNAL_COMMENT_ID,
        'Oi!',
      );
      expect(prisma.socialComment.update).toHaveBeenCalledWith({
        where: { id: COMMENT_ID },
        data: { privateReplyAt: expect.any(Date), privateReplyError: null },
      });
    });

    it('comentário já respondido: NÃO chama a Meta e devolve ok sem erro', async () => {
      prisma.socialComment.findFirst.mockResolvedValue({
        ...baseComment,
        privateReplyAt: new Date('2026-08-10T00:00:00Z'),
      });

      const res = await handler.execute({ message: 'Oi!' }, ctx);

      expect(res.ok).toBe(true);
      expect(res.output).toMatchObject({ alreadyReplied: true });
      expect(messengerHttpClient.sendPrivateReply).not.toHaveBeenCalled();
      expect(prisma.socialComment.update).not.toHaveBeenCalled();
    });

    it('erro da Meta: grava o motivo REAL em privateReplyError, não uma mensagem genérica de HTTP', async () => {
      messengerHttpClient.sendPrivateReply.mockRejectedValue(
        new Error(
          'Messenger sendPrivateReply falhou: The comment can not be replied to privately (code=100, subcode=2534022)',
        ),
      );

      const res = await handler.execute({ message: 'Oi!' }, ctx);

      expect(res.ok).toBe(false);
      expect(res.errorMessage).not.toMatch(/request failed with status code/i);
      expect(res.errorMessage).toMatch(/comment can not be replied to privately/i);
      expect(prisma.socialComment.update).toHaveBeenCalledWith({
        where: { id: COMMENT_ID },
        data: {
          privateReplyError: expect.stringMatching(/comment can not be replied to privately/i),
        },
      });
    });

    it('comentário de outra organização: recusa sem chamar a Meta', async () => {
      prisma.socialComment.findFirst.mockResolvedValue(null);

      const res = await handler.execute({ message: 'Oi!' }, ctx);

      expect(res.ok).toBe(false);
      expect(res.errorCode).toBe('invalid_ref');
      expect(messengerHttpClient.sendPrivateReply).not.toHaveBeenCalled();
    });

    it('payload sem commentId (evento não é COMMENT_RECEIVED): recusa', async () => {
      const badCtx: ActionContext = {
        ...ctx,
        payload: { organizationId: ORG_ID, contactId: 'contact1' } as CommentReceivedPayload,
      };

      const res = await handler.execute({ message: 'Oi!' }, badCtx);

      expect(res.ok).toBe(false);
      expect(res.errorCode).toBe('invalid_params');
      expect(prisma.socialComment.findFirst).not.toHaveBeenCalled();
    });
  });
});
