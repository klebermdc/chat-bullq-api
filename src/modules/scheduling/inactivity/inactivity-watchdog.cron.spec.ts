import { InactivityWatchdogCron } from './inactivity-watchdog.cron';

function makeCron(cfg: any, candidates: any[]) {
  const queue = { add: jest.fn(async () => ({})) };
  const repo = {
    scanCandidates: jest.fn(async () => candidates),
    setBandBulk: jest.fn(async () => ({})),
  };
  const settingsRepo = { listEnabledOrgIds: jest.fn(async () => [{ organizationId: 'org1' }]) };
  const settings = { get: jest.fn(async () => cfg) };
  const realtime = { emitToConversation: jest.fn() };
  const autoReengage = { maybeCreate: jest.fn(async () => undefined) };
  const cron = new InactivityWatchdogCron(
    queue as any, repo as any, settingsRepo as any, settings as any,
    realtime as any, autoReengage as any,
  );
  return { cron, autoReengage };
}

const baseCfg = {
  enabled: true, autoReengage: true, reengageFromBand: 0, bandsDays: [1, 3, 7],
  reengageOnlyAiParked: false,
};
// band computada >= reengageFromBand: conversa silenciada há muito, bola com o cliente.
const parked = {
  id: 'c1', assignedToId: null, awaitingHumanReply: false, aiEnabled: null,
  inactivityBand: 0, lastInboundAt: null,
  lastOutboundAt: new Date(Date.now() - 30 * 864e5),
  contactId: 'ct1', channelId: 'ch1', reengageDismissedAt: null, reengagedAt: null,
};
const withHuman = { ...parked, id: 'c2', assignedToId: 'u1' };

describe('InactivityWatchdogCron — recorte AI-parked', () => {
  it('com toggle OFF: chama maybeCreate mesmo para lead com humano (comportamento atual)', async () => {
    const { cron, autoReengage } = makeCron(baseCfg, [withHuman]);
    await cron.process({} as any);
    expect(autoReengage.maybeCreate).toHaveBeenCalled();
  });

  it('com toggle ON: pula lead com humano e mantém lead parado na IA', async () => {
    const { cron, autoReengage } = makeCron(
      { ...baseCfg, reengageOnlyAiParked: true }, [parked, withHuman],
    );
    await cron.process({} as any);
    const ids = autoReengage.maybeCreate.mock.calls.map((c: any[]) => c[1].id);
    expect(ids).toContain('c1');
    expect(ids).not.toContain('c2');
  });
});
