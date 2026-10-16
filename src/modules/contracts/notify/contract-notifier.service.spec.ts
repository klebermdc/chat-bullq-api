import { ContractNotifierService } from './contract-notifier.service';

function make(settings: any) {
  const resend = { sendTransactional: jest.fn().mockResolvedValue({ providerId: 'e1' }) } as any;
  const settingsSvc = { get: jest.fn().mockResolvedValue(settings) } as any;
  return { service: new ContractNotifierService(resend, settingsSvc), resend, settingsSvc };
}

const contract = { id: 'c1', fullName: 'Ana <script>', email: 'ana@x.com', guideName: 'Kleber', requestedDates: '02/12/2026 - EPCOT' };

describe('ContractNotifierService.receiptUploaded', () => {
  it('envia para o e-mail configurado, com HTML escapado e link do painel', async () => {
    const { service, resend } = make({ receiptNotifyEmail: 'ops@x.com' });
    await service.receiptUploaded('org1', contract as any, 'https://app/contratos/c1');
    const arg = resend.sendTransactional.mock.calls[0][0];
    expect(arg.to).toBe('ops@x.com');
    expect(arg.subject).toContain('Ana');
    expect(arg.html).toContain('Ana &lt;script&gt;');
    expect(arg.html).toContain('https://app/contratos/c1');
  });

  it('sem destinatário configurado não envia', async () => {
    const { service, resend } = make({ receiptNotifyEmail: null });
    await service.receiptUploaded('org1', contract as any, 'x');
    expect(resend.sendTransactional).not.toHaveBeenCalled();
  });

  it('falha no envio não propaga', async () => {
    const { service, resend } = make({ receiptNotifyEmail: 'ops@x.com' });
    resend.sendTransactional.mockRejectedValue(new Error('down'));
    await expect(service.receiptUploaded('org1', contract as any, 'x')).resolves.toBeUndefined();
  });

  it('falha ao ler as configurações não propaga', async () => {
    const { service, resend, settingsSvc } = make({ receiptNotifyEmail: 'ops@x.com' });
    settingsSvc.get.mockRejectedValue(new Error('db down'));
    await expect(service.receiptUploaded('org1', contract as any, 'x')).resolves.toBeUndefined();
    expect(resend.sendTransactional).not.toHaveBeenCalled();
  });

  it('tira quebras de linha e tabs do nome no assunto', async () => {
    const { service, resend } = make({ receiptNotifyEmail: 'ops@x.com' });
    await service.receiptUploaded('org1', { ...contract, fullName: 'Ana\r\nBcc: x@y.com\tZ' } as any, 'https://app/contratos/c1');
    const { subject } = resend.sendTransactional.mock.calls[0][0];
    expect(subject).not.toMatch(/[\r\n\t]/);
    expect(subject).toContain('Ana Bcc: x@y.com Z');
  });

  it('sem URL do painel manda o e-mail sem link', async () => {
    const { service, resend } = make({ receiptNotifyEmail: 'ops@x.com' });
    await service.receiptUploaded('org1', contract as any, null);
    const arg = resend.sendTransactional.mock.calls[0][0];
    expect(arg.html).not.toContain('<a ');
    expect(arg.html).not.toContain('href');
    expect(arg.text).not.toContain('Abrir:');
    expect(arg.text).toContain('Ana');
  });
});
