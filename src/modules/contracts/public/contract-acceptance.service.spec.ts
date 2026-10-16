import { BadRequestException, ConflictException, GoneException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { crc32, deflateSync } from 'zlib';
import { ContractAcceptanceService, maskCpf } from './contract-acceptance.service';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** PNG RGBA real de `w`x`h`; `raw: false` só declara as dimensões (sem IDAT). */
function png(w: number, h: number, raw = true): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = raw ? [chunk('IDAT', deflateSync(Buffer.alloc((1 + w * 4) * h)))] : [];
  return Buffer.concat([Buffer.from(PNG_MAGIC), chunk('IHDR', ihdr), ...idat, chunk('IEND', Buffer.alloc(0))]);
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const PNG_B64 = png(200, 60).toString('base64');
const SIG = `data:image/png;base64,${PNG_B64}`;
const TERMS_HASH = sha256('TERMOS');
const BODY = { signature: SIG, agree: true, termsHash: TERMS_HASH };
/** Deixa rodar o que o aceite disparou em segundo plano (PDF). */
const flush = () => new Promise((r) => setImmediate(r));
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
    expect(v.termsHash).toBe(TERMS_HASH);
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
    const v = await service.view('tok');
    expect(v.terms).toBe('ACEITOS');
    expect(v.termsHash).toBe(sha256('ACEITOS'));
  });

  it('token inexistente dá 404', async () => {
    const { service } = make(null);
    await expect(service.view('x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('accept', () => {
  it('grava evidência de forma atômica, com IP e hora do servidor e snapshot dos termos', async () => {
    const { service, prisma, storage, realtime } = make(C);
    await service.accept('tok', BODY, META);
    const arg = prisma.contract.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'c1', acceptedAt: null });
    expect(arg.data).toMatchObject({ clientIp: '1.2.3.4', clientUserAgent: 'UA', acceptedTermsText: 'TERMOS' });
    expect(arg.data.acceptedAt).toBeInstanceOf(Date);
    expect(arg.data.signatureKey).toMatch(new RegExp(`^contracts/org1/c1/signature-${UUID}\\.png$`));
    expect(storage.put).toHaveBeenCalledWith(arg.data.signatureKey, expect.any(Buffer), 'image/png');
    expect(realtime.emitToOrg).toHaveBeenCalledWith('org1', 'contract:accepted', { id: 'c1' });
  });

  it('gera o PDF depois do update, com a assinatura, e guarda a chave', async () => {
    const { service, prisma, storage, contracts } = make(C);
    await service.accept('tok', BODY, META);
    await flush();
    expect(prisma.contract.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      contracts.buildPdfInput.mock.invocationCallOrder[0],
    );
    expect(contracts.buildPdfInput).toHaveBeenCalledWith(
      'org1',
      expect.objectContaining({ id: 'c1' }),
      expect.objectContaining({ ip: '1.2.3.4', userAgent: 'UA', signaturePngBase64: PNG_B64, acceptedTerms: 'TERMOS' }),
    );
    const pdfKey = storage.put.mock.calls[1][0];
    expect(pdfKey).toMatch(new RegExp(`^contracts/org1/c1/acceptance-${UUID}\\.pdf$`));
    expect(prisma.contract.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { acceptancePdfKey: pdfKey } });
  });

  it('corta o user agent em 500 caracteres', async () => {
    const { service, prisma } = make(C);
    await service.accept('tok', BODY, { ip: 'i', userAgent: 'x'.repeat(2000) });
    expect(prisma.contract.updateMany.mock.calls[0][0].data.clientUserAgent).toHaveLength(500);
  });

  it('segundo aceite (corrida) dá 410', async () => {
    const { service } = make(C, 0);
    await expect(service.accept('tok', BODY, META)).rejects.toBeInstanceOf(GoneException);
  });

  it('já aceito dá 410 sem gravar nada', async () => {
    const { service, storage, prisma } = make({ ...C, acceptedAt: new Date() });
    await expect(service.accept('tok', BODY, META)).rejects.toBeInstanceOf(GoneException);
    expect(storage.put).not.toHaveBeenCalled();
    expect(prisma.contract.updateMany).not.toHaveBeenCalled();
  });

  it('assinatura inválida ou sem concordância dá 400 antes de qualquer acesso ao banco ou storage', async () => {
    const { service, prisma, storage } = make(C);
    const bad = [
      { ...BODY, signature: 'data:image/png;base64,PHN2Zz4=' },
      { ...BODY, signature: 'data:image/svg+xml;base64,PHN2Zz4=' },
      { ...BODY, signature: '' },
      { ...BODY, signature: `data:image/png;base64,${Buffer.from([...PNG_MAGIC, 1, 2, 3]).toString('base64')}` },
      { ...BODY, signature: `data:image/png;base64,${png(30000, 30000, false).toString('base64')}` },
      { ...BODY, agree: false },
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
      service.accept('tok', { ...BODY, signature: `data:image/png;base64,${big}` }, META),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('termos da org vazios dão 400 sem gravar nada', async () => {
    const { service, storage, prisma } = make(C, 1, { terms: '   ' });
    await expect(service.accept('tok', BODY, META)).rejects.toThrow(
      'Termos do contrato não configurados',
    );
    expect(storage.put).not.toHaveBeenCalled();
    expect(prisma.contract.updateMany).not.toHaveBeenCalled();
  });

  it('falha no PDF não desfaz o aceite', async () => {
    const { service, pdf, realtime } = make(C);
    pdf.render.mockRejectedValue(new Error('chromium'));
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(service.accept('tok', BODY, META)).resolves.toMatchObject({ accepted: true });
    expect(realtime.emitToOrg).toHaveBeenCalledWith('org1', 'contract:accepted', { id: 'c1' });
    await flush();
    expect(pdf.render).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('contract_acceptance_pdf_failed contract=c1'));
  });

  it('responde sem esperar o PDF: emite o evento e devolve antes de o render terminar', async () => {
    const { service, pdf, realtime, prisma } = make(C);
    pdf.render.mockReturnValue(new Promise(() => undefined));
    await expect(service.accept('tok', BODY, META)).resolves.toMatchObject({ accepted: true });
    expect(realtime.emitToOrg).toHaveBeenCalledWith('org1', 'contract:accepted', { id: 'c1' });
    await flush();
    expect(pdf.render).toHaveBeenCalled();
    expect(prisma.contract.update).not.toHaveBeenCalled();
  });

  it('termos mudaram depois que o cliente abriu a página: 409 sem gravar nada', async () => {
    const { service, storage, prisma } = make(C, 1, { terms: 'TERMOS NOVOS' });
    const err = await service.accept('tok', BODY, META).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe('Os termos foram atualizados. Recarregue a página e leia de novo antes de aceitar.');
    expect(storage.put).not.toHaveBeenCalled();
    expect(prisma.contract.updateMany).not.toHaveBeenCalled();
  });

  it('termsHash ausente ou malformado dá 409 sem gravar nada', async () => {
    const { service, storage } = make(C);
    for (const termsHash of ['', 'x', sha256('OUTRO')]) {
      await expect(service.accept('tok', { ...BODY, termsHash }, META)).rejects.toBeInstanceOf(ConflictException);
    }
    expect(storage.put).not.toHaveBeenCalled();
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

  it('falha no aviso por e-mail não derruba o comprovante já gravado', async () => {
    const { service, notifier, realtime } = make({ ...C, acceptedAt: new Date() });
    notifier.receiptUploaded.mockRejectedValue(new Error('smtp'));
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(service.uploadReceipt('tok', file, 'https://app')).resolves.toEqual({ received: true });
    expect(realtime.emitToOrg).toHaveBeenCalledWith('org1', 'contract:changed', { id: 'c1' });
  });

  it('sem APP_PUBLIC_URL avisa sem link (não gera link relativo)', async () => {
    const { service, notifier } = make({ ...C, acceptedAt: new Date() });
    await service.uploadReceipt('tok', file, '');
    expect(notifier.receiptUploaded).toHaveBeenCalledWith('org1', expect.objectContaining({ id: 'c1' }), null);
  });
});
