/**
 * Mensagens enviadas em sequência DEPOIS da proposta principal, SÓ na primeira
 * proposta (modo NEW), pra reforçar confiança e engajar o cliente. Cada string
 * vira uma mensagem separada no WhatsApp, na ordem do array.
 *
 * Fixo por enquanto — pode virar config por org numa fatia futura.
 * A mensagem do Reclame AQUI (com imagem) entra aqui quando a imagem for
 * hospedada (aí vira um envio de mídia, não texto).
 */
export const PROPOSAL_NEW_FOLLOWUPS: string[] = [
  '🌟 Para que sua viagem seja perfeita, revise os detalhes: parques, datas de ' +
    'visitação e quantidade de passageiros. Essa conferência é essencial e de sua ' +
    'responsabilidade, pois o fechamento será feito conforme os dados informados. ' +
    'Assim, evitamos qualquer imprevisto e garantimos sua experiência mágica em Orlando 🎢🏰',
  'Abaixo estão as nossas referências:\n' +
    'https://www.instagram.com/orlando.fastpass/\n' +
    'https://orlandofastpass.com.br/certificados/',
];

/**
 * Mesma sequência para proposta que NÃO é de ingresso (carro, hotel, transfer…):
 * a conferência não pode falar em "parques" e "datas de visitação" depois de
 * uma cotação de carro. As referências são as mesmas.
 */
export const PROPOSAL_NEW_FOLLOWUPS_OTHER: string[] = [
  '🌟 Para que tudo saia perfeito, revise com atenção os detalhes desta proposta: ' +
    'produto, datas, quantidades e valores. Essa conferência é essencial e de sua ' +
    'responsabilidade, pois o fechamento será feito conforme os dados informados. ' +
    'Assim, evitamos qualquer imprevisto na sua viagem a Orlando 🎢🏰',
  PROPOSAL_NEW_FOLLOWUPS[1],
];
