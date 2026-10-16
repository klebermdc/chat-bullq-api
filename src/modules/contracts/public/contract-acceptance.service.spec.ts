import { BadRequestException, ConflictException, GoneException, NotFoundException } from '@nestjs/common';
import { ContractAcceptanceService, maskCpf } from './contract-acceptance.service';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_B64 = Buffer.from([...PNG_MAGIC, 1, 2, 3]).toString('base64');
const SIG = `data:image/png;base64,${PNG_B64}`;
const META = { ip: '1.2.3.4', userAgent: 'UA' };
const SETTINGS = { terms: 'TERMOS', defaultPixKey: 'PADRAO', usdPaymentInstructions: 'WISE', companyName: 'OFP' };

function make(contract: any, updateCount = 1, settingsOverride: any = {}) {
  const prisma = {
    contract: {
      findUnique: jest.fn().mockResolvedValue(contract),
      updateMany: jest.fn().mockResolvedValue({ count: updateCount }),
      update: jest.fn().mockResolvedValue({}),
    },
  } as any;
  const storage = { put: jest.fn().mockResolvedValue(undefined) } as any;
  const settings = { get: jest.fn().mockResolvedValue({ ...SETTINGS, ...settingsOverride }) } as any;
  const contracts = {
    buildPdfInput: jest.fn().mockResolvedValue({}),
    pdfForContract: jest.fn().mockResolvedValue({ key: 'contracts/org1/c1/acceptance-1.pdf' }),
  } as any;
  const pdf = { render: jest.fn().mockResolvedValue(Buffer.from('%PDF')) } as any;
  const files = { store: jest.fn().mockResolvedValue('contracts/org1/c1/payment-receipt-1.pdf') } as any;
  const notifier = { receiptUploaded: jest.fn().mockResolvedValue(undefined) } as any;
  const realtime = { emitToOrg: jest.fn() } as any;
  const service = new ContractAcceptanceService(prisma, storage, settings, contracts, pdf, files, notifier, realtime);
  return { service, prisma, storage, settings, contracts, pdf, files, notifier, realtime };
}

const C = {
  id: 'c1', organizationId: 'org1', fullName: 'Ana', cpf: '123.456.789-01', email: 'a@x.com', phone: '1',
  address: 'SEGREDO', cep: '00000-000', guideName: 'Kleber', people: 2, days: 1, amount: '2190,00', paymentMethod: null,
  pixKey: '55513365000101', acceptedAt: null, acceptedTermsText: null, paymentReceiptKey: null,
  parkDates: [{ parkId: 'epcot', date: '2026-12-02' }], requestedDates: '', createdAt: new Date(), clientIp: '9.9.9.9',
  clientUserAgent: 'NAVEGADOR-SECRETO', createdById: 'user-secreto', legacyChatUrl: 'https://umbler/chat-secreto',
  acceptanceToken: 'tok-secreto', signatureKey: 'contracts/org1/c1/sig-secreta.png', acceptancePdfKey: null,
  signedContractKey: null, notes: 'NOTA-INTERNA', sellerName: 'VENDEDOR-INTERNO',
};

describe('maskCpf', () => {
  it('mostra só os 4 últimos dígitos', () => {
    expect(maskCpf('123.456.789-01')).toBe('***.***.*89-01');
    expect(maskCpf('123')).toBe('***');
  });
});

describe('view', () => {
  it('não expõe endereço, CEP, IP, user agent, criador, link legado nem chaves; mascara CPF', async () => {
    const { service } = make(C);
    const v = await service.view('tok');
    const json = JSON.stringify(v);
    for (const secret of [
      'SEGREDO', '00000-000', '9.9.9.9', 'NAVEGADOR-SECRETO', 'user-secreto', 'chat-secreto', 'tok-secreto',
      'sig-secreta', '123.456', 'NOTA-INTERNA', 'VENDEDOR-INTERNO',
    ]) {
      expect(json).not.toContain(secret);
    }
    expect(v.cpf).toBe('***.***.*89-01');
    expect(v.pixKey).toBe('55513365000101');
    expect(v.terms).toBe('TERMOS');
    expect(v.usdInstructions).toBeNull();
    expect(v.dates).toEqual([{ label: 'EPCOT', date: '2026-12-02' }]);
    expect(v).toMatchObject({ accepted: false, acceptedAt: null, hasReceipt: false, companyName: 'OFP' });
  });

  it('sem chave no contrato usa a padrão; valor em dólar traz instruções e não traz PIX', async () => {
    const { service } = make({ ...C, pixKey: null });
    expect((await service.view('tok')).pixKey).toBe('PADRAO');
    const usd = await make({ ...C, amount: '$ 150.00' }).service.view('tok');
    expect(usd.pixKey).toBeNull();
    expect(usd.usdInstructions).toBe('WISE');
  });

  it('contrato aceito mostra o snapshot dos termos', async () => {
    const { service } = make({ ...C, acceptedAt: new Date(), acceptedTermsText: 'ACEITOS' });
    expect((await service.view('tok')).terms).toBe('ACEITOS');
  });

  it('token inexistente dá 404', async () => {
    const { service } = make(null);
    await expect(service.view('x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('accept', () => {
  it('grava evidência de forma atômica, com IP e hora do servidor e snapshot dos termos', async () => {
    const { service, prisma, storage, realtime } = make(C);
    await service.accept('tok', { signature: SIG, agree: true }, META);
    const arg = prisma.contract.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'c1', acceptedAt: null });
    expect(arg.data).toMatchObject({ clientIp: '1.2.3.4', clientUserAgent: 'UA', acceptedTermsText: 'TERMOS' });
    expect(arg.data.acceptedAt).toBeInstanceOf(Date);
    expect(arg.data.signatureKey).toMatch(/^contracts\/org1\/c1\/signature-\d+\.png$/);
    expect(storage.put).toHaveBeenCalledWith(arg.data.signatureKey, expect.any(Buffer), 'image/png');
    expect(realtime.emitToOrg).toHaveBeenCalledWith('org1', 'contract:accepted', { id: 'c1' });
  });

  it('gera o PDF depois do update, com a assinatura, e guarda a chave', async () => {
    const { service, prisma, storage, contracts } = make(C);
    await service.accept('tok', { signature: SIG, agree: true }, META);
    expect(prisma.contract.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      contracts.buildPdfInput.mock.invocationCallOrder[0],
    );
    expect(contracts.buildPdfInput).toHaveBeenCalledWith(
      'org1',
      expect.objectContaining({ id: 'c1' }),
      expect.objectContaining({ ip: '1.2.3.4', userAgent: 'UA', signaturePngBase64: PNG_B64, acceptedTerms: 'TERMOS' }),
    );
    const pdfKey = storage.put.mock.calls[1][0];
    expect(pdfKey).toMatch(/^contracts\/org1\/c1\/acceptance-\d+\.pdf$/);
    expect(prisma.contract.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { acceptancePdfKey: pdfKey } });
  });

  it('corta o user agent em 500 caracteres', async () => {
    const { service, prisma } = make(C);
    await service.accept('tok', { signature: SIG, agree: true }, { ip: 'i', userAgent: 'x'.repeat(2000) });
    expect(prisma.contract.updateMany.mock.calls[0][0].data.clientUserAgent).toHaveLength(500);
  });

  it('segundo aceite (corrida) dá 410', async () => {
    const { service } = make(C, 0);
    await expect(service.accept('tok', { signature: SIG, agree: true }, META)).rejects.toBeInstanceOf(GoneException);
  });

  it('já aceito dá 410 sem gravar nada', async () => {
    const { service, storage, prisma } = make({ ...C, acceptedAt: new Date() });
    await expect(service.accept('tok', { signature: SIG, agree: true }, META)).rejects.toBeInstanceOf(GoneException);
    expect(storage.put).not.toHaveBeenCalled();
    expect(prisma.contract.updateMany).not.toHaveBeenCalled();
  });

  it('assinatura inválida ou sem concordância dá 400 antes de qualquer acesso ao banco ou storage', async () => {
    const { service, prisma, storage } = make(C);
    const bad = [
      { signature: 'data:image/png;base64,PHN2Zz4=', agree: true },
      { signature: 'data:image/svg+xml;base64,PHN2Zz4=', agree: true },
      { signature: '', agree: true },
      { signature: SIG, agree: false },
    ];
    for (const body of bad) {
      await expect(service.accept('tok', body, META)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.contract.findUnique).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('assinatura acima de 60 KB dá 400', async () => {
    const { service } = make(C);
    const big = Buffer.concat([Buffer.from(PNG_MAGIC), Buffer.alloc(60 * 1024)]).toString('base64');
    await expect(
      service.accept('tok', { signature: `data:image/png;base64,${big}`, agree: true }, META),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('termos da org vazios dão 400 sem gravar nada', async () => {
    const { service, storage, prisma } = make(C, 1, { terms: '   ' });
    await expect(service.accept('tok', { signature: SIG, agree: true }, META)).rejects.toThrow(
      'Termos do contrato não configurados',
    );
    expect(storage.put).not.toHaveBeenCalled();
    expect(prisma.contract.updateMany).not.toHaveBeenCalled();
  });

  it('falha no PDF não desfaz o aceite', async () => {
    const { service, pdf, realtime } = make(C);
    pdf.render.mockRejectedValue(new Error('chromium'));
    await expect(service.accept('tok', { signature: SIG, agree: true }, META)).resolves.toMatchObject({ accepted: true });
    expect(realtime.emitToOrg).toHaveBeenCalledWith('org1', 'contract:accepted', { id: 'c1' });
  });
});

describe('pdfByToken', () => {
  it('usa pdfForContract com o contrato do token (sem ator)', async () => {
    const { service, contracts } = make(C);
    await expect(service.pdfByToken('tok')).resolves.toEqual({ key: 'contracts/org1/c1/acceptance-1.pdf' });
    expect(contracts.pdfForContract).toHaveBeenCalledWith('org1', expect.objectContaining({ id: 'c1' }));
  });
});

describe('uploadReceipt', () => {
  const file = { buffer: Buffer.from('%PDF-1'), mimetype: 'application/pdf', size: 6 };

  it('antes do aceite dá 409', async () => {
    const { service, files } = make(C);
    await expect(service.uploadReceipt('tok', file, 'https://app')).rejects.toBeInstanceOf(ConflictException);
    expect(files.store).not.toHaveBeenCalled();
  });

  it('depois do aceite grava, avisa por e-mail e emite evento', async () => {
    const { service, prisma, notifier, files, realtime } = make({ ...C, acceptedAt: new Date() });
    await expect(service.uploadReceipt('tok', file, 'https://app')).resolves.toEqual({ received: true });
    expect(files.store).toHaveBeenCalledWith('org1', 'c1', 'payment-receipt', file);
    expect(prisma.contract.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'c1', paymentReceiptKey: null },
      data: { paymentReceiptKey: 'contracts/org1/c1/payment-receipt-1.pdf' },
    });
    expect(notifier.receiptUploaded).toHaveBeenCalledWith('org1', expect.objectContaining({ id: 'c1' }), 'https://app/contratos/c1');
    expect(realtime.emitToOrg).toHaveBeenCalledWith('org1', 'contract:changed', { id: 'c1' });
  });

  it('segundo comprovante pelo link dá 409', async () => {
    const { service } = make({ ...C, acceptedAt: new Date(), paymentReceiptKey: 'k' });
    await expect(service.uploadReceipt('tok', file, 'https://app')).rejects.toBeInstanceOf(ConflictException);
  });

  it('corrida no comprovante (count 0) dá 409 e não avisa', async () => {
    const { service, notifier } = make({ ...C, acceptedAt: new Date() }, 0);
    await expect(service.uploadReceipt('tok', file, 'https://app')).rejects.toBeInstanceOf(ConflictException);
    expect(notifier.receiptUploaded).not.toHaveBeenCalled();
  });
});
