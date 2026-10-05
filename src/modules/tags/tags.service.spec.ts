import { TagsService } from './tags.service';

function makeService(existing: Array<{ id: string; name: string; organizationId: string }> = []) {
  const repository = {
    findByOrg: jest.fn().mockResolvedValue(existing),
    findById: jest.fn(async (id: string) => existing.find((t) => t.id === id) ?? null),
    create: jest.fn(async (data: unknown) => data),
    update: jest.fn(async (_id: string, data: unknown) => data),
  };
  const service = new TagsService(repository as never, {} as never, {} as never);
  return { service, repository };
}

describe('TagsService text color', () => {
  it('creates a tag with automatic text color when none is given', async () => {
    const { service, repository } = makeService();

    await service.create('org1', { name: 'VIP', color: '#ff0000' });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ color: '#ff0000', textColor: null }),
    );
  });

  it('stores the chosen text color on create', async () => {
    const { service, repository } = makeService();

    await service.create('org1', { name: 'VIP', color: '#ff0000', textColor: '#ffffff' });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ textColor: '#ffffff' }),
    );
  });

  it('leaves the text color untouched when the update does not mention it', async () => {
    const { service, repository } = makeService([{ id: 't1', name: 'VIP', organizationId: 'org1' }]);

    await service.update('t1', 'org1', { color: '#00ff00' });

    expect(repository.update).toHaveBeenCalledWith('t1', { color: '#00ff00' });
  });

  it('resets the text color to automatic when the update sends null', async () => {
    const { service, repository } = makeService([{ id: 't1', name: 'VIP', organizationId: 'org1' }]);

    await service.update('t1', 'org1', { textColor: null });

    expect(repository.update).toHaveBeenCalledWith('t1', { textColor: null });
  });
});
