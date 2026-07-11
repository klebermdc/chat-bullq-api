import { ExtractedCart } from './proposals.types';

function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function pax(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildProposalMessage(cart: ExtractedCart, checkoutUrl: string): string {
  let peopleLine = `Para ${pax(cart.adults, 'Adulto', 'Adultos')}`;
  if (cart.children > 0) {
    peopleLine += ` e ${pax(cart.children, 'Criança', 'Crianças')}`;
  }
  peopleLine += ` entre os dias ${formatDateBR(cart.startDate)} e ${formatDateBR(cart.endDate)}`;

  const parkLines = cart.parks
    .map((p) => `${p.nome} [${p.dias} dias] - ${formatDateBR(p.data)}`)
    .join('\n');

  return (
    '🎉 Preparamos sua proposta com todo carinho para que sua experiência em Orlando ' +
    'seja mágica e sem preocupações. Aqui estão os detalhes:\n\n' +
    `👉 ${checkoutUrl}\n\n` +
    'Proposta Orlando Fast Pass\n' +
    `${peopleLine}\n\n` +
    parkLines
  );
}
