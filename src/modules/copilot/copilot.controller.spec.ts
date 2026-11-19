import { OrgRole } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { FEATURE_KEY } from '../../common/decorators/feature.decorator';
import { can } from '../../common/rbac/feature-map';
import { CopilotController } from './copilot.controller';

describe('CopilotController', () => {
  it('restringe /copilot/ask a OWNER e ADMIN', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, CopilotController.prototype.ask);
    expect(roles).toEqual([OrgRole.OWNER, OrgRole.ADMIN]);
  });

  it('delega ao service com orgId, text e history', async () => {
    const copilot = { ask: jest.fn().mockResolvedValue({ reply: 'ok' }) };
    const controller = new CopilotController(copilot as any, {} as any);
    const dto = { text: 'oi', history: [{ role: 'user' as const, content: 'a' }] };
    const out = await controller.ask('org1', dto as any);
    expect(copilot.ask).toHaveBeenCalledWith('org1', 'oi', dto.history);
    expect(out).toEqual({ reply: 'ok' });
  });

  it('libera /copilot/consult para todos os logados, inclusive o vendedor', () => {
    const feature = Reflect.getMetadata(FEATURE_KEY, CopilotController.prototype.consult);
    expect(feature).toBe('copilot.view');
    expect(Reflect.getMetadata(ROLES_KEY, CopilotController.prototype.consult)).toBeUndefined();
    expect(can(OrgRole.AGENT, 'copilot.view')).toBe(true);
  });

  it('delega a consulta com o usuário e o papel dele', async () => {
    const consult = { consult: jest.fn().mockResolvedValue({ reply: 'ok', suggestion: null }) };
    const controller = new CopilotController({} as any, consult as any);
    const dto = { text: 'e o visto?', conversationId: 'c1', messageId: 'm1' };
    const out = await controller.consult('org1', 'u1', OrgRole.AGENT, dto as any);
    expect(consult.consult).toHaveBeenCalledWith('org1', { id: 'u1', role: OrgRole.AGENT }, dto);
    expect(out).toEqual({ reply: 'ok', suggestion: null });
  });
});
