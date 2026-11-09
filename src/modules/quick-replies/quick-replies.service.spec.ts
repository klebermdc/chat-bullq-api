import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { QuickRepliesService, normalizeShortcut } from './quick-replies.service';

describe('normalizeShortcut', () => {
  it('tira a barra, espaços e deixa minúsculo', () => {
    expect(normalizeShortcut(' /Boas-Vindas ')).toBe('boas-vindas');
  });
  it('recusa atalho vazio ou com caractere inválido', () => {
    expect(() => normalizeShortcut('/')).toThrow(BadRequestException);
    expect(() => normalizeShortcut('olá mundo')).toThrow(BadRequestException);
  });
});

const ADMIN = { userId: 'adm', role: OrgRole.ADMIN };
const AGENT = { userId: 'u3', role: OrgRole.AGENT };

describe('QuickRepliesService', () => {
  function make(opts: { existing?: any; byShortcut?: any; isMember?: boolean } = {}) {
    const repo = {
      findVisible: jest.fn().mockResolvedValue([]),
      isMember: jest.fn().mockResolvedValue(opts.isMember ?? true),
      findByShortcut: jest.fn().mockResolvedValue(opts.byShortcut ?? null),
      findById: jest.fn().mockResolvedValue(opts.existing ?? null),
      create: jest.fn().mockImplementation(async (d: any) => ({ id: 'q1', ...d })),
      update: jest.fn().mockResolvedValue({}),
      softDelete: jest.fn().mockResolvedValue({}),
    } as any;
    return { svc: new QuickRepliesService(repo), repo };
  }

  it('grava o atalho normalizado', async () => {
    const { svc, repo } = make();
    await svc.create('org1', { shortcut: '/Pix', title: 'Pix', content: 'Chave: x' }, ADMIN);
    expect(repo.findByShortcut).toHaveBeenCalledWith('org1', 'pix');
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ shortcut: 'pix' }));
  });

  it('recusa atalho repetido com 409', async () => {
    const { svc } = make({ byShortcut: { id: 'outro' } });
    await expect(svc.create('org1', { shortcut: 'pix', title: 'Pix', content: 'x' }, ADMIN)).rejects.toBeInstanceOf(ConflictException);
  });

  // O índice único (org, atalho) inclui as apagadas: sem liberar o atalho,
  // recriar "/pix" depois de apagar dava 500.
  it('apagar libera o atalho para ser reusado', async () => {
    const { svc, repo } = make({ existing: { id: 'q1', organizationId: 'org1', shortcut: 'pix' } });
    await svc.remove('q1', 'org1', ADMIN);
    expect(repo.softDelete).toHaveBeenCalledWith('q1', 'pix');
  });

  describe('visibilidade por vendedor', () => {
    it('dono e admin listam todas as mensagens da organização', async () => {
      const { svc, repo } = make();
      await svc.findAll('org1', { userId: 'u1', role: OrgRole.OWNER });
      await svc.findAll('org1', { userId: 'u2', role: OrgRole.ADMIN });
      expect(repo.findVisible).toHaveBeenNthCalledWith(1, 'org1', null);
      expect(repo.findVisible).toHaveBeenNthCalledWith(2, 'org1', null);
    });

    it('atendente lista só as da equipe e as próprias', async () => {
      const { svc, repo } = make();
      await svc.findAll('org1', { userId: 'u3', role: OrgRole.AGENT });
      expect(repo.findVisible).toHaveBeenCalledWith('org1', 'u3');
    });

    it('atendente não abre a mensagem de outro vendedor', async () => {
      const { svc } = make({ existing: { id: 'q1', organizationId: 'org1', ownerUserId: 'outro' } });
      await expect(svc.findOneVisible('q1', 'org1', { userId: 'u3', role: OrgRole.AGENT })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('atendente abre a própria e a da equipe; admin abre qualquer uma', async () => {
      const own = make({ existing: { id: 'q1', organizationId: 'org1', ownerUserId: 'u3' } });
      const shared = make({ existing: { id: 'q2', organizationId: 'org1', ownerUserId: null } });
      const other = make({ existing: { id: 'q3', organizationId: 'org1', ownerUserId: 'outro' } });
      await expect(own.svc.findOneVisible('q1', 'org1', { userId: 'u3', role: OrgRole.AGENT })).resolves.toBeTruthy();
      await expect(shared.svc.findOneVisible('q2', 'org1', { userId: 'u3', role: OrgRole.AGENT })).resolves.toBeTruthy();
      await expect(other.svc.findOneVisible('q3', 'org1', { userId: 'u9', role: OrgRole.ADMIN })).resolves.toBeTruthy();
    });

    it('grava o vendedor escolhido quando ele é da organização', async () => {
      const { svc, repo } = make();
      await svc.create('org1', { shortcut: 'pix', title: 'Pix', content: 'x', ownerUserId: 'u3' }, ADMIN);
      expect(repo.isMember).toHaveBeenCalledWith('org1', 'u3');
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ owner: { connect: { id: 'u3' } } }));
    });

    it('sem vendedor a mensagem fica para toda a equipe', async () => {
      const { svc, repo } = make();
      await svc.create('org1', { shortcut: 'pix', title: 'Pix', content: 'x' }, ADMIN);
      expect(repo.isMember).not.toHaveBeenCalled();
      expect(repo.create.mock.calls[0][0].owner).toBeUndefined();
    });

    it('recusa vendedor que não é da organização', async () => {
      const { svc } = make({ isMember: false });
      await expect(
        svc.create('org1', { shortcut: 'pix', title: 'Pix', content: 'x', ownerUserId: 'fora' }, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('editar com vendedor nulo devolve a mensagem para toda a equipe', async () => {
      const { svc, repo } = make({ existing: { id: 'q1', organizationId: 'org1', ownerUserId: 'u3' } });
      await svc.update('q1', 'org1', { ownerUserId: null }, ADMIN);
      expect(repo.update).toHaveBeenCalledWith('q1', { owner: { disconnect: true } });
    });

    it('editar sem mexer no vendedor mantém o dono', async () => {
      const { svc, repo } = make({ existing: { id: 'q1', organizationId: 'org1', ownerUserId: 'u3' } });
      await svc.update('q1', 'org1', { title: 'Novo' }, ADMIN);
      expect(repo.update).toHaveBeenCalledWith('q1', { title: 'Novo' });
    });
  });

  describe('categoria', () => {
    it('grava a categoria sem espaços nas pontas', async () => {
      const { svc, repo } = make();
      await svc.create('org1', { shortcut: 'pix', title: 'Pix', content: 'x', category: '  Pagamento ' }, ADMIN);
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ category: 'Pagamento' }));
    });

    it('categoria vazia ou ausente fica nula', async () => {
      const { svc, repo } = make();
      await svc.create('org1', { shortcut: 'pix', title: 'Pix', content: 'x', category: '   ' }, ADMIN);
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ category: null }));
      await svc.create('org1', { shortcut: 'pix2', title: 'Pix', content: 'x' }, ADMIN);
      expect(repo.create).toHaveBeenLastCalledWith(expect.objectContaining({ category: null }));
    });

    it('editar com categoria vazia limpa; sem categoria não mexe', async () => {
      const existing = { id: 'q1', organizationId: 'org1', ownerUserId: null };
      const { svc, repo } = make({ existing });
      await svc.update('q1', 'org1', { category: '' }, ADMIN);
      expect(repo.update).toHaveBeenLastCalledWith('q1', { category: null });
      await svc.update('q1', 'org1', { category: 'Disney' }, ADMIN);
      expect(repo.update).toHaveBeenLastCalledWith('q1', { category: 'Disney' });
    });
  });

  describe('atendente cria, edita e exclui só as dele', () => {
    it('mensagem criada pelo atendente fica só para ele, mesmo pedindo outro dono ou a equipe', async () => {
      const { svc, repo } = make();
      await svc.create('org1', { shortcut: 'a', title: 'A', content: 'x', ownerUserId: 'outro' }, AGENT);
      await svc.create('org1', { shortcut: 'b', title: 'B', content: 'x', ownerUserId: null }, AGENT);
      expect(repo.create.mock.calls[0][0].owner).toEqual({ connect: { id: 'u3' } });
      expect(repo.create.mock.calls[1][0].owner).toEqual({ connect: { id: 'u3' } });
      expect(repo.isMember).not.toHaveBeenCalled();
    });

    it('atendente exclui a própria', async () => {
      const { svc, repo } = make({ existing: { id: 'q1', organizationId: 'org1', ownerUserId: 'u3', shortcut: 'a' } });
      await svc.remove('q1', 'org1', AGENT);
      expect(repo.softDelete).toHaveBeenCalledWith('q1', 'a');
    });

    it('atendente não exclui nem edita a da equipe', async () => {
      const { svc, repo } = make({ existing: { id: 'q1', organizationId: 'org1', ownerUserId: null, shortcut: 'a' } });
      await expect(svc.remove('q1', 'org1', AGENT)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.update('q1', 'org1', { title: 'x' }, AGENT)).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.softDelete).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('atendente não enxerga nem exclui a de outro vendedor', async () => {
      const { svc } = make({ existing: { id: 'q1', organizationId: 'org1', ownerUserId: 'outro', shortcut: 'a' } });
      await expect(svc.remove('q1', 'org1', AGENT)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('atendente edita a própria, mas não passa ela para a equipe ou para outro', async () => {
      const { svc, repo } = make({ existing: { id: 'q1', organizationId: 'org1', ownerUserId: 'u3', shortcut: 'a' } });
      await svc.update('q1', 'org1', { title: 'Novo', ownerUserId: null }, AGENT);
      expect(repo.update).toHaveBeenCalledWith('q1', { title: 'Novo' });
    });

    it('admin exclui a da equipe', async () => {
      const { svc, repo } = make({ existing: { id: 'q1', organizationId: 'org1', ownerUserId: null, shortcut: 'a' } });
      await svc.remove('q1', 'org1', ADMIN);
      expect(repo.softDelete).toHaveBeenCalledWith('q1', 'a');
    });
  });
});
