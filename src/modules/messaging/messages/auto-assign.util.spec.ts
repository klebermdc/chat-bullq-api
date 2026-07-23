import { OrgRole } from '@prisma/client';
import { shouldAutoAssignOnReply } from './auto-assign.util';

describe('shouldAutoAssignOnReply', () => {
  const AGENT = 'user-agent';
  const OWNER_A = 'user-owner';

  it('AGENT respondendo conversa de outro atendente ASSUME (rouba) — comportamento legado', () => {
    expect(
      shouldAutoAssignOnReply({
        currentAssigneeId: 'someone-else',
        senderId: AGENT,
        role: OrgRole.AGENT,
      }),
    ).toBe(true);
  });

  it('AGENT respondendo conversa órfã ASSUME', () => {
    expect(
      shouldAutoAssignOnReply({
        currentAssigneeId: null,
        senderId: AGENT,
        role: OrgRole.AGENT,
      }),
    ).toBe(true);
  });

  it('ADM respondendo conversa que JÁ TEM DONO não rouba (preserva o agente de direito)', () => {
    expect(
      shouldAutoAssignOnReply({
        currentAssigneeId: AGENT,
        senderId: OWNER_A,
        role: OrgRole.ADMIN,
      }),
    ).toBe(false);
  });

  it('OWNER respondendo conversa que JÁ TEM DONO não rouba', () => {
    expect(
      shouldAutoAssignOnReply({
        currentAssigneeId: AGENT,
        senderId: OWNER_A,
        role: OrgRole.OWNER,
      }),
    ).toBe(false);
  });

  it('ADM respondendo conversa ÓRFÃ (sem dono) assume', () => {
    expect(
      shouldAutoAssignOnReply({
        currentAssigneeId: null,
        senderId: OWNER_A,
        role: OrgRole.ADMIN,
      }),
    ).toBe(true);
  });

  it('ADM que já é o dono é no-op (não reatribui)', () => {
    expect(
      shouldAutoAssignOnReply({
        currentAssigneeId: OWNER_A,
        senderId: OWNER_A,
        role: OrgRole.ADMIN,
      }),
    ).toBe(false);
  });

  it('role ausente é tratado como AGENT (fail-closed): assume conversa de outro', () => {
    expect(
      shouldAutoAssignOnReply({
        currentAssigneeId: 'someone-else',
        senderId: AGENT,
      }),
    ).toBe(true);
  });
});
