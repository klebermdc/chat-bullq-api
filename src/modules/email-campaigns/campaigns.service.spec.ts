import { EmailCampaignStatus } from '@prisma/client';
import { CampaignsService } from './campaigns.service';

function makeFakeRepo() {
  const rows: any[] = [];
  let seq = 0;
  return {
    rows,
    findById: jest.fn(
      async (id: string, orgId: string) =>
        rows.find((r) => r.id === id && r.organizationId === orgId) ?? null,
    ),
    create: jest.fn(async (data: any) => {
      const row = { id: `camp_${++seq}`, status: EmailCampaignStatus.DRAFT, ...data };
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

const validDto = {
  name: 'Promo Universal',
  subject: 'Sentiu falta da magia?',
  content: { blocks: [{ type: 'text', text: 'Olá {{nome}}' }] },
  audienceFilter: {},
};

describe('CampaignsService', () => {
  it('cria em DRAFT registrando o autor', async () => {
    const repo = makeFakeRepo();
    const c = await new CampaignsService(repo as any).create('org_1', 'user_1', validDto as any);
    expect(c.status).toBe(EmailCampaignStatus.DRAFT);
    expect(c.createdById).toBe('user_1');
  });

  it('rejeita conteúdo inválido no SAVE, não no envio', async () => {
    const s = new CampaignsService(makeFakeRepo() as any);
    await expect(
      s.create('org_1', 'user_1', { ...validDto, content: { blocks: [] } } as any),
    ).rejects.toThrow(/pelo menos um bloco/);
  });

  it('rejeita assunto vazio', async () => {
    const s = new CampaignsService(makeFakeRepo() as any);
    await expect(
      s.create('org_1', 'user_1', { ...validDto, subject: '  ' } as any),
    ).rejects.toThrow(/assunto/i);
  });

  it('não deixa editar campanha que já saiu', async () => {
    const repo = makeFakeRepo();
    const s = new CampaignsService(repo as any);
    const c = await s.create('org_1', 'user_1', validDto as any);
    repo.rows[0].status = EmailCampaignStatus.SENT;
    await expect(s.update(c.id, 'org_1', validDto as any)).rejects.toThrow(/rascunho/i);
  });

  it('não encontra campanha de outra organização', async () => {
    const repo = makeFakeRepo();
    const s = new CampaignsService(repo as any);
    const c = await s.create('org_1', 'user_1', validDto as any);
    await expect(s.findOne(c.id, 'org_2')).rejects.toThrow(/não encontrada/i);
  });
});
