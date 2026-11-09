import { OrgRole } from '@prisma/client';
import {
  agentScopeBlock,
  canAgentReachConversation,
  resolveAssignmentScope,
  scopedUserWhere,
} from './conversation-scope';

describe('resolveAssignmentScope', () => {
  it('AGENT é escopado às próprias conversas', () => {
    expect(resolveAssignmentScope(OrgRole.AGENT, 'u1')).toBe('u1');
  });
  it('ADMIN vê tudo (sem escopo)', () => {
    expect(resolveAssignmentScope(OrgRole.ADMIN, 'u1')).toBeUndefined();
  });
  it('OWNER vê tudo (sem escopo)', () => {
    expect(resolveAssignmentScope(OrgRole.OWNER, 'u1')).toBeUndefined();
  });
  it('role indefinido falha fechado (escopa)', () => {
    expect(resolveAssignmentScope(undefined, 'u1')).toBe('u1');
  });
});

describe('scopedUserWhere', () => {
  it('AGENT alcança conversa própria OU em que foi incluído', () => {
    expect(scopedUserWhere('u1')).toEqual({
      OR: [{ assignedToId: 'u1' }, { participants: { some: { userId: 'u1' } } }],
    });
  });
  it('ownedOnly: só a própria', () => {
    expect(scopedUserWhere('u1', { ownedOnly: true })).toEqual({ assignedToId: 'u1' });
  });
});

describe('canAgentReachConversation', () => {
  const prismaWith = (row: unknown) =>
    ({
      conversationParticipant: { findUnique: jest.fn().mockResolvedValue(row) },
    }) as any;

  it('dono passa sem consultar participantes', async () => {
    const prisma = prismaWith(null);
    await expect(
      canAgentReachConversation(prisma, { id: 'c1', assignedToId: 'u1' }, 'u1'),
    ).resolves.toBe(true);
    expect(prisma.conversationParticipant.findUnique).not.toHaveBeenCalled();
  });
  it('participante passa', async () => {
    const prisma = prismaWith({ id: 'p1' });
    await expect(
      canAgentReachConversation(prisma, { id: 'c1', assignedToId: 'u2' }, 'u1'),
    ).resolves.toBe(true);
    expect(prisma.conversationParticipant.findUnique).toHaveBeenCalledWith({
      where: { conversationId_userId: { conversationId: 'c1', userId: 'u1' } },
      select: { id: true },
    });
  });
  it('nem dono nem participante → false', async () => {
    await expect(
      canAgentReachConversation(prismaWith(null), { id: 'c1', assignedToId: 'u2' }, 'u1'),
    ).resolves.toBe(false);
  });
});

describe('agentScopeBlock', () => {
  it('Esperando: só a própria conversa esperando', () => {
    expect(agentScopeBlock('u1', true)).toEqual({
      assignedToId: 'u1',
      awaitingHumanReply: true,
    });
  });
  it('Caixa de entrada: própria respondida + compartilhadas em qualquer estado', () => {
    expect(agentScopeBlock('u1', false)).toEqual({
      OR: [
        { assignedToId: 'u1', awaitingHumanReply: false },
        { participants: { some: { userId: 'u1' } } },
      ],
    });
  });
  it('sem aba: dono ou incluído', () => {
    expect(agentScopeBlock('u1', undefined)).toEqual(scopedUserWhere('u1'));
  });
});
