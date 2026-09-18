import { BadRequestException, ConflictException } from '@nestjs/common';
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

describe('QuickRepliesService', () => {
  function make(opts: { existing?: any; byShortcut?: any } = {}) {
    const repo = {
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
    await svc.create('org1', { shortcut: '/Pix', title: 'Pix', content: 'Chave: x' });
    expect(repo.findByShortcut).toHaveBeenCalledWith('org1', 'pix');
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ shortcut: 'pix' }));
  });

  it('recusa atalho repetido com 409', async () => {
    const { svc } = make({ byShortcut: { id: 'outro' } });
    await expect(svc.create('org1', { shortcut: 'pix', title: 'Pix', content: 'x' })).rejects.toBeInstanceOf(ConflictException);
  });

  // O índice único (org, atalho) inclui as apagadas: sem liberar o atalho,
  // recriar "/pix" depois de apagar dava 500.
  it('apagar libera o atalho para ser reusado', async () => {
    const { svc, repo } = make({ existing: { id: 'q1', organizationId: 'org1', shortcut: 'pix' } });
    await svc.remove('q1', 'org1');
    expect(repo.softDelete).toHaveBeenCalledWith('q1', 'pix');
  });
});
