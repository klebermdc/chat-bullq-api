export const CADENCE_DEFAULT_STEPS = [
  { order: 1, delayHours: 24,  text: 'Oi, {nome}! Tudo bem? Te enviei a proposta da sua viagem e quero saber se conseguiu dar uma olhadinha 👀 Se quiser, podemos marcar uma ligação rápida ou até ajustar algo para ficar perfeito para você ❤️', options: ['SIM', 'NAO'] },
  { order: 2, delayHours: 72,  text: 'Oi, {nome}! 😊 Como está? Ainda tenho as condições especiais da sua proposta válidas, e posso ajustar qualquer ponto que você precisa. Me diz se podemos seguir?', options: ['SIM', 'NAO'] },
  { order: 3, delayHours: 120, text: 'Olá, {nome}! 😊 Quero garantir que você aproveite as melhores tarifas e disponibilidade para a sua viagem 😍 Se quiser, podemos fechar ainda hoje e já garantir tudo para sua data ❤️', options: ['SIM', 'NAO'] },
  { order: 4, delayHours: 168, text: 'Oi, {nome} ❤️ Antes de encerrar seu atendimento, quero confirmar se ainda tem interesse na viagem 🙏 Caso sim, é só me responder por aqui que já retomamos de onde paramos 😊', options: ['SIM', 'NAO', 'DESCADASTRAR'] },
] as const;

export const OPTION_LABELS: Record<string, string> = {
  SIM: '1 - Sim', NAO: '2 - Não', DESCADASTRAR: '3 - Não quero mais receber',
};
