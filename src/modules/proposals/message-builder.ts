import { ExtractedCart } from './proposals.types';

function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function pax(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export type ProposalMode = 'NEW' | 'UPDATE';

const INTRO: Record<ProposalMode, string> = {
  NEW:
    '🎉 Preparamos sua proposta com todo carinho para que sua experiência em Orlando ' +
    'seja mágica e sem preocupações. Aqui estão os detalhes:',
  UPDATE: 'Prontinho! Ajustei sua proposta com o que você pediu 👇',
};

export interface ProposalMessageOptions {
  /**
   * false = manda a proposta inteira SEM a linha do link do checkout (o
   * atendente ainda não quer que o cliente pague/abra o carrinho). Default true.
   */
  includeLink?: boolean;
}

export function buildProposalMessage(
  cart: ExtractedCart,
  checkoutUrl: string,
  mode: ProposalMode = 'NEW',
  { includeLink = true }: ProposalMessageOptions = {},
): string {
  let peopleLine = `Para ${pax(cart.adults, 'Adulto', 'Adultos')}`;
  if (cart.children > 0) {
    peopleLine += ` e ${pax(cart.children, 'Criança', 'Crianças')}`;
  }
  peopleLine += ` entre os dias ${formatDateBR(cart.startDate)} e ${formatDateBR(cart.endDate)}`;

  const parkLines = cart.parks
    .map((p) => `${p.nome} [${p.dias} dias] - ${formatDateBR(p.data)}`)
    // linha em branco entre cada produto, para dar respiro na leitura no WhatsApp
    .join('\n\n');

  return (
    `${INTRO[mode]}\n\n` +
    (includeLink ? `👉 ${checkoutUrl}\n\n` : '') +
    'Proposta Orlando Fast Pass\n' +
    `${peopleLine}\n\n` +
    parkLines
  );
}
