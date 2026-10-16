import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { PassThrough } from 'stream';
import type { ContractActor } from './contract-actor';
import { ContractFilesService, sniffMime } from './contract-files.service';
import { MAX_FILE_BYTES } from './contracts.constants';

const PDF = Buffer.from('%PDF-1.7\n...');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const STAFF: ContractActor = { userId: 'admin1', role: OrgRole.OWNER };
const AGENT: ContractActor = { userId: 'agent1', role: OrgRole.AGENT };

function make(contract: any = { id: 'c1', organizationId: 'org1', paymentReceiptKey: 'contracts/org1/x.pdf' }) {
  const prisma = {
    contract: {
      findFirst: jest.fn().mockResolvedValue(contract),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as any;
  const storage = {
    put: jest.fn().mockResolvedValue(undefined),
    stat: jest.fn().mockResolvedValue({ size: 3, contentType: 'application/pdf' }),
    getStream: jest.fn(),
  } as any;
  const realtime = { emitToOrg: jest.fn() } as any;
  return { service: new ContractFilesService(prisma, storage, realtime), prisma, storage, realtime };
}

describe('sniffMime', () => {
  it('reconhece pdf e png pelos bytes', () => {
    expect(sniffMime(PDF)).toBe('application/pdf');
    expect(sniffMime(PNG)).toBe('image/png');
    expect(sniffMime(Buffer.from('<html>'))).toBeNull();
  });

  it('reconhece jpeg, webp e heic', () => {
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic')]);
    expect(sniffMime(JPG)).toBe('image/jpeg');
    expect(sniffMime(webp)).toBe('image/webp');
    expect(sniffMime(heic)).toBe('image/heic');
  });
});

describe('ContractFilesService', () => {
  it('grava comprovante com chave da org e atualiza o campo', async () => {
    const { service, storage, prisma, realtime } = make();
    const key = await service.upload('org1', STAFF, 'c1', 'payment-receipt', { buffer: PDF, mimetype: 'application/pdf', size: PDF.length });
    expect(key).toMatch(/^contracts\/org1\/c1\/payment-receipt-\d+\.pdf$/);
    expect(storage.put).toHaveBeenCalledWith(key, PDF, 'application/pdf');
    expect(prisma.contract.updateMany).toHaveBeenCalledWith({
      where: { AND: [{}], id: 'c1', organizationId: 'org1' },
      data: { paymentReceiptKey: key },
    });
    expect(realtime.emitToOrg).toHaveBeenCalledWith('org1', 'contract:changed', { id: 'c1' });
  });

  it('recusa quando os bytes não batem com o tipo declarado', async () => {
    const { service, storage } = make();
    await expect(
      service.upload('org1', STAFF, 'c1', 'payment-receipt', { buffer: Buffer.from('<svg>'), mimetype: 'image/png', size: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('recusa PDF real declarado como imagem e o inverso', async () => {
    const { service, storage } = make();
    await expect(
      service.upload('org1', STAFF, 'c1', 'signed-contract', { buffer: PDF, mimetype: 'image/png', size: PDF.length }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.upload('org1', STAFF, 'c1', 'signed-contract', { buffer: PNG, mimetype: 'application/pdf', size: PNG.length }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('recusa mime fora da allowlist mesmo com bytes válidos', async () => {
    const { service } = make();
    await expect(
      service.upload('org1', STAFF, 'c1', 'signed-contract', { buffer: PDF, mimetype: 'text/html', size: PDF.length }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa arquivo vazio e arquivo acima do limite', async () => {
    const { service, storage } = make();
    await expect(
      service.upload('org1', STAFF, 'c1', 'payment-receipt', { buffer: Buffer.alloc(0), mimetype: 'application/pdf', size: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const big = Buffer.concat([PDF, Buffer.alloc(MAX_FILE_BYTES)]);
    await expect(
      service.upload('org1', STAFF, 'c1', 'payment-receipt', { buffer: big, mimetype: 'application/pdf', size: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('contrato de outra org dá 404 e não grava nada', async () => {
    const { service, storage } = make(null);
    await expect(
      service.upload('org1', STAFF, 'c1', 'payment-receipt', { buffer: PDF, mimetype: 'application/pdf', size: PDF.length }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('clear zera só o campo do tipo, filtrando pela org', async () => {
    const { service, prisma } = make();
    await service.clear('org1', STAFF, 'c1', 'signed-contract');
    expect(prisma.contract.updateMany).toHaveBeenCalledWith({
      where: { AND: [{}], id: 'c1', organizationId: 'org1' },
      data: { signedContractKey: null },
    });
  });

  it('keyFor devolve a chave do tipo pedido e 404 se vazio', async () => {
    const { service } = make({ id: 'c1', paymentReceiptKey: null, signatureKey: 'contracts/org1/s.png' });
    await expect(service.keyFor('org1', STAFF, 'c1', 'signature')).resolves.toBe('contracts/org1/s.png');
    await expect(service.keyFor('org1', STAFF, 'c1', 'payment-receipt')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keyFor recusa chave fora do prefixo da org (defesa extra)', async () => {
    const { service } = make({ id: 'c1', signatureKey: 'contracts/OUTRA/s.png' });
    await expect(service.keyFor('org1', STAFF, 'c1', 'signature')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keyFor recusa prefixo parecido e path traversal', async () => {
    const a = make({ id: 'c1', signatureKey: 'contracts/org10/s.png' });
    await expect(a.service.keyFor('org1', STAFF, 'c1', 'signature')).rejects.toBeInstanceOf(NotFoundException);
    const b = make({ id: 'c1', signatureKey: 'contracts/org1/../org2/s.png' });
    await expect(b.service.keyFor('org1', STAFF, 'c1', 'signature')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('AGENT: busca e grava com o escopo do criador; contrato alheio dá 404', async () => {
    const { service, prisma, storage } = make(null);
    await expect(
      service.upload('org1', AGENT, 'c1', 'payment-receipt', { buffer: PDF, mimetype: 'application/pdf', size: PDF.length }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.contract.findFirst).toHaveBeenCalledWith({
      where: { AND: [{ createdById: 'agent1' }], id: 'c1', organizationId: 'org1' },
    });
    expect(storage.put).not.toHaveBeenCalled();
    await expect(service.keyFor('org1', AGENT, 'c1', 'signature')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.clear('org1', AGENT, 'c1', 'signed-contract')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.contract.updateMany).not.toHaveBeenCalled();
  });

  it('AGENT no próprio contrato grava com o escopo também no updateMany', async () => {
    const { service, prisma } = make({ id: 'c1', organizationId: 'org1', createdById: 'agent1' });
    const key = await service.upload('org1', AGENT, 'c1', 'payment-receipt', {
      buffer: PDF, mimetype: 'application/pdf', size: PDF.length,
    });
    expect(prisma.contract.updateMany).toHaveBeenCalledWith({
      where: { AND: [{ createdById: 'agent1' }], id: 'c1', organizationId: 'org1' },
      data: { paymentReceiptKey: key },
    });
  });

  it('store recusa kind fora de /^[a-z-]{1,30}$/', async () => {
    const { service, storage } = make();
    const file = { buffer: PDF, mimetype: 'application/pdf', size: PDF.length };
    for (const kind of ['../x', 'Signature', '', 'a'.repeat(31), 'a/b']) {
      await expect(service.store('org1', 'c1', kind, file)).rejects.toThrow();
    }
    expect(storage.put).not.toHaveBeenCalled();
    await expect(service.store('org1', 'c1', 'signature', file)).resolves.toMatch(/^contracts\/org1\/c1\/signature-/);
  });

  describe('stream', () => {
    const fakeRes = () => ({ setHeader: jest.fn(), destroy: jest.fn() }) as any;

    it('getStream rejeitando: lança sem ter setado header', async () => {
      const { service, storage } = make();
      storage.getStream.mockRejectedValue(new Error('minio fora'));
      const res = fakeRes();
      await expect(service.stream('contracts/org1/x.pdf', res, 'x.pdf')).rejects.toThrow('minio fora');
      expect(res.setHeader).not.toHaveBeenCalled();
    });

    it('objeto inexistente dá 404 sem header', async () => {
      const { service, storage } = make();
      storage.stat.mockResolvedValue(null);
      const res = fakeRes();
      await expect(service.stream('contracts/org1/x.pdf', res, 'x.pdf')).rejects.toBeInstanceOf(NotFoundException);
      expect(res.setHeader).not.toHaveBeenCalled();
      expect(storage.getStream).not.toHaveBeenCalled();
    });

    it('erro no meio do stream derruba a resposta (res.destroy), sem erro sem listener', async () => {
      const { service, storage } = make();
      const src = new PassThrough();
      storage.getStream.mockResolvedValue(src);
      const res = fakeRes();
      const pipe = jest.spyOn(src, 'pipe').mockImplementation((d: any) => d);
      await service.stream('contracts/org1/x.pdf', res, 'x.pdf');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(pipe).toHaveBeenCalledWith(res);
      const err = new Error('quebrou');
      src.emit('error', err);
      expect(res.destroy).toHaveBeenCalledWith(err);
    });
  });
});
