import {
  EMERGENCY_PHONE,
  buildEmergencyLink,
  customerTextOf,
  isQuoteFromCustomer,
  mentionsEmergencyPhone,
} from './emergency-contact.util';

describe('buildEmergencyLink', () => {
  it('abre o WhatsApp de emergência com a mensagem do cliente já escrita', () => {
    const link = buildEmergencyLink('Maria Souza', 'ingresso não passa na catraca do Magic Kingdom');

    expect(link.startsWith('https://wa.me/551151941724?text=')).toBe(true);
    const text = decodeURIComponent(link.split('?text=')[1]);
    expect(text).toBe(
      'Olá! Sou Maria Souza, cliente da Orlando Fast Pass. Estou em viagem e preciso de ajuda urgente: ingresso não passa na catraca do Magic Kingdom',
    );
  });

  it('sem nome do contato, a mensagem continua de pé', () => {
    const text = decodeURIComponent(buildEmergencyLink(null, 'transfer não apareceu').split('?text=')[1]);

    expect(text).toBe(
      'Olá! Sou cliente da Orlando Fast Pass. Estou em viagem e preciso de ajuda urgente: transfer não apareceu',
    );
  });
});

describe('mentionsEmergencyPhone', () => {
  it.each([
    `liga no ${EMERGENCY_PHONE}`,
    'chama no 11 5194-1724',
    'whats 1151941724',
    '+55 11 5194 1724',
    'https://wa.me/551151941724',
    '5194.1724',
  ])('acha o número em "%s"', (text) => {
    expect(mentionsEmergencyPhone(text)).toBe(true);
  });

  it.each(['seu pedido é o 5194', 'o valor é R$ 1.724,00', 'liga no (11) 5198-4190', ''])(
    'não confunde "%s" com o número de emergência',
    (text) => {
      expect(mentionsEmergencyPhone(text)).toBe(false);
    },
  );
});

describe('isQuoteFromCustomer', () => {
  const customer = ['Oi, tudo bem?', 'Já estou em Orlando, no Magic Kingdom, e o ingresso NÃO passa na catraca!'];

  it('aceita trecho literal de uma mensagem do cliente, sem ligar para acento e maiúscula', () => {
    expect(isQuoteFromCustomer('estou em orlando, no magic kingdom', customer)).toBe(true);
    expect(isQuoteFromCustomer('o ingresso nao passa na catraca', customer)).toBe(true);
  });

  it('recusa frase que o cliente não escreveu', () => {
    expect(isQuoteFromCustomer('estou no aeroporto de Orlando', customer)).toBe(false);
  });

  it('recusa trecho curto demais para provar alguma coisa', () => {
    expect(isQuoteFromCustomer('orlando', customer)).toBe(false);
  });
});

describe('customerTextOf', () => {
  it('lê texto, legenda e transcrição de áudio', () => {
    expect(customerTextOf({ content: { text: 'oi' }, metadata: null })).toBe('oi');
    expect(customerTextOf({ content: { caption: 'foto da catraca' }, metadata: null })).toBe('foto da catraca');
    expect(
      customerTextOf({ content: { mediaUrl: 'x' }, metadata: { transcription: { text: 'tô no hotel' } } }),
    ).toBe('tô no hotel');
    expect(customerTextOf({ content: null, metadata: null })).toBe('');
  });
});
