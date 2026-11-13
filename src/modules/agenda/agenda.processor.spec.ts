import { AgendaReminderProcessor } from './agenda.processor';

const sp = (iso: string) => new Date(`${iso}-03:00`);
const STARTS = sp('2026-11-16T15:00:00');

function make(appt: any) {
  const repo = {
    findForReminder: jest.fn().mockResolvedValue(appt),
    ownerSchedule: jest.fn().mockResolvedValue({ tz: 'America/Sao_Paulo', hours: null }),
  } as any;
  const notifications = { notify: jest.fn().mockResolvedValue({}) } as any;
  return { proc: new AgendaReminderProcessor(repo, notifications), notifications };
}

const job = (stage: 'antes' | 'agora') =>
  ({ data: { appointmentId: 'a1', organizationId: 'org1', stage, startsAt: STARTS.getTime() } }) as any;

describe('AgendaReminderProcessor', () => {
  it('avisa o vendedor dono quando o compromisso continua marcado no mesmo horário', async () => {
    const { proc, notifications } = make({
      status: 'MARCADO', startsAt: STARTS, ownerUserId: 'renata', conversationId: 'cv1', contactId: 'c1', contact: { name: 'Kleber' },
    });
    await expect(proc.process(job('antes'))).resolves.toEqual({ delivered: true });
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'renata',
        organizationId: 'org1',
        type: 'SYSTEM',
        title: 'Retorno em 10 min: Kleber',
        data: expect.objectContaining({ kind: 'AGENDA_LEMBRETE', appointmentId: 'a1', conversationId: 'cv1' }),
      }),
    );
  });

  it('descarta lembrete de compromisso cancelado, remarcado ou apagado', async () => {
    for (const appt of [
      { status: 'CANCELADO', startsAt: STARTS, ownerUserId: 'renata' },
      { status: 'MARCADO', startsAt: sp('2026-11-16T16:00:00'), ownerUserId: 'renata' },
      null,
    ]) {
      const { proc, notifications } = make(appt);
      await expect(proc.process(job('agora'))).resolves.toEqual({ delivered: false });
      expect(notifications.notify).not.toHaveBeenCalled();
    }
  });
});
