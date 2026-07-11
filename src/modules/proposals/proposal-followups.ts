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
