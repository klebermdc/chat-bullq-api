import { ChannelType } from '@prisma/client';
import { ReplyPublicCommentHandler } from './reply-public-comment.handler';
import { ActionContext } from '../action.types';
import { CommentReceivedPayload } from '../../automations.types';
import { MessengerHttpClient } from '../../../channel-hub/adapters/messenger/messenger.http-client';
import { InstagramHttpClient } from '../../../channel-hub/adapters/instagram/instagram.http-client';

describe('ReplyPublicCommentHandler', () => {
  const ORG_ID = 'org1';
  const COMMENT_ID = 'comment-internal-id';
  const EXTERNAL_COMMENT_ID = 'ext-comment-1';
  const PAGE_ID = 'page-123';
  const CUSTOMER_ID = 'customer-456';

  const baseComment = {
    id: COMMENT_ID,
    organizationId: ORG_ID,
    externalCommentId: EXTERNAL_COMMENT_ID,
    authorExternalId: CUSTOMER_ID,
    publicReplyAt: null as Date | null,
    channel: { id: 'channel1', type: ChannelType.MESSENGER, config: { pageId: PAGE_ID } },
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
  let handler: ReplyPublicCommentHandler;
  let ctx: ActionContext;

  beforeEach(() => {
    prisma = {
      socialComment: {
        findFirst: jest.fn().mockResolvedValue({ ...baseComment }),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    messengerHttpClient = {
      sendPrivateReply: jest.fn(),
      replyToComment: jest.fn().mockResolvedValue({ id: 'reply-1' }),
      getOwnAccountId: jest.fn().mockReturnValue(PAGE_ID),
    };
    instagramHttpClient = {
      sendPrivateReply: jest.fn(),
      replyToComment: jest.fn(),
      getOwnAccountId: jest.fn(),
    };
    handler = new ReplyPublicCommentHandler(
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
      expect(() => handler.validateParams({ message: 'Obrigado pelo comentário!' })).not.toThrow();
    });
    it('rejeita message ausente', () => {
      expect(() => handler.validateParams({})).toThrow(/message/);
    });
    it('rejeita message vazia', () => {
      expect(() => handler.validateParams({ message: '   ' })).toThrow(/message/);
    });
  });

  describe('execute', () => {
    it('sucesso: chama a Meta e grava publicReplyAt', async () => {
      const res = await handler.execute({ message: 'Valeu!' }, ctx);

      expect(res.ok).toBe(true);
      expect(messengerHttpClient.replyToComment).toHaveBeenCalledWith(
        baseComment.channel,
        EXTERNAL_COMMENT_ID,
        'Valeu!',
      );
      expect(prisma.socialComment.update).toHaveBeenCalledWith({
        where: { id: COMMENT_ID },
        data: { publicReplyAt: expect.any(Date) },
      });
    });

    it('não responde comentário do próprio perfil (guarda anti-laço)', async () => {
      prisma.socialComment.findFirst.mockResolvedValue({
        ...baseComment,
        // O autor do comentário É a própria Página — a réplica pública
        // anterior do bot voltou pelo webhook como comentário novo.
        authorExternalId: PAGE_ID,
      });

      const res = await handler.execute({ message: 'Valeu!' }, ctx);

      expect(res.ok).toBe(true);
      expect(res.output).toMatchObject({ skipped: true, reason: 'own_profile_comment' });
      expect(messengerHttpClient.replyToComment).not.toHaveBeenCalled();
      expect(prisma.socialComment.update).not.toHaveBeenCalled();
    });

    it('canal sem pageId/igBusinessId configurado: NÃO chama a Meta, falha FECHADA com motivo legível', async () => {
      // Sem o id da própria conta não dá pra provar que o comentário não
      // é do próprio perfil — falhar aberto aqui é o que causaria o laço
      // de 4 réplicas públicas visíveis (MAX_CASCADE_DEPTH) descrito no
      // incidente. A guarda tem que recusar, não seguir em frente.
      messengerHttpClient.getOwnAccountId.mockReturnValue(undefined);

      const res = await handler.execute({ message: 'Valeu!' }, ctx);

      expect(res.ok).toBe(false);
      expect(res.errorCode).toBe('own_account_unknown');
      expect(res.errorMessage).toMatch(/nao foi possivel identificar a conta propria/i);
      expect(res.errorMessage).toMatch(/laco/i);
      expect(messengerHttpClient.replyToComment).not.toHaveBeenCalled();
      expect(prisma.socialComment.update).not.toHaveBeenCalled();
    });

    it('erro da Meta: o motivo real chega em errorMessage, não uma mensagem genérica de HTTP', async () => {
      messengerHttpClient.replyToComment.mockRejectedValue(
        new Error('Messenger replyToComment falhou: Comment is deleted (code=100, subcode=n/a)'),
      );

      const res = await handler.execute({ message: 'Valeu!' }, ctx);

      expect(res.ok).toBe(false);
      expect(res.errorMessage).not.toMatch(/request failed with status code/i);
      expect(res.errorMessage).toMatch(/comment is deleted/i);
    });

    it('comentário de outra organização: recusa sem chamar a Meta', async () => {
      prisma.socialComment.findFirst.mockResolvedValue(null);

      const res = await handler.execute({ message: 'Valeu!' }, ctx);

      expect(res.ok).toBe(false);
      expect(res.errorCode).toBe('invalid_ref');
      expect(messengerHttpClient.replyToComment).not.toHaveBeenCalled();
    });

    it('payload sem commentId (evento não é COMMENT_RECEIVED): recusa', async () => {
      const badCtx: ActionContext = {
        ...ctx,
        payload: { organizationId: ORG_ID, contactId: 'contact1' } as CommentReceivedPayload,
      };

      const res = await handler.execute({ message: 'Valeu!' }, badCtx);

      expect(res.ok).toBe(false);
      expect(res.errorCode).toBe('invalid_params');
      expect(prisma.socialComment.findFirst).not.toHaveBeenCalled();
    });
  });
});
