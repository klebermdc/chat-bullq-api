import { Injectable } from '@nestjs/common';
import {
  ActionContext,
  ActionExecutionResult,
  ActionHandler,
} from '../action.types';
import { CommentReceivedPayload } from '../../automations.types';
import { MessengerHttpClient } from '../../../channel-hub/adapters/messenger/messenger.http-client';
import { InstagramHttpClient } from '../../../channel-hub/adapters/instagram/instagram.http-client';
import { resolveCommentReplyClient } from './comment-reply-channel.util';

interface ReplyPublicCommentParams {
  message: string;
}

@Injectable()
export class ReplyPublicCommentHandler implements ActionHandler {
  readonly type = 'reply_public_comment' as const;
  // Efeito externo irreversível (publica réplica pública real) — se
  // falhar, parar o run é mais seguro que seguir aplicando etiquetas
  // como se a réplica tivesse saído.
  readonly continueOnErrorDefault = false;

  constructor(
    private readonly messengerHttpClient: MessengerHttpClient,
    private readonly instagramHttpClient: InstagramHttpClient,
  ) {}

  validateParams(params: Record<string, unknown>): void {
    if (!params.message || typeof params.message !== 'string') {
      throw new Error('reply_public_comment: param "message" is required (string)');
    }
    if ((params.message as string).trim().length === 0) {
      throw new Error('reply_public_comment: "message" cannot be empty');
    }
  }

  async execute(
    params: Record<string, unknown>,
    ctx: ActionContext,
  ): Promise<ActionExecutionResult> {
    const p = params as unknown as ReplyPublicCommentParams;
    const { organizationId, prisma } = ctx;
    const payload = ctx.payload as CommentReceivedPayload;

    if (!payload.commentId) {
      return {
        ok: false,
        errorCode: 'invalid_params',
        errorMessage: 'reply_public_comment requires payload.commentId (event is not COMMENT_RECEIVED)',
      };
    }

    // Validate the comment belongs to the org — defense against stale
    // config, same pattern as add_tag / send_private_reply.
    const comment = await prisma.socialComment.findFirst({
      where: { id: payload.commentId, organizationId },
      include: { channel: true },
    });
    if (!comment) {
      return {
        ok: false,
        errorCode: 'invalid_ref',
        errorMessage: `comment ${payload.commentId} not found in org`,
      };
    }

    const client = resolveCommentReplyClient(
      comment.channel.type,
      this.messengerHttpClient,
      this.instagramHttpClient,
    );
    if (!client) {
      return {
        ok: false,
        errorCode: 'unsupported_channel',
        errorMessage: `reply_public_comment: channel type ${comment.channel.type} has no comment reply support`,
      };
    }

    // A GUARDA DE VERDADE contra o laço: se o autor do comentário é a
    // própria Página/perfil (ex.: a réplica pública anterior do bot
    // voltou pelo webhook como comentário novo), não responder. O
    // MAX_CASCADE_DEPTH do motor é a segunda rede — depender só dele
    // significa publicar várias réplicas visíveis antes de parar.
    //
    // Falha FECHADA: se a config do canal não tem pageId/igBusinessId,
    // NÃO dá pra provar que o comentário não é do próprio perfil — e
    // sem essa prova, não respondemos. O custo de um falso positivo aqui
    // (deixar de responder um comentário legítimo) é reversível e
    // silencioso; o custo de um falso negativo (responder a si mesmo)
    // é público, irreversível e multiplicado pelo MAX_CASCADE_DEPTH.
    const ownAccountId = client.getOwnAccountId(comment.channel);
    if (!ownAccountId) {
      return {
        ok: false,
        errorCode: 'own_account_unknown',
        errorMessage:
          'reply_public_comment: nao foi possivel identificar a conta propria ' +
          `(canal ${comment.channel.id} sem pageId/igBusinessId configurado); ` +
          'resposta publica abortada para evitar laco',
      };
    }
    if (comment.authorExternalId === ownAccountId) {
      return {
        ok: true,
        output: { commentId: comment.id, skipped: true, reason: 'own_profile_comment' },
      };
    }

    try {
      await client.replyToComment(comment.channel, comment.externalCommentId, p.message);
      await prisma.socialComment.update({
        where: { id: comment.id },
        data: { publicReplyAt: new Date() },
      });
      return { ok: true, output: { commentId: comment.id } };
    } catch (err) {
      // Réplica pública sem campo de erro dedicado no SocialComment (só a
      // privada tem `privateReplyError`) — o motivo real da Meta
      // (wrapGraphError) ainda chega ao atendente via errorMessage, que
      // o executor grava em automation_runs.actions_log.
      return {
        ok: false,
        errorCode: 'external_error',
        errorMessage: (err as Error).message,
      };
    }
  }
}
