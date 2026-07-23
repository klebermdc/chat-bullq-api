import { OrgRole } from '@prisma/client';

/** Papéis que enxergam credenciais de canal (config/webhookSecret) como estão hoje. */
const STAFF_ROLES: OrgRole[] = [OrgRole.OWNER, OrgRole.ADMIN];

/**
 * Remove as credenciais do provedor (`config` — accessToken/token/pageAccessToken/
 * appSecret — e `webhookSecret`) da resposta quando quem pediu não é OWNER/ADMIN.
 *
 * O Operador (AGENT) precisa do canal só pra ícone/filtro/envio no Inbox — nunca
 * das credenciais. Fail-closed: role `undefined` (ex.: chamador que esqueceu de
 * checar) também perde as chaves, igual a qualquer papel não-staff.
 *
 * As chaves são OMITIDAS por completo (não viram `{}`/`null`) — o form de edição
 * do canal (`edit-channel-dialog.tsx`) já trata `channel.config ?? {}` e
 * `channel.webhookSecret ?? ''`, então a ausência da chave não quebra nada, e evita
 * a falsa impressão de "config vazio" (que um PATCH sem re-digitar tudo apagaria).
 */
export function maskChannelSecrets<T extends { config?: unknown; webhookSecret?: unknown }>(
  channel: T,
  role: OrgRole | undefined,
): T | Omit<T, 'config' | 'webhookSecret'> {
  if (role && STAFF_ROLES.includes(role)) {
    return channel;
  }
  const { config: _config, webhookSecret: _webhookSecret, ...rest } = channel;
  return rest;
}
