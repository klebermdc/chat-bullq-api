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

interface SendPrivateReplyParams {
  message: string;
}

@Injectable()
export class SendPrivateReplyHandler implements ActionHandler {
  readonly type = 'send_private_reply' as const;
  // Efeito externo irreversível (abre DM real) — se falhar, parar o run é
  // mais seguro que seguir aplicando etiquetas como se a DM tivesse saído.
  readonly continueOnErrorDefault = false;

  constructor(
    private readonly messengerHttpClient: MessengerHttpClient,
    private readonly instagramHttpClient: InstagramHttpClient,
  ) {}

  validateParams(params: Record<string, unknown>): void {
    if (!params.message || typeof params.message !== 'string') {
      throw new Error('send_private_reply: param "message" is required (string)');
    }
    if ((params.message as string).trim().length === 0) {
      throw new Error('send_private_reply: "message" cannot be empty');
    }
  }

  async execute(
    params: Record<string, unknown>,
    ctx: ActionContext,
  ): Promise<ActionExecutionResult> {
    const p = params as unknown as SendPrivateReplyParams;
    const { organizationId, prisma } = ctx;
    const payload = ctx.payload as CommentReceivedPayload;

    if (!payload.commentId) {
      return {
        ok: false,
        errorCode: 'invalid_params',
        errorMessage: 'send_private_reply requires payload.commentId (event is not COMMENT_RECEIVED)',
      };
    }

    // Validate the comment belongs to the org — defense against stale
    // config referencing a comment from a rule saved before the org
    // boundary changed. Same pattern as add_tag.
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

    // A Meta aceita só UMA resposta privada por comentário — a segunda é
    // recusada. Checar ANTES de chamar é o que barra a DM dupla quando a
    // Meta reentrega o webhook; descobrir pelo erro geraria uma chamada
    // desnecessária e log sujo a cada reentrega.
    if (comment.privateReplyAt) {
      return {
        ok: true,
        output: { commentId: comment.id, alreadyReplied: true },
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
        errorMessage: `send_private_reply: channel type ${comment.channel.type} has no comment reply support`,
      };
    }

    try {
      await client.sendPrivateReply(comment.channel, comment.externalCommentId, p.message);
      await prisma.socialComment.update({
        where: { id: comment.id },
        data: { privateReplyAt: new Date(), privateReplyError: null },
      });
      return { ok: true, output: { commentId: comment.id } };
    } catch (err) {
      // O motivo real da Meta vem do wrapGraphError do http-client
      // (mensagem completa, não "Request failed with status code 400" —
      // lição da API #154, onde o motivo real só aparecia no log do
      // container). Gravamos aqui para o atendente ver na tela, não só
      // no log.
      const errorMessage = (err as Error).message;
      await prisma.socialComment.update({
        where: { id: comment.id },
        data: { privateReplyError: errorMessage },
      });
      return {
        ok: false,
        errorCode: 'external_error',
        errorMessage,
      };
    }
  }
}
