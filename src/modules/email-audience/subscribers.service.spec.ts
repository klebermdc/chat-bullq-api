import { NotFoundException } from '@nestjs/common';
import { EmailSubscriberSource, EmailSubscriberStatus } from '@prisma/client';
import { SubscribersService } from './subscribers.service';

function makeFakeRepo() {
  const rows: any[] = [];
  const tagJoins: { subscriberId: string; tagId: string }[] = [];
  let seq = 0;
  return {
    rows,
    tagJoins,
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
    list: jest.fn(async (organizationId: string) => {
      const items = rows
        .filter((r) => r.organizationId === organizationId)
        .map((r) => ({
          ...r,
          tags: tagJoins
            .filter((j) => j.subscriberId === r.id)
            .map((j) => ({ subscriberId: j.subscriberId, tagId: j.tagId, tag: { id: j.tagId } })),
        }));
      return [items, items.length];
    }),
    addTag: jest.fn(async (subscriberId: string, tagId: string) => {
      if (!tagJoins.some((j) => j.subscriberId === subscriberId && j.tagId === tagId)) {
        tagJoins.push({ subscriberId, tagId });
      }
    }),
    removeTag: jest.fn(async (subscriberId: string, tagId: string) => {
      const i = tagJoins.findIndex((j) => j.subscriberId === subscriberId && j.tagId === tagId);
      if (i >= 0) tagJoins.splice(i, 1);
    }),
  };
}

/** Fake mínimo de `TagsService.findOne` — só o que `addTag`/`removeTag` usam. */
function makeFakeTags(tagsByOrg: Record<string, string[]> = {}) {
  return {
    findOne: jest.fn(async (id: string, organizationId: string) => {
      if (!tagsByOrg[organizationId]?.includes(id)) {
        throw new NotFoundException('Tag not found');
      }
      return { id, organizationId, name: 'etiqueta', color: '#000' };
    }),
  };
}

function makeService(repo = makeFakeRepo(), tags = makeFakeTags({ org_1: ['tag_1'], org_A: ['tag_1'] })) {
  return { s: new SubscribersService(repo as any, tags as any), repo, tags };
}

describe('SubscribersService', () => {
  it('cria normalizando o endereço', async () => {
    const { s } = makeService();
    const sub = await s.upsert('org_1', {
      email: '  Joao@Exemplo.COM ',
      name: 'João',
      source: EmailSubscriberSource.CRM_CONTACT,
    });
    expect(sub.email).toBe('joao@exemplo.com');
  });

  it('não duplica quando o mesmo endereço vem de outra fonte', async () => {
    const { s, repo } = makeService();
    await s.upsert('org_1', { email: 'joao@exemplo.com', source: EmailSubscriberSource.CRM_CONTACT });
    await s.upsert('org_1', { email: 'JOAO@exemplo.com', source: EmailSubscriberSource.OFP_ORDER });
    expect(repo.rows).toHaveLength(1);
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it('preenche nome vazio mas nunca sobrescreve nome existente', async () => {
    const { s, repo } = makeService();
    await s.upsert('org_1', { email: 'j@e.com', source: EmailSubscriberSource.CSV_IMPORT });
    await s.upsert('org_1', { email: 'j@e.com', name: 'João', source: EmailSubscriberSource.OFP_ORDER });
    expect(repo.rows[0].name).toBe('João');
    await s.upsert('org_1', { email: 'j@e.com', name: 'Outro', source: EmailSubscriberSource.CSV_IMPORT });
    expect(repo.rows[0].name).toBe('João');
  });

  it('NUNCA ressuscita quem descadastrou', async () => {
    const { s } = makeService();
    const sub = await s.upsert('org_1', { email: 'j@e.com', source: EmailSubscriberSource.CRM_CONTACT });
    await s.unsubscribe(sub.id, 'org_1', 'clicou no link');
    const again = await s.upsert('org_1', { email: 'j@e.com', source: EmailSubscriberSource.CSV_IMPORT });
    expect(again.status).toBe(EmailSubscriberStatus.UNSUBSCRIBED);
  });

  it('não descadastra destinatário de outra organização (IDOR)', async () => {
    const { s, repo } = makeService();
    const sub = await s.upsert('org_A', { email: 'a@e.com', source: EmailSubscriberSource.MANUAL });

    await expect(
      s.unsubscribe(sub.id, 'org_B', 'descadastro manual pelo operador'),
    ).rejects.toBeInstanceOf(NotFoundException);

    const stillThere = await repo.findById(sub.id, 'org_A');
    expect(stillThere.status).toBe(EmailSubscriberStatus.SUBSCRIBED);
  });

  it('não suprime (bounce/spam) assinante de outra organização', async () => {
    const { s, repo } = makeService();
    const sub = await s.upsert('org_A', { email: 'a@e.com', source: EmailSubscriberSource.MANUAL });

    const result = await s.suppress(sub.id, 'org_B', EmailSubscriberStatus.BOUNCED, 'bounce permanente');

    expect(result).toBeUndefined();
    const stillThere = await repo.findById(sub.id, 'org_A');
    expect(stillThere.status).toBe(EmailSubscriberStatus.SUBSCRIBED);
  });

  it('rejeita endereço inválido', async () => {
    const { s } = makeService();
    await expect(
      s.upsert('org_1', { email: 'sem-arroba', source: EmailSubscriberSource.MANUAL }),
    ).rejects.toThrow(/inválido/);
  });

  it('descadastro grava data e motivo, e repetir não reescreve a data', async () => {
    const { s } = makeService();
    const sub = await s.upsert('org_1', { email: 'j@e.com', source: EmailSubscriberSource.MANUAL });
    const first = await s.unsubscribe(sub.id, 'org_1', 'clicou');
    expect(first.status).toBe(EmailSubscriberStatus.UNSUBSCRIBED);
    expect(first.unsubscribedAt).toBeInstanceOf(Date);
    const second = await s.unsubscribe(sub.id, 'org_1', 'clicou de novo');
    expect(second.unsubscribedAt).toEqual(first.unsubscribedAt);
    expect(second.suppressedReason).toBe('clicou');
  });

  it('enriquecimento SEMPRE sobrescreve os campos derivados, mesmo já preenchidos', async () => {
    const { s } = makeService();
    const sub = await s.upsert('org_1', {
      email: 'j@e.com',
      source: EmailSubscriberSource.OFP_ORDER,
      enrichment: {
        firstPurchaseAt: new Date('2026-01-01'),
        lastPurchaseAt: new Date('2026-01-01'),
        totalSpent: 100,
        orderCount: 1,
        categories: ['ingresso'],
        suppliers: ['just travel'],
      },
    });
    expect(sub.orderCount).toBe(1);
    expect(sub.enrichedAt).toBeInstanceOf(Date);

    const updated = await s.upsert('org_1', {
      email: 'j@e.com',
      source: EmailSubscriberSource.OFP_ORDER,
      enrichment: {
        firstPurchaseAt: new Date('2025-01-01'),
        lastPurchaseAt: new Date('2026-06-01'),
        totalSpent: 900,
        orderCount: 9,
        categories: ['ingresso', 'hotel'],
        suppliers: ['just travel', 'ofp'],
      },
    });
    expect(updated.orderCount).toBe(9);
    expect(updated.totalSpent).toBe(900);
    expect(updated.categories).toEqual(['ingresso', 'hotel']);
    expect(updated.lastPurchaseAt).toEqual(new Date('2026-06-01'));
  });

  it('enriquecer NUNCA toca em status — quem descadastrou continua fora', async () => {
    const { s } = makeService();
    const sub = await s.upsert('org_1', { email: 'j@e.com', source: EmailSubscriberSource.MANUAL });
    await s.unsubscribe(sub.id, 'org_1', 'clicou');

    const reenriched = await s.upsert('org_1', {
      email: 'j@e.com',
      source: EmailSubscriberSource.OFP_ORDER,
      enrichment: {
        firstPurchaseAt: new Date('2026-01-01'),
        lastPurchaseAt: new Date('2026-01-01'),
        totalSpent: 500,
        orderCount: 3,
        categories: ['hotel'],
        suppliers: [],
      },
    });
    expect(reenriched.status).toBe(EmailSubscriberStatus.UNSUBSCRIBED);
    expect(reenriched.orderCount).toBe(3);
    expect(reenriched.totalSpent).toBe(500);
  });

  describe('list', () => {
    it('achata a junção de etiquetas em Tag[]', async () => {
      const { s, repo } = makeService();
      const sub = await s.upsert('org_1', { email: 'j@e.com', source: EmailSubscriberSource.MANUAL });
      await s.addTag(sub.id, 'org_1', 'tag_1');

      const [items] = await s.list('org_1');

      expect(items[0].tags).toEqual([{ id: 'tag_1' }]);
      expect((items[0] as any).tags[0].tagId).toBeUndefined(); // não vaza a linha de junção crua
    });
  });

  describe('addTag / removeTag', () => {
    it('etiqueta o destinatário quando ele e a etiqueta são da mesma organização', async () => {
      const { s, repo } = makeService();
      const sub = await s.upsert('org_1', { email: 'j@e.com', source: EmailSubscriberSource.MANUAL });

      await s.addTag(sub.id, 'org_1', 'tag_1');

      expect(repo.addTag).toHaveBeenCalledWith(sub.id, 'tag_1');
    });

    it('NÃO etiqueta destinatário de outra organização (IDOR)', async () => {
      const { s, repo } = makeService();
      const sub = await s.upsert('org_A', { email: 'a@e.com', source: EmailSubscriberSource.MANUAL });

      // org_B tenta aplicar sua própria etiqueta a um destinatário de org_A,
      // só sabendo o id — exatamente a classe de ataque do IDOR do descadastro.
      await expect(s.addTag(sub.id, 'org_B', 'tag_1')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.addTag).not.toHaveBeenCalled();
    });

    it('NÃO aplica etiqueta que pertence a outra organização, mesmo ao destinatário certo', async () => {
      const { s, repo, tags } = makeService();
      const sub = await s.upsert('org_1', { email: 'j@e.com', source: EmailSubscriberSource.MANUAL });

      // tag_1 só existe em org_1/org_A no fake — 'tag_de_outra_org' não está
      // registrada para org_1, simulando uma etiqueta de outro tenant.
      await expect(s.addTag(sub.id, 'org_1', 'tag_de_outra_org')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.addTag).not.toHaveBeenCalled();
      expect(tags.findOne).toHaveBeenCalledWith('tag_de_outra_org', 'org_1');
    });

    it('remove a etiqueta quando destinatário e etiqueta são da organização certa', async () => {
      const { s, repo } = makeService();
      const sub = await s.upsert('org_1', { email: 'j@e.com', source: EmailSubscriberSource.MANUAL });
      await s.addTag(sub.id, 'org_1', 'tag_1');

      await s.removeTag(sub.id, 'org_1', 'tag_1');

      expect(repo.removeTag).toHaveBeenCalledWith(sub.id, 'tag_1');
    });

    it('NÃO remove etiqueta de destinatário de outra organização (IDOR)', async () => {
      const { s, repo } = makeService();
      const sub = await s.upsert('org_A', { email: 'a@e.com', source: EmailSubscriberSource.MANUAL });
      await s.addTag(sub.id, 'org_A', 'tag_1');

      await expect(s.removeTag(sub.id, 'org_B', 'tag_1')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.removeTag).not.toHaveBeenCalled();
    });
  });
});
