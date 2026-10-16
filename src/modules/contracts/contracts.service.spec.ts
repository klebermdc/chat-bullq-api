import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import type { ContractActor } from './contract-actor';
import { ContractsService, monthRange } from './contracts.service';

/** PNG 1x1 RGBA válido (IHDR conferido por assertSafePng). */
const SIGNATURE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ACCEPTED_AT = new Date('2026-10-10T15:00:00Z');
const ACCEPTED = {
  id: 'c1', organizationId: 'org1', acceptedAt: ACCEPTED_AT, acceptancePdfKey: null,
  signatureKey: 'contracts/org1/c1/signature-x.png', clientIp: '1.2.3.4', clientUserAgent: 'UA',
  acceptedTermsText: 'ACEITOS', parkDates: [], requestedDates: '', createdAt: new Date(),
};

const STAFF: ContractActor = { userId: 'admin1', role: OrgRole.ADMIN };
const AGENT: ContractActor = { userId: 'agent1', role: OrgRole.AGENT };

function make(existing: any = null) {
  const repo = {
    findPage: jest.fn().mockResolvedValue([[], 0]),
    // Simula o where do banco: escopo { createdById } filtra pelo criador.
    findInOrg: jest.fn().mockImplementation((_o, _i, scope: any) =>
      Promise.resolve(existing && (!scope?.createdById || scope.createdById === existing.createdById) ? existing : null),
    ),
    create: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'c1', ...data })),
    updateInOrg: jest.fn().mockImplementation((_o, _i, data) => Promise.resolve({ ...existing, ...data })),
    count: jest.fn().mockResolvedValue(0),
    deleteInOrg: jest.fn().mockImplementation((_o, _i, scope: any) =>
      Promise.resolve(!!existing && (!scope?.createdById || scope.createdById === existing.createdById)),
    ),
  } as any;
  const realtime = { emitToOrg: jest.fn() } as any;
  const settings = { get: jest.fn().mockResolvedValue({ terms: 'T' }) } as any;
  const pdf = { render: jest.fn().mockResolvedValue(Buffer.from('%PDF')) } as any;
  const storage = {
    getBuffer: jest.fn().mockResolvedValue(SIGNATURE_PNG),
    put: jest.fn().mockResolvedValue(undefined),
  } as any;
  return {
    service: new ContractsService(repo, realtime, settings, pdf, storage), repo, realtime, settings, pdf, storage,
  };
}

const DTO = {
  fullName: 'Cliente Teste',
  cpf: '000.000.000-00',
  address: 'Rua Teste, 123',
  cep: '00000-000',
  email: 'c@example.com',
  phone: '(11) 90000-0000',
  guideName: 'Kleber',
  people: 2,
  amount: '2190,00',
  disneyGuest: false,
  datesToBeDefined: false,
  parkDates: [{ parkId: 'epcot', date: '2026-12-02' }],
};

describe('ContractsService', () => {
  it('create gera token no servidor, texto de datas e dias', async () => {
    const { service, repo, realtime } = make();
    await service.create('org1', 'user1', DTO as any);
    const data = repo.create.mock.calls[0][0];
    expect(data.organizationId).toBe('org1');
    expect(data.createdById).toBe('user1');
    expect(data.acceptanceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.requestedDates).toBe('02/12/2026 - EPCOT');
    expect(data.days).toBe(1);
    expect(realtime.emitToOrg).toHaveBeenCalledWith('org1', 'contract:changed', expect.objectContaining({ id: 'c1' }));
  });

  it('datas a definir: dias 0 e sem parkDates', async () => {
    const { service, repo } = make();
    await service.create('org1', 'u', { ...DTO, datesToBeDefined: true, parkDates: [] } as any);
    const data = repo.create.mock.calls[0][0];
    expect(data.days).toBe(0);
    expect(data.requestedDates).toBe('Datas a definir');
  });

  it('exige ao menos uma data quando não é "a definir"', async () => {
    const { service } = make();
    await expect(service.create('org1', 'u', { ...DTO, parkDates: [] } as any)).rejects.toThrow(/data/i);
  });

  it('update em contrato aceito é recusado', async () => {
    const { service } = make({ id: 'c1', acceptedAt: new Date() });
    await expect(service.update('org1', STAFF, 'c1', { fullName: 'X Y Z' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('update recalcula texto e dias quando as datas mudam, sem tocar em arquivos', async () => {
    const { service, repo } = make({ id: 'c1', acceptedAt: null });
    await service.update('org1', STAFF, 'c1', { parkDates: [{ parkId: 'epcot', date: '2026-12-02' }], datesToBeDefined: false });
    const data = repo.updateInOrg.mock.calls[0][2];
    expect(data.requestedDates).toBe('02/12/2026 - EPCOT');
    expect(data.days).toBe(1);
    expect(data).not.toHaveProperty('signedContractKey');
  });

  it('contrato de outra org dá 404', async () => {
    const { service } = make(null);
    await expect(service.get('org1', STAFF, 'c1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('flags podem mudar mesmo depois do aceite', async () => {
    const { service, repo } = make({ id: 'c1', acceptedAt: new Date() });
    await service.updateFlags('org1', STAFF, 'c1', { paid: true });
    expect(repo.updateInOrg).toHaveBeenCalledWith('org1', 'c1', { paid: true }, {});
  });

  it('novo link troca o token; recusado depois do aceite', async () => {
    const ok = make({ id: 'c1', acceptedAt: null });
    const r = await ok.service.regenerateToken('org1', STAFF, 'c1');
    expect(r.acceptanceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const accepted = make({ id: 'c1', acceptedAt: new Date() });
    await expect(accepted.service.regenerateToken('org1', STAFF, 'c1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('list monta where com org, guia, status, busca e mês', async () => {
    const { service, repo } = make();
    await service.list('org1', STAFF, { guide: 'Kleber', status: 'paid', q: 'ana', year: 2026, month: 2, page: 2, perPage: 10 });
    const [where, skip, take] = repo.findPage.mock.calls[0];
    expect(where.organizationId).toBe('org1');
    expect(where.guideName).toEqual({ equals: 'Kleber', mode: 'insensitive' });
    expect(where.createdAt).toEqual({ gte: new Date('2026-02-01T03:00:00Z'), lt: new Date('2026-03-01T03:00:00Z') });
    expect(JSON.stringify(where)).toContain('paymentReceiptKey');
    expect(JSON.stringify(where)).toContain('ana');
    expect([skip, take]).toEqual([10, 10]);
  });

  it('moveDate troca a data no parkDates', async () => {
    const { service, repo } = make({
      id: 'c1', acceptedAt: null, parkDates: [{ parkId: 'epcot', date: '2026-12-02' }], requestedDates: '', createdAt: new Date(),
    });
    await service.moveDate('org1', STAFF, 'c1', { from: '2026-12-02', to: '2026-12-05' });
    const data = repo.updateInOrg.mock.calls[0][2];
    expect(data.parkDates).toEqual([{ parkId: 'epcot', date: '2026-12-05' }]);
    expect(data.requestedDates).toBe('05/12/2026 - EPCOT');
  });
  it('stats conta por status com o mesmo filtro de guia', async () => {
    const { service, repo } = make();
    repo.count = jest.fn().mockResolvedValue(3);
    expect(await service.stats('org1', STAFF, 'Kleber')).toEqual({ total: 3, accepted: 3, paid: 3, purchased: 3, pending: 3 });
    expect(repo.count).toHaveBeenCalledTimes(5);
    for (const [where] of repo.count.mock.calls) {
      expect(where).toMatchObject({ organizationId: 'org1', guideName: { equals: 'Kleber', mode: 'insensitive' } });
    }
  });

  it('stats sem guia não filtra por guia', async () => {
    const { service, repo } = make();
    repo.count = jest.fn().mockResolvedValue(0);
    await service.stats('org1', STAFF);
    expect(repo.count.mock.calls[0][0]).toEqual({ organizationId: 'org1' });
  });

  it('pdfFor devolve a chave do PDF de aceite quando existe', async () => {
    const { service, pdf } = make({ id: 'c1', acceptancePdfKey: 'contracts/org1/c1/acceptance.pdf' });
    await expect(service.pdfFor('org1', STAFF, 'c1')).resolves.toEqual({ key: 'contracts/org1/c1/acceptance.pdf' });
    expect(pdf.render).not.toHaveBeenCalled();
  });

  it('pdfFor ignora chave de outra org e gera na hora', async () => {
    const { service, pdf } = make({
      id: 'c1', acceptancePdfKey: 'contracts/org2/c1/acceptance.pdf', parkDates: [], requestedDates: '', createdAt: new Date(),
    });
    const r = await service.pdfFor('org1', STAFF, 'c1');
    expect('buffer' in r).toBe(true);
    expect(pdf.render).toHaveBeenCalled();
  });

  it('pdfFor gera na hora quando não há aceite', async () => {
    const { service } = make({ id: 'c1', acceptancePdfKey: null, parkDates: [], requestedDates: '', createdAt: new Date() });
    const r = await service.pdfFor('org1', STAFF, 'c1');
    expect('buffer' in r).toBe(true);
  });

  it('pdfForContract usa o contrato já carregado, sem consultar o repositório', async () => {
    const { service, repo, pdf } = make();
    const c = { id: 'c1', acceptancePdfKey: 'contracts/org1/c1/acceptance.pdf' } as any;
    await expect(service.pdfForContract('org1', c)).resolves.toEqual({ key: 'contracts/org1/c1/acceptance.pdf' });
    expect(repo.findInOrg).not.toHaveBeenCalled();
    expect(pdf.render).not.toHaveBeenCalled();
  });

  it('pdfForContract ignora chave de outra org e gera na hora', async () => {
    const { service, pdf } = make();
    const c = {
      id: 'c1', acceptancePdfKey: 'contracts/org2/c1/acceptance.pdf', parkDates: [], requestedDates: '', createdAt: new Date(),
    } as any;
    const r = await service.pdfForContract('org1', c);
    expect('buffer' in r).toBe(true);
    expect(pdf.render).toHaveBeenCalled();
  });

  it('pdfFor carrega com o escopo do ator e delega para pdfForContract', async () => {
    const existing = { id: 'c1', createdById: 'agent1', acceptancePdfKey: 'contracts/org1/c1/acceptance.pdf' };
    const { service, repo } = make(existing);
    const spy = jest.spyOn(service, 'pdfForContract');
    await service.pdfFor('org1', AGENT, 'c1');
    expect(repo.findInOrg).toHaveBeenCalledWith('org1', 'c1', { createdById: 'agent1' });
    expect(spy).toHaveBeenCalledWith('org1', existing);
  });

  it('buildPdfInput monta só os campos do contrato que o PDF usa', async () => {
    const contract = {
      id: 'c1', organizationId: 'org1', acceptanceToken: 'segredo', fullName: 'Cliente Teste', cpf: '000.000.000-00',
      address: 'Rua Teste, 123', cep: '00000-000', email: 'c@example.com', phone: '(11) 90000-0000', guideName: 'Kleber',
      people: 2, days: 1, amount: '2190,00', paymentMethod: 'pix', notes: null,
      parkDates: [{ parkId: 'epcot', date: '2026-12-02' }], requestedDates: '', createdAt: new Date(),
    };
    const { service, settings } = make();
    settings.get.mockResolvedValue({ terms: 'T', companyName: 'Empresa', companyDocument: null, companyAddress: null });
    const input = await service.buildPdfInput('org1', contract as any);
    expect(input.company).toEqual({ name: 'Empresa', document: '', address: '' });
    expect(input.terms).toBe('T');
    expect(input.acceptance).toBeUndefined();
    expect(input.contract).toEqual({
      fullName: 'Cliente Teste', cpf: '000.000.000-00', address: 'Rua Teste, 123', cep: '00000-000',
      email: 'c@example.com', phone: '(11) 90000-0000', guideName: 'Kleber', people: 2, days: 1, amount: '2190,00',
      paymentMethod: 'pix', notes: null, dates: [{ label: 'EPCOT', date: '2026-12-02' }],
    });
  });

  describe('permissões por papel', () => {
    const OWN = { id: 'c1', createdById: 'agent1', acceptedAt: null };

    it('AGENT não vê contrato de outro usuário (404) e o escopo vai para o repositório', async () => {
      const { service, repo } = make({ id: 'c1', createdById: 'outro', acceptedAt: null });
      await expect(service.get('org1', AGENT, 'c1')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findInOrg).toHaveBeenCalledWith('org1', 'c1', { createdById: 'agent1' });
    });

    it('AGENT não vê contrato legado (sem criador)', async () => {
      const { service } = make({ id: 'c1', createdById: null, acceptedAt: null });
      await expect(service.get('org1', AGENT, 'c1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('papel indefinido é tratado como AGENT', async () => {
      const { service } = make({ id: 'c1', createdById: 'outro', acceptedAt: null });
      await expect(service.get('org1', { userId: 'agent1', role: undefined }, 'c1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('AGENT vê o próprio contrato', async () => {
      const { service } = make(OWN);
      await expect(service.get('org1', AGENT, 'c1')).resolves.toMatchObject({ id: 'c1' });
    });

    it('staff vê contrato de qualquer um, inclusive legado', async () => {
      const { service, repo } = make({ id: 'c1', createdById: null, acceptedAt: null });
      await expect(service.get('org1', STAFF, 'c1')).resolves.toMatchObject({ id: 'c1' });
      expect(repo.findInOrg).toHaveBeenCalledWith('org1', 'c1', {});
    });

    it('list e stats de AGENT filtram pelo criador; staff não', async () => {
      const { service, repo } = make();
      await service.list('org1', AGENT, {});
      expect(repo.findPage.mock.calls[0][0]).toMatchObject({ organizationId: 'org1', createdById: 'agent1' });
      await service.list('org1', STAFF, {});
      expect(repo.findPage.mock.calls[1][0]).not.toHaveProperty('createdById');
      await service.stats('org1', AGENT);
      for (const [where] of repo.count.mock.calls) expect(where).toMatchObject({ createdById: 'agent1' });
    });

    it('AGENT recebe 403 ao marcar pago ou NF, sem gravar nada', async () => {
      const { service, repo } = make(OWN);
      await expect(service.updateFlags('org1', AGENT, 'c1', { paid: true })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.updateFlags('org1', AGENT, 'c1', { invoiceIssued: false })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.updateFlags('org1', AGENT, 'c1', { purchased: true, paid: true })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repo.updateInOrg).not.toHaveBeenCalled();
    });

    it('AGENT marca comprado no próprio contrato, com escopo no update', async () => {
      const { service, repo } = make(OWN);
      await service.updateFlags('org1', AGENT, 'c1', { purchased: true });
      expect(repo.updateInOrg).toHaveBeenCalledWith('org1', 'c1', { purchased: true }, { createdById: 'agent1' });
    });

    it('AGENT não marca comprado em contrato de outro (404)', async () => {
      const { service, repo } = make({ id: 'c1', createdById: 'outro' });
      await expect(service.updateFlags('org1', AGENT, 'c1', { purchased: true })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repo.updateInOrg).not.toHaveBeenCalled();
    });

    it('update, token, datas, pdf e remove de AGENT em contrato alheio dão 404', async () => {
      const { service, repo } = make({
        id: 'c1', createdById: 'outro', acceptedAt: null, parkDates: [{ parkId: 'epcot', date: '2026-12-02' }],
        requestedDates: '', createdAt: new Date(),
      });
      await expect(service.update('org1', AGENT, 'c1', { fullName: 'X Y Z' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.regenerateToken('org1', AGENT, 'c1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.moveDate('org1', AGENT, 'c1', { from: '2026-12-02', to: '2026-12-03' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.pdfFor('org1', AGENT, 'c1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.remove('org1', AGENT, 'c1')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.deleteInOrg).toHaveBeenCalledWith('org1', 'c1', { createdById: 'agent1' });
      expect(repo.updateInOrg).not.toHaveBeenCalled();
    });
  });

  describe('listagem sem campos sensíveis', () => {
    it('itens trocam chaves de arquivo por booleanos e não trazem token, IP, user agent nem termos', async () => {
      const { service, repo } = make();
      repo.findPage.mockResolvedValue([
        [
          {
            id: 'c1', fullName: 'Ana', signatureKey: 'contracts/org1/s.png', signedContractKey: null,
            paymentReceiptKey: 'contracts/org1/r.pdf', acceptancePdfKey: null,
          },
        ],
        1,
      ]);
      const r = await service.list('org1', STAFF, {});
      expect(r.items[0]).toEqual({
        id: 'c1', fullName: 'Ana',
        hasSignature: true, hasSignedContract: false, hasPaymentReceipt: true, hasAcceptancePdf: false,
      });
    });
  });

  describe('corrida com o aceite', () => {
    it('update grava com acceptedAt null no where e dá 409 se o aceite chegou antes', async () => {
      const { service, repo } = make({ id: 'c1', createdById: 'agent1', acceptedAt: null });
      repo.updateInOrg.mockResolvedValue(null);
      await expect(service.update('org1', AGENT, 'c1', { fullName: 'X Y Z' })).rejects.toThrow(/já aceito/);
      expect(repo.updateInOrg.mock.calls[0][3]).toEqual({ createdById: 'agent1', acceptedAt: null });
    });

    it('regenerateToken dá 409 quando o update não acha linha sem aceite', async () => {
      const { service, repo } = make({ id: 'c1', acceptedAt: null });
      repo.updateInOrg.mockResolvedValue(null);
      await expect(service.regenerateToken('org1', STAFF, 'c1')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.updateInOrg.mock.calls[0][3]).toEqual({ acceptedAt: null });
    });
  });

  describe('moveDate', () => {
    it('recusa contrato legado cujo texto tem linhas que não viram data', async () => {
      const { service, repo } = make({
        id: 'c1', acceptedAt: null, parkDates: [], createdAt: new Date('2026-10-01T12:00:00Z'),
        requestedDates: '02/12 - EPCOT\n03/12 - Magic Kingdom\nsegunda semana de dezembro',
      });
      await expect(service.moveDate('org1', STAFF, 'c1', { from: '2026-12-02', to: '2026-12-05' })).rejects.toThrow(
        /formato livre/,
      );
      expect(repo.updateInOrg).not.toHaveBeenCalled();
    });

    it('aceita legado quando todas as linhas viram data (ignora "Datas a definir" e linhas vazias)', async () => {
      const { service, repo } = make({
        id: 'c1', acceptedAt: null, parkDates: [], createdAt: new Date('2026-10-01T12:00:00Z'),
        requestedDates: '02/12 - EPCOT\n\n03/12 - Magic Kingdom\n',
      });
      await service.moveDate('org1', STAFF, 'c1', { from: '2026-12-02', to: '2026-12-05' });
      expect(repo.updateInOrg.mock.calls[0][2].parkDates).toEqual([
        { parkId: 'epcot', date: '2026-12-05' },
        { parkId: 'magic-kingdom', date: '2026-12-03' },
      ]);
    });

    it('com parkId escolhe a data que bate data e parque', async () => {
      const { service, repo } = make({
        id: 'c1', acceptedAt: null, requestedDates: '', createdAt: new Date(),
        parkDates: [{ parkId: 'epcot', date: '2026-12-02' }, { parkId: 'magic-kingdom', date: '2026-12-02' }],
      });
      await service.moveDate('org1', STAFF, 'c1', { from: '2026-12-02', to: '2026-12-05', parkId: 'magic-kingdom' });
      expect(repo.updateInOrg.mock.calls[0][2].parkDates).toEqual([
        { parkId: 'epcot', date: '2026-12-02' },
        { parkId: 'magic-kingdom', date: '2026-12-05' },
      ]);
    });

    it('com parkId que não bate a data dá 400', async () => {
      const { service } = make({
        id: 'c1', acceptedAt: null, requestedDates: '', createdAt: new Date(),
        parkDates: [{ parkId: 'epcot', date: '2026-12-02' }],
      });
      await expect(
        service.moveDate('org1', STAFF, 'c1', { from: '2026-12-02', to: '2026-12-05', parkId: 'seaworld' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('datas contraditórias', () => {
    it('create com parkDates e sem datesToBeDefined assume false', async () => {
      const { service, repo } = make();
      const { datesToBeDefined: _omit, ...dto } = DTO;
      await service.create('org1', 'u', dto as any);
      expect(repo.create.mock.calls[0][0]).toMatchObject({ datesToBeDefined: false, days: 1 });
    });

    it('create com datesToBeDefined true e parkDates preenchido dá 400', async () => {
      const { service, repo } = make();
      await expect(service.create('org1', 'u', { ...DTO, datesToBeDefined: true } as any)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('update com parkDates em contrato "a definir" passa a ter datas', async () => {
      const { service, repo } = make({ id: 'c1', acceptedAt: null, datesToBeDefined: true, parkDates: [] });
      await service.update('org1', STAFF, 'c1', { parkDates: [{ parkId: 'epcot', date: '2026-12-02' }] });
      expect(repo.updateInOrg.mock.calls[0][2]).toMatchObject({ datesToBeDefined: false, days: 1 });
    });

    it('update com as duas coisas ao mesmo tempo dá 400', async () => {
      const { service, repo } = make({ id: 'c1', acceptedAt: null, datesToBeDefined: false, parkDates: [] });
      await expect(
        service.update('org1', STAFF, 'c1', { parkDates: [{ parkId: 'epcot', date: '2026-12-02' }], datesToBeDefined: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.updateInOrg).not.toHaveBeenCalled();
    });
  });

  it('buildPdfInput usa os termos aceitos quando existem', async () => {
    const { service, settings } = make();
    settings.get.mockResolvedValue({ terms: 'ATUAIS' });
    const base = { parkDates: [], requestedDates: '', createdAt: new Date() };
    expect((await service.buildPdfInput('org1', { ...base, acceptedTermsText: 'ACEITOS' } as any)).terms).toBe('ACEITOS');
    expect((await service.buildPdfInput('org1', { ...base, acceptedTermsText: null } as any)).terms).toBe('ATUAIS');
  });
});

describe('pdfForContract: aceito sem PDF guardado', () => {
  it('monta a evidência das colunas (IP, navegador, hora, termos aceitos e assinatura)', async () => {
    const { service, pdf, storage } = make();
    const r = await service.pdfForContract('org1', ACCEPTED as any);
    expect('buffer' in r).toBe(true);
    expect(storage.getBuffer).toHaveBeenCalledWith('contracts/org1/c1/signature-x.png');
    expect(pdf.render.mock.calls[0][0].acceptance).toEqual({
      acceptedAt: ACCEPTED_AT, ip: '1.2.3.4', userAgent: 'UA',
      signaturePngBase64: SIGNATURE_PNG.toString('base64'), acceptedTerms: 'ACEITOS',
    });
  });

  it('guarda o PDF gerado e grava a chave só se ainda estiver vazia', async () => {
    const { service, storage, repo } = make();
    await service.pdfForContract('org1', ACCEPTED as any);
    const [key, buf, type] = storage.put.mock.calls[0];
    expect(key).toMatch(new RegExp(`^contracts/org1/c1/acceptance-${UUID}\\.pdf$`));
    expect(buf).toEqual(Buffer.from('%PDF'));
    expect(type).toBe('application/pdf');
    expect(repo.updateInOrg).toHaveBeenCalledWith('org1', 'c1', { acceptancePdfKey: key }, { acceptancePdfKey: null });
  });

  it('falha ao guardar só loga e ainda entrega o PDF', async () => {
    const { service, storage } = make();
    storage.put.mockRejectedValue(new Error('minio'));
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(service.pdfForContract('org1', ACCEPTED as any)).resolves.toEqual({ buffer: Buffer.from('%PDF') });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('contract_acceptance_pdf_store_failed contract=c1'));
  });

  it('sem signatureKey: evidência sem imagem, sem ler o storage', async () => {
    const { service, pdf, storage } = make();
    await service.pdfForContract('org1', { ...ACCEPTED, signatureKey: null } as any);
    expect(storage.getBuffer).not.toHaveBeenCalled();
    expect(pdf.render.mock.calls[0][0].acceptance).toMatchObject({ ip: '1.2.3.4', signaturePngBase64: null });
  });

  it('assinatura sumida, de outra org ou PNG inválido: segue sem imagem', async () => {
    const { service, pdf, storage } = make();
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    storage.getBuffer.mockRejectedValueOnce(new Error('NoSuchKey'));
    await service.pdfForContract('org1', ACCEPTED as any);
    expect(pdf.render.mock.calls[0][0].acceptance.signaturePngBase64).toBeNull();

    await service.pdfForContract('org1', { ...ACCEPTED, signatureKey: 'contracts/org2/c1/signature-x.png' } as any);
    expect(storage.getBuffer).toHaveBeenCalledTimes(1);
    expect(pdf.render.mock.calls[1][0].acceptance.signaturePngBase64).toBeNull();

    storage.getBuffer.mockResolvedValueOnce(Buffer.from('não é png'));
    await service.pdfForContract('org1', ACCEPTED as any);
    expect(pdf.render.mock.calls[2][0].acceptance.signaturePngBase64).toBeNull();
  });

  it('sem termos aceitos usa os termos atuais', async () => {
    const { service, pdf, settings } = make();
    settings.get.mockResolvedValue({ terms: 'ATUAIS' });
    await service.pdfForContract('org1', { ...ACCEPTED, acceptedTermsText: null } as any);
    expect(pdf.render.mock.calls[0][0].acceptance.acceptedTerms).toBe('ATUAIS');
  });

  it('não aceito: sem evidência e sem guardar nada', async () => {
    const { service, pdf, storage, repo } = make();
    await service.pdfForContract('org1', { ...ACCEPTED, acceptedAt: null } as any);
    expect(pdf.render.mock.calls[0][0].acceptance).toBeUndefined();
    expect(storage.put).not.toHaveBeenCalled();
    expect(repo.updateInOrg).not.toHaveBeenCalled();
  });
});

describe('monthRange (horário de Brasília)', () => {
  it('mês começa e termina à meia-noite BRT (03:00 UTC)', () => {
    expect(monthRange(2026, 1)).toEqual({ gte: new Date('2026-01-01T03:00:00Z'), lt: new Date('2026-02-01T03:00:00Z') });
    expect(monthRange(2026, 12)).toEqual({ gte: new Date('2026-12-01T03:00:00Z'), lt: new Date('2027-01-01T03:00:00Z') });
    expect(monthRange(2026)).toEqual({ gte: new Date('2026-01-01T03:00:00Z'), lt: new Date('2027-01-01T03:00:00Z') });
  });

  it('contrato de 31/01 às 22h BRT (01/02 01h UTC) cai em janeiro', () => {
    const created = new Date('2026-02-01T01:00:00Z');
    const jan = monthRange(2026, 1);
    const feb = monthRange(2026, 2);
    expect(created >= jan.gte && created < jan.lt).toBe(true);
    expect(created >= feb.gte && created < feb.lt).toBe(false);
  });
});
