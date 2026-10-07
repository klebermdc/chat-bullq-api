import { syncAttendantTag } from './sync-attendant-tag';
import { DEFAULT_TAG_COLOR } from './attendant-tag-color.util';

function makeDb(tagColor = '#DC2626') {
  const usersById: Record<string, { name: string | null }> = {
    'u-renata': { name: ' Renata ' },
    'u-barbara': { name: 'Bárbara' },
    'u-noname': { name: '' },
  };
  return {
    user: {
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(usersById[where.id] ?? null),
      ),
    },
    conversationTag: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    contactTag: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    tag: {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: 'tag-renata', color: tagColor }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
}

const base = {
  conversationId: 'conv1',
  contactId: 'contact1',
  organizationId: 'org1',
};

describe('syncAttendantTag', () => {
  it('põe a tag do novo atendente (nome aparado) na conversa e na ficha', async () => {
    const db = makeDb();

    await syncAttendantTag(db as any, {
      ...base,
      fromAssigneeId: null,
      toAssigneeId: 'u-renata',
    });

    expect(db.tag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_name: { organizationId: 'org1', name: 'Renata' } },
      }),
    );
    expect(db.conversationTag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { conversationId: 'conv1', tagId: 'tag-renata' },
      }),
    );
    expect(db.contactTag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { contactId: 'contact1', tagId: 'tag-renata' },
      }),
    );
    expect(db.conversationTag.deleteMany).not.toHaveBeenCalled();
  });

  it('tira a tag do atendente anterior ao trocar', async () => {
    const db = makeDb();

    await syncAttendantTag(db as any, {
      ...base,
      fromAssigneeId: 'u-barbara',
      toAssigneeId: 'u-renata',
    });

    expect(db.conversationTag.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv1', tag: { organizationId: 'org1', name: { equals: 'Bárbara', mode: 'insensitive' } } },
    });
    expect(db.contactTag.deleteMany).toHaveBeenCalledWith({
      where: { contactId: 'contact1', tag: { organizationId: 'org1', name: { equals: 'Bárbara', mode: 'insensitive' } } },
    });
  });

  it('mesmo atendente: não remove nada, só garante a tag', async () => {
    const db = makeDb();

    await syncAttendantTag(db as any, {
      ...base,
      fromAssigneeId: 'u-renata',
      toAssigneeId: 'u-renata',
    });

    expect(db.conversationTag.deleteMany).not.toHaveBeenCalled();
    expect(db.conversationTag.upsert).toHaveBeenCalled();
  });

  it('recolore só selo no cinza padrão', async () => {
    const db = makeDb(DEFAULT_TAG_COLOR);

    await syncAttendantTag(db as any, {
      ...base,
      fromAssigneeId: null,
      toAssigneeId: 'u-renata',
    });

    expect(db.tag.update).toHaveBeenCalled();
  });

  it('atendente sem nome não cria tag vazia', async () => {
    const db = makeDb();

    await syncAttendantTag(db as any, {
      ...base,
      fromAssigneeId: null,
      toAssigneeId: 'u-noname',
    });

    expect(db.tag.upsert).not.toHaveBeenCalled();
  });

  it('reaproveita a tag que já existe com o mesmo nome em outra caixa, sem criar outra', async () => {
    const db = makeDb();
    db.tag.findFirst.mockResolvedValue({ id: 'tag-RENATA', color: '#ef4444' });

    await syncAttendantTag(db as any, {
      ...base,
      fromAssigneeId: null,
      toAssigneeId: 'u-renata',
    });

    expect(db.tag.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org1',
          name: { equals: 'Renata', mode: 'insensitive' },
        },
      }),
    );
    expect(db.tag.upsert).not.toHaveBeenCalled();
    expect(db.conversationTag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { conversationId: 'conv1', tagId: 'tag-RENATA' },
      }),
    );
  });

  it('tira a tag do atendente anterior sem diferenciar maiúsculas', async () => {
    const db = makeDb();

    await syncAttendantTag(db as any, {
      ...base,
      fromAssigneeId: 'u-barbara',
      toAssigneeId: 'u-renata',
    });

    const previousTag = {
      organizationId: 'org1',
      name: { equals: 'Bárbara', mode: 'insensitive' },
    };
    expect(db.conversationTag.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv1', tag: previousTag },
    });
    expect(db.contactTag.deleteMany).toHaveBeenCalledWith({
      where: { contactId: 'contact1', tag: previousTag },
    });
  });
});
