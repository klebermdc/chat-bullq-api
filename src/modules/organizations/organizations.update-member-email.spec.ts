import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { OrganizationsService } from './organizations.service';

function make(opts: { membership?: any; existingUser?: any } = {}) {
  const repository = {
    findMembership: jest.fn().mockResolvedValue(
      opts.membership === undefined
        ? { id: 'm1', userId: 'u-renata', role: OrgRole.OWNER }
        : opts.membership,
    ),
    findUserByEmail: jest.fn().mockResolvedValue(opts.existingUser ?? null),
    updateUserEmail: jest
      .fn()
      .mockResolvedValue({ id: 'u-renata', email: 'contato@orlandofastpass.com.br' }),
  } as any;
  const service = new OrganizationsService(repository);
  return { service, repository };
}

const NEW = 'contato@orlandofastpass.com.br';

describe('OrganizationsService.updateMemberEmail', () => {
  it('OWNER pode trocar o e-mail de outro OWNER', async () => {
    const { service, repository } = make();
    const res = await service.updateMemberEmail('org1', 'm1', { email: NEW }, OrgRole.OWNER);

    expect(repository.updateUserEmail).toHaveBeenCalledWith('u-renata', NEW);
    expect(res).toMatchObject({ email: NEW });
  });

  // Diferente do reset de senha (que blinda OWNER de todo mundo): trocar
  // e-mail de dono é operação legítima de dono. Só ADMIN é que não alcança.
  it('ADMIN não pode trocar o e-mail de um OWNER', async () => {
    const { service, repository } = make();
    await expect(
      service.updateMemberEmail('org1', 'm1', { email: NEW }, OrgRole.ADMIN),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.updateUserEmail).not.toHaveBeenCalled();
  });

  it('ADMIN não pode trocar o e-mail de outro ADMIN', async () => {
    const { service, repository } = make({
      membership: { id: 'm2', userId: 'u2', role: OrgRole.ADMIN },
    });
    await expect(
      service.updateMemberEmail('org1', 'm2', { email: NEW }, OrgRole.ADMIN),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.updateUserEmail).not.toHaveBeenCalled();
  });

  it('ADMIN pode trocar o e-mail de um AGENT', async () => {
    const { service, repository } = make({
      membership: { id: 'm3', userId: 'u3', role: OrgRole.AGENT },
    });
    await service.updateMemberEmail('org1', 'm3', { email: NEW }, OrgRole.ADMIN);
    expect(repository.updateUserEmail).toHaveBeenCalledWith('u3', NEW);
  });

  // O banco tem unique em User.email — sem esta checagem o admin recebe
  // um P2002 cru ("Unique constraint failed"), que não diz nada a quem
  // está na tela de Membros.
  it('e-mail já usado por OUTRO usuário devolve 409 com mensagem clara', async () => {
    const { service, repository } = make({ existingUser: { id: 'u-outro', email: NEW } });
    await expect(
      service.updateMemberEmail('org1', 'm1', { email: NEW }, OrgRole.OWNER),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.updateUserEmail).not.toHaveBeenCalled();
  });

  it('e-mail já é o do próprio membro → no-op, sem erro', async () => {
    const { service, repository } = make({ existingUser: { id: 'u-renata', email: NEW } });
    const res = await service.updateMemberEmail('org1', 'm1', { email: NEW }, OrgRole.OWNER);

    expect(repository.updateUserEmail).not.toHaveBeenCalled();
    expect(res).toMatchObject({ email: NEW });
  });

  it('membro inexistente devolve 404', async () => {
    const { service } = make({ membership: null });
    await expect(
      service.updateMemberEmail('org1', 'nope', { email: NEW }, OrgRole.OWNER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
