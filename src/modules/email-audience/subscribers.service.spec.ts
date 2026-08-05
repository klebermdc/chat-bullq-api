import { NotFoundException } from '@nestjs/common';
import { EmailSubscriberSource, EmailSubscriberStatus } from '@prisma/client';
import { SubscribersService } from './subscribers.service';

function makeFakeRepo() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findById: jest.fn(
      async (id: string, organizationId: string) =>
        rows.find((r) => r.id === id && r.organizationId === organizationId) ?? null,
    ),
    findByIdUnscoped: jest.fn(async (id: string) => rows.find((r) => r.id === id) ?? null),
    findByEmail: jest.fn(
      async (orgId: string, email: string) =>
        rows.find((r) => r.organizationId === orgId && r.email === email) ?? null,
    ),
    create: jest.fn(async (data: any) => {
      const row = {
        id: `sub_${++seq}`,
        status: EmailSubscriberStatus.SUBSCRIBED,
        name: null,
        contactId: null,
        consentSource: null,
        ...data,
      };
      rows.push(row);
      return row;
    }),
    update: jest.fn(async (id: string, data: any) => {
      const row = rows.find((r) => r.id === id);
      Object.assign(row, data);
      return row;
    }),
  };
}

describe('SubscribersService', () => {
  it('cria normalizando o endereço', async () => {
    const repo = makeFakeRepo();
    const sub = await new SubscribersService(repo as any).upsert('org_1', {
      email: '  Joao@Exemplo.COM ',
      name: 'João',
      source: EmailSubscriberSource.CRM_CONTACT,
    });
    expect(sub.email).toBe('joao@exemplo.com');
  });

  it('não duplica quando o mesmo endereço vem de outra fonte', async () => {
    const repo = makeFakeRepo();
    const s = new SubscribersService(repo as any);
    await s.upsert('org_1', { email: 'joao@exemplo.com', source: EmailSubscriberSource.CRM_CONTACT });
    await s.upsert('org_1', { email: 'JOAO@exemplo.com', source: EmailSubscriberSource.OFP_ORDER });
    expect(repo.rows).toHaveLength(1);
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it('preenche nome vazio mas nunca sobrescreve nome existente', async () => {
    const repo = makeFakeRepo();
    const s = new SubscribersService(repo as any);
    await s.upsert('org_1', { email: 'j@e.com', source: EmailSubscriberSource.CSV_IMPORT });
    await s.upsert('org_1', { email: 'j@e.com', name: 'João', source: EmailSubscriberSource.OFP_ORDER });
    expect(repo.rows[0].name).toBe('João');
    await s.upsert('org_1', { email: 'j@e.com', name: 'Outro', source: EmailSubscriberSource.CSV_IMPORT });
    expect(repo.rows[0].name).toBe('João');
  });

  it('NUNCA ressuscita quem descadastrou', async () => {
    const repo = makeFakeRepo();
    const s = new SubscribersService(repo as any);
    const sub = await s.upsert('org_1', { email: 'j@e.com', source: EmailSubscriberSource.CRM_CONTACT });
    await s.unsubscribe(sub.id, 'org_1', 'clicou no link');
    const again = await s.upsert('org_1', { email: 'j@e.com', source: EmailSubscriberSource.CSV_IMPORT });
    expect(again.status).toBe(EmailSubscriberStatus.UNSUBSCRIBED);
  });

  it('não descadastra destinatário de outra organização (IDOR)', async () => {
    const repo = makeFakeRepo();
    const s = new SubscribersService(repo as any);
    const sub = await s.upsert('org_A', { email: 'a@e.com', source: EmailSubscriberSource.MANUAL });

    await expect(
      s.unsubscribe(sub.id, 'org_B', 'descadastro manual pelo operador'),
    ).rejects.toBeInstanceOf(NotFoundException);

    const stillThere = await repo.findById(sub.id, 'org_A');
    expect(stillThere.status).toBe(EmailSubscriberStatus.SUBSCRIBED);
  });

  it('não suprime (bounce/spam) assinante de outra organização', async () => {
    const repo = makeFakeRepo();
    const s = new SubscribersService(repo as any);
    const sub = await s.upsert('org_A', { email: 'a@e.com', source: EmailSubscriberSource.MANUAL });

    const result = await s.suppress(sub.id, 'org_B', EmailSubscriberStatus.BOUNCED, 'bounce permanente');

    expect(result).toBeUndefined();
    const stillThere = await repo.findById(sub.id, 'org_A');
    expect(stillThere.status).toBe(EmailSubscriberStatus.SUBSCRIBED);
  });

  it('rejeita endereço inválido', async () => {
    const s = new SubscribersService(makeFakeRepo() as any);
    await expect(
      s.upsert('org_1', { email: 'sem-arroba', source: EmailSubscriberSource.MANUAL }),
    ).rejects.toThrow(/inválido/);
  });

  it('descadastro grava data e motivo, e repetir não reescreve a data', async () => {
    const repo = makeFakeRepo();
    const s = new SubscribersService(repo as any);
    const sub = await s.upsert('org_1', { email: 'j@e.com', source: EmailSubscriberSource.MANUAL });
    const first = await s.unsubscribe(sub.id, 'org_1', 'clicou');
    expect(first.status).toBe(EmailSubscriberStatus.UNSUBSCRIBED);
    expect(first.unsubscribedAt).toBeInstanceOf(Date);
    const second = await s.unsubscribe(sub.id, 'org_1', 'clicou de novo');
    expect(second.unsubscribedAt).toEqual(first.unsubscribedAt);
    expect(second.suppressedReason).toBe('clicou');
  });
});
