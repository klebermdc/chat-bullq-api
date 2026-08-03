import { EmailSubscriberSource } from '@prisma/client';
import { SubscriberImportService, parseCsv } from './subscriber-import.service';

describe('parseCsv', () => {
  it('lê email e nome, descartando o cabeçalho', () => {
    expect(parseCsv('email,nome\njoao@exemplo.com,João\nmaria@exemplo.com,Maria')).toEqual([
      { email: 'joao@exemplo.com', name: 'João' },
      { email: 'maria@exemplo.com', name: 'Maria' },
    ]);
  });

  it('aceita ponto e vírgula como separador', () => {
    expect(parseCsv('joao@exemplo.com;João')).toEqual([{ email: 'joao@exemplo.com', name: 'João' }]);
  });

  it('ignora linhas em branco', () => {
    expect(parseCsv('joao@exemplo.com\n\n  \n')).toHaveLength(1);
  });

  it('devolve a linha malformada em vez de descartar em silêncio', () => {
    expect(parseCsv('joao@exemplo.com\nlinha-sem-arroba')).toEqual([
      { email: 'joao@exemplo.com', name: undefined },
      { email: 'linha-sem-arroba', name: undefined },
    ]);
  });
});

describe('SubscriberImportService', () => {
  function make() {
    const upserted: any[] = [];
    const subscribers = {
      upsert: jest.fn(async (_org: string, input: any) => {
        if (!input.email.includes('@')) throw new Error('endereço inválido');
        upserted.push(input);
        return { id: `sub_${upserted.length}` };
      }),
    };
    const prisma = {
      contact: {
        findMany: jest.fn(async () => [
          { id: 'c1', email: 'joao@exemplo.com', name: 'João' },
          { id: 'c2', email: null, name: 'Sem email' },
        ]),
      },
      ofpSalesOrder: {
        findMany: jest.fn(async () => [
          { emailCliente: 'maria@exemplo.com', cliente: 'Maria', pedido: '88213' },
        ]),
      },
    };
    return { service: new SubscriberImportService(prisma as any, subscribers as any), upserted };
  }

  it('importa contatos do CRM ignorando quem não tem email', async () => {
    const { service, upserted } = make();
    expect(await service.fromContacts('org_1')).toEqual({ imported: 1, skipped: 1, errors: [] });
    expect(upserted[0].source).toBe(EmailSubscriberSource.CRM_CONTACT);
    expect(upserted[0].contactId).toBe('c1');
  });

  it('importa pedidos do HUB carimbando a procedência do consentimento', async () => {
    const { service, upserted } = make();
    await service.fromSalesOrders('org_1');
    expect(upserted[0].source).toBe(EmailSubscriberSource.OFP_ORDER);
    expect(upserted[0].consentSource).toBe('hub:pedido-88213');
  });

  it('relata as linhas rejeitadas do CSV em vez de engoli-las', async () => {
    const { service } = make();
    const r = await service.fromCsv('org_1', 'joao@exemplo.com,João\nlixo-sem-arroba,Fulano');
    expect(r.imported).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('lixo-sem-arroba');
  });

  it('uma linha ruim não aborta a importação inteira', async () => {
    const { service } = make();
    const r = await service.fromCsv('org_1', 'lixo\njoao@exemplo.com\noutro-lixo\nmaria@exemplo.com');
    expect(r.imported).toBe(2);
    expect(r.errors).toHaveLength(2);
  });
});
