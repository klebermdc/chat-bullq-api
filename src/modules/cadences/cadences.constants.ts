export const CADENCE_DEFAULT_STEPS = [
  { order: 1, delayMinutes: 1440,  text: 'Oi, {nome}! Tudo bem? Te enviei a proposta da sua viagem e quero saber se conseguiu dar uma olhadinha 👀 Se quiser, podemos marcar uma ligação rápida ou até ajustar algo para ficar perfeito para você ❤️', options: ['SIM', 'NAO'] },
  { order: 2, delayMinutes: 4320,  text: 'Oi, {nome}! 😊 Como está? Ainda tenho as condições especiais da sua proposta válidas, e posso ajustar qualquer ponto que você precisa. Me diz se podemos seguir?', options: ['SIM', 'NAO'] },
  { order: 3, delayMinutes: 7200, text: 'Olá, {nome}! 😊 Quero garantir que você aproveite as melhores tarifas e disponibilidade para a sua viagem 😍 Se quiser, podemos fechar ainda hoje e já garantir tudo para sua data ❤️', options: ['SIM', 'NAO'] },
  { order: 4, delayMinutes: 10080, text: 'Oi, {nome} ❤️ Antes de encerrar seu atendimento, quero confirmar se ainda tem interesse na viagem 🙏 Caso sim, é só me responder por aqui que já retomamos de onde paramos 😊', options: ['SIM', 'NAO', 'DESCADASTRAR'] },
] as const;

export const OPTION_LABELS: Record<string, string> = {
  SIM: '1 - Sim', NAO: '2 - Não', DESCADASTRAR: '3 - Não quero mais receber',
};

export const DEFAULT_ON_YES_MESSAGE =
  'Perfeito, {nome}! 😊 Já vou te encaminhar para um de nossos atendentes. Só um instante que já continuam com você por aqui. 💜';
export const DEFAULT_ON_NO_MESSAGE =
  'Tudo bem, {nome}! 🙏 Agradecemos muito o seu contato. Se mudar de ideia ou precisar de qualquer coisa, é só chamar por aqui. Um abraço e boa viagem! 💜';

/**
 * Reengajamento de entrada: leads que pararam de responder à Aline antes de
 * chegar num humano. 3 toques rápidos (3h/24h/3d). Sem botões Sim/Não — qualquer
 * resposta faz a Aline reassumir; opt-out é detectado por keyword no classifier.
 */
export const CADENCE_NO_REPLY_DEFAULT_STEPS = [
  { order: 1, delayMinutes: 180,  text: 'Oi, {nome}! 😊 Vi que ficou por aqui. Quer que eu continue montando seu roteiro pra Orlando?', options: [] as string[] },
  { order: 2, delayMinutes: 1440, text: '{nome}, ainda dá tempo de garantir os melhores preços pra sua viagem 🏰 Posso te ajudar a fechar os detalhes?', options: [] as string[] },
  { order: 3, delayMinutes: 4320, text: '{nome}, vou encerrar seu atendimento por aqui por ora 💜 Mas é só me chamar quando quiser retomar seu orçamento pra Orlando!', options: [] as string[] },
] as const;
