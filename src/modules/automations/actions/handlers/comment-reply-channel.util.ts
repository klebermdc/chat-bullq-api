import { Channel, ChannelType } from '@prisma/client';
import { MessengerHttpClient } from '../../../channel-hub/adapters/messenger/messenger.http-client';
import { InstagramHttpClient } from '../../../channel-hub/adapters/instagram/instagram.http-client';

// Comentário em post/Reel pode chegar por dois tipos de canal — Página do
// Facebook (Messenger) ou conta Instagram (spec:
// docs/superpowers/specs/2026-08-17-sair-do-manychat-design.md, seção
// "entry[].changes[]"). `send_private_reply` e `reply_public_comment`
// precisam do mesmo trio de operações nos dois, daí a interface comum em
// vez de duplicar o switch em cada handler.
export interface CommentReplyClient {
  sendPrivateReply(channel: Channel, commentId: string, message: string): Promise<unknown>;
  replyToComment(channel: Channel, commentId: string, message: string): Promise<unknown>;
  // Sem chamada de rede — lido direto da config do canal. Usado pela
  // guarda anti-laço do reply_public_comment.
  getOwnAccountId(channel: Channel): string | undefined;
}

export function resolveCommentReplyClient(
  channelType: ChannelType,
  messengerHttpClient: MessengerHttpClient,
  instagramHttpClient: InstagramHttpClient,
): CommentReplyClient | null {
  if (channelType === ChannelType.MESSENGER) return messengerHttpClient;
  if (channelType === ChannelType.INSTAGRAM) return instagramHttpClient;
  return null;
}
