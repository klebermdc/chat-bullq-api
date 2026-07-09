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
