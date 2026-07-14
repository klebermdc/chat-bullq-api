import { OrgRole } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { CopilotController } from './copilot.controller';

describe('CopilotController', () => {
  it('restringe /copilot/ask a OWNER e ADMIN', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, CopilotController.prototype.ask);
    expect(roles).toEqual([OrgRole.OWNER, OrgRole.ADMIN]);
  });

  it('delega ao service com orgId, text e history', async () => {
    const copilot = { ask: jest.fn().mockResolvedValue({ reply: 'ok' }) };
    const controller = new CopilotController(copilot as any);
    const dto = { text: 'oi', history: [{ role: 'user' as const, content: 'a' }] };
    const out = await controller.ask('org1', dto as any);
    expect(copilot.ask).toHaveBeenCalledWith('org1', 'oi', dto.history);
    expect(out).toEqual({ reply: 'ok' });
  });
});
