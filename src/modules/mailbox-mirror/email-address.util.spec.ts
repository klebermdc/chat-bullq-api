import { MailboxContactRole } from '@prisma/client';
import {
  collectRoleAddresses,
  domainOf,
  linkableAddresses,
  normalizeEmailAddress,
} from './email-address.util';

describe('normalizeEmailAddress', () => {
  it('põe em minúsculas e tira espaços', () => {
    expect(normalizeEmailAddress('  Maria.Silva@Gmail.COM ')).toBe('maria.silva@gmail.com');
  });

  it('tira os sinais < > de um endereço copiado do cabeçalho', () => {
    expect(normalizeEmailAddress('<joao@ofp.com>')).toBe('joao@ofp.com');
  });

  it('devolve null para vazio ou sem @', () => {
    expect(normalizeEmailAddress('')).toBeNull();
    expect(normalizeEmailAddress(undefined)).toBeNull();
    expect(normalizeEmailAddress('undisclosed-recipients')).toBeNull();
    expect(normalizeEmailAddress('a@')).toBeNull();
  });
});

describe('domainOf', () => {
  it('pega o domínio em minúsculas', () => {
    expect(domainOf('Reservas@OrlandoFastPass.com.br')).toBe('orlandofastpass.com.br');
  });
});

describe('collectRoleAddresses', () => {
  it('junta From/Reply-To/To/Cc, inclusive grupos, sem repetir o mesmo par', () => {
    const result = collectRoleAddresses({
      from: [{ address: 'Cliente@Gmail.com', name: 'Cliente' }],
      replyTo: [{ address: 'cliente@gmail.com', name: '' }],
      to: [
        { address: 'reservas@ofp.com.br', name: '' },
        { name: 'Grupo', group: [{ address: 'b@x.com', name: '' }, { address: 'B@x.com', name: '' }] },
      ],
      cc: [],
    });

    expect(result).toEqual([
      { address: 'cliente@gmail.com', role: MailboxContactRole.FROM },
      { address: 'cliente@gmail.com', role: MailboxContactRole.REPLY_TO },
      { address: 'reservas@ofp.com.br', role: MailboxContactRole.TO },
      { address: 'b@x.com', role: MailboxContactRole.TO },
    ]);
  });
});

describe('linkableAddresses', () => {
  const mailbox = { address: 'reservas@orlandofastpass.com.br', ignoredDomains: ['Equipe.com'] };

  it('ignora a própria caixa, o domínio da org e os domínios extras', () => {
    const result = linkableAddresses(
      [
        { address: 'reservas@orlandofastpass.com.br', role: MailboxContactRole.TO },
        { address: 'vendas@orlandofastpass.com.br', role: MailboxContactRole.CC },
        { address: 'ana@equipe.com', role: MailboxContactRole.CC },
        { address: 'cliente@gmail.com', role: MailboxContactRole.FROM },
      ],
      mailbox,
    );

    expect(result).toEqual([{ address: 'cliente@gmail.com', role: MailboxContactRole.FROM }]);
  });

  it('não devolve nada quando só há endereços da casa', () => {
    expect(
      linkableAddresses([{ address: 'x@orlandofastpass.com.br', role: MailboxContactRole.FROM }], mailbox),
    ).toEqual([]);
  });
});
