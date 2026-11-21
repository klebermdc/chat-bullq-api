import { BadRequestException } from '@nestjs/common';
import { HubOrderService } from './hub-order.service';
import { HubOrderInput } from './hub-order.row';

const ORG = 'org-1';
const CONTACT = { id: 'ct-1', name: 'Bernardo Vieira', email: 'x@y.com', phone: '5562999998888' };
const SELLER = { name: 'Renata Souza', email: 'renata@ofp.com' };

function cardRow(over: Record<string, unknown> = {}) {
  return {
    id: 'card-1',
    title: 'Bernardo — Orlando',
    status: 'OPEN',
    value: null,
    closedAt: null,
    updatedAt: new Date('2026-11-17T00:00:00Z'),
    metadata: {},
    contactId: CONTACT.id,
    assignedTo: SELLER,
    conversation: null,
    ...over,
  };
}

function make(over: { linked?: unknown; contacts?: unknown[]; cards?: unknown[] } = {}) {
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue(over.contacts ?? [CONTACT]),
    card: {
      findFirst: jest.fn().mockResolvedValue(over.linked ?? null),
      findMany: jest.fn().mockResolvedValue(over.cards ?? []),
    },
    contact: { findFirst: jest.fn().mockResolvedValue(CONTACT) },
    ofpSalesOrder: { upsert: jest.fn().mockResolvedValue({}) },
  } as any;
  const reconciliation = { link: jest.fn().mockResolvedValue({ linked: true }) } as any;
  return { service: new HubOrderService(prisma, reconciliation), prisma, reconciliation };
}

const input: HubOrderInput = {
  externalId: '9b1d1c3e-1111-4222-8333-944455556666',
  pedido: '4853LD',
  cliente: 'Bernardo Vieira',
  email: 'X@Y.com ',
  telefone: '(62) 99999-8888',
  venda: 21369.49,
  data: '2026-11-18',
  vendedor: 'Renata',
  fornecedor: 'Azul Viagens',
};

describe('HubOrderService.markWon', () => {
  it('pedido já ligado a um card da org → already_linked, sem gravar nada', async () => {
    const { service, prisma, reconciliation } = make({ linked: cardRow({ status: 'WON' }) });
    const res = await service.markWon(ORG, input);

    expect(res).toEqual({ result: 'already_linked', cardId: 'card-1', contact: CONTACT, seller: SELLER, candidates: 0 });
    expect(prisma.card.findFirst.mock.calls[0][0].where).toMatchObject({
      organizationId: ORG,
      metadata: { path: ['ofpOrderExternalId'], equals: input.externalId },
    });
    expect(prisma.ofpSalesOrder.upsert).not.toHaveBeenCalled();
    expect(reconciliation.link).not.toHaveBeenCalled();
  });

  it('grava o pedido no formato do sync (dataRaw dd/mm/aaaa) pela chave externalId', async () => {
    const { service, prisma } = make({ contacts: [] });
    await service.markWon(ORG, input);

    const call = prisma.ofpSalesOrder.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ externalId: input.externalId });
    expect(call.create).toMatchObject({
      externalId: input.externalId,
      pedido: '4853LD',
      emailCliente: 'X@Y.com',
      venda: 21369.49,
      dataRaw: '18/11/2026',
      fornecedor: 'Azul Viagens',
    });
    expect(call.update.externalId).toBeUndefined();
  });

  it('nenhum contato → no_contact', async () => {
    const { service, reconciliation } = make({ contacts: [] });
    const res = await service.markWon(ORG, input);
    expect(res).toEqual({ result: 'no_contact', cardId: null, contact: null, seller: null, candidates: 0 });
    expect(reconciliation.link).not.toHaveBeenCalled();
  });

  it('um card OPEN → won: liga e move pra Ganho SEM Purchase da Meta (o Hub já mandou)', async () => {
    const { service, prisma, reconciliation } = make({ cards: [cardRow()] });
    const res = await service.markWon(ORG, input);

    expect(res).toEqual({ result: 'won', cardId: 'card-1', contact: CONTACT, seller: SELLER, candidates: 1 });
    expect(reconciliation.link).toHaveBeenCalledWith(input.externalId, 'card-1', ORG, {
      moveToWon: true,
      skipCapi: true,
    });
    expect(prisma.card.findMany.mock.calls[0][0].where).toMatchObject({
      organizationId: ORG,
      contactId: { in: [CONTACT.id] },
    });
  });

  it('só um Ganho recente sem pedido → linked_existing, sem mexer na etapa', async () => {
    const won = cardRow({ status: 'WON', closedAt: new Date(2026, 10, 17) });
    const { service, reconciliation } = make({ cards: [won] });
    const res = await service.markWon(ORG, input);

    expect(res.result).toBe('linked_existing');
    expect(reconciliation.link).toHaveBeenCalledWith(input.externalId, 'card-1', ORG, {
      moveToWon: false,
      skipCapi: true,
    });
  });

  it('dois cards sem desempate → ambiguous, não liga', async () => {
    const { service, reconciliation } = make({
      cards: [cardRow({ id: 'a' }), cardRow({ id: 'b' })],
    });
    const res = await service.markWon(ORG, input);
    expect(res).toMatchObject({ result: 'ambiguous', cardId: null, candidates: 2, contact: CONTACT });
    expect(reconciliation.link).not.toHaveBeenCalled();
  });

  it('nenhum card → no_card', async () => {
    const { service } = make({ cards: [] });
    expect((await service.markWon(ORG, input)).result).toBe('no_card');
  });

  it('data inexistente → 400', async () => {
    const { service } = make();
    await expect(service.markWon(ORG, { ...input, data: '2026-02-31' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('HubOrderService.lookup', () => {
  it('sem e-mail nem telefone utilizável → 400', async () => {
    const { service } = make();
    await expect(service.lookup(ORG, { phone: '123' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('devolve o card OPEN, o vendedor da conversa e a contagem de abertos', async () => {
    const conversationSeller = { name: 'Maria', email: 'maria@ofp.com' };
    const { service } = make({
      cards: [
        cardRow({ id: 'a', assignedTo: null, conversation: { assignedTo: conversationSeller }, value: 1500 }),
        cardRow({ id: 'b', updatedAt: new Date('2026-11-01T00:00:00Z') }),
      ],
    });
    const res = await service.lookup(ORG, { email: 'x@y.com' }, new Date('2026-11-21T12:00:00Z'));

    expect(res).toEqual({
      contact: CONTACT,
      card: { id: 'a', title: 'Bernardo — Orlando', status: 'OPEN', value: 1500 },
      seller: conversationSeller,
      openCards: 2,
    });
  });

  it('contato sem card → só o contato', async () => {
    const { service } = make({ cards: [] });
    const res = await service.lookup(ORG, { phone: '+55 62 99999-8888' });
    expect(res).toEqual({ contact: CONTACT, card: null, seller: null, openCards: 0 });
  });
});
