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
      where: { conversationId: 'conv1', tag: { organizationId: 'org1', name: 'Bárbara' } },
    });
    expect(db.contactTag.deleteMany).toHaveBeenCalledWith({
      where: { contactId: 'contact1', tag: { organizationId: 'org1', name: 'Bárbara' } },
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
});
