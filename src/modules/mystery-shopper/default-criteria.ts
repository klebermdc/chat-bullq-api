import type { VisitCriterion } from './mystery-shopper.types';

/**
 * Critérios iniciais. Viram skills editáveis em Agentes de IA > Skills
 * (categoria cliente-oculto). A 1ª resposta é medida por código e não é skill.
 */
export const DEFAULT_MYSTERY_CRITERIA: VisitCriterion[] = [
  {
    name: 'ocultoDescoberta',
    description: 'Descoberta',
    instructions:
      'Pergunta datas, número de pessoas, idades, parques de interesse e orçamento antes de passar preço. 2 = perguntou quase tudo; 1 = perguntou parte; 0 = mandou valor sem perguntar.',
  },
  {
    name: 'ocultoCotacao',
    description: 'Cotação adequada',
    instructions:
      'Envia cotação ou proposta que bate com o que o cliente pediu (datas, pessoas, parques). Use o fato "Proposta enviada". 0 = não mandou nada; 1 = mandou genérica; 2 = mandou sob medida.',
  },
  {
    name: 'ocultoInformacao',
    description: 'Informação correta',
    instructions:
      'As informações batem com as regras de produto escritas. Sem regras escritas, só aponte contradição evidente dentro da própria conversa.',
  },
  {
    name: 'ocultoObjecao',
    description: 'Tratamento da objeção',
    instructions:
      'Quando o cliente acha caro, compara com concorrente ou hesita, entende o motivo e mostra valor antes de falar em desconto. Use null se não houve objeção.',
  },
  {
    name: 'ocultoFechamento',
    description: 'Fechamento e próximo passo',
    instructions:
      'Convida para fechar ou combina um próximo passo concreto (data, horário, condição). 0 = deixou a conversa morrer.',
  },
  {
    name: 'ocultoFollowUp',
    description: 'Follow-up',
    instructions:
      'Depois da última mensagem do cliente, retoma o contato com algo útil (nova condição, dúvida, prazo), não só "e aí?". Sem follow-up o sistema dá 0 sozinho.',
  },
  {
    name: 'ocultoTom',
    description: 'Tom e cordialidade',
    instructions: 'Cumprimenta, usa o nome do cliente, é educado e próximo. 0 = seco ou ríspido.',
  },
];
