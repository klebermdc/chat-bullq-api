import type { DiaryCriterion } from './diary.types';

/**
 * Critérios iniciais do diário. Viram skills editáveis em Agentes de IA >
 * Skills: depois de criadas, vale o que estiver lá, não este arquivo.
 */
export const DEFAULT_DIARY_CRITERIA: DiaryCriterion[] = [
  {
    name: 'diarioAcolhimento',
    description: 'Acolhimento e tom',
    instructions:
      'Cumprimenta, usa o nome do cliente quando o conhece e mantém tom próximo e educado. Erro: resposta seca, ríspida ou que ignora o que o cliente disse.',
  },
  {
    name: 'diarioDiagnostico',
    description: 'Entender a viagem',
    instructions:
      'Antes de passar preço, entende datas, número de pessoas, idades e o que o cliente quer fazer. Erro: mandar valor sem saber o que o cliente precisa.',
  },
  {
    name: 'diarioClareza',
    description: 'Clareza da informação',
    instructions:
      'Explica o que está incluído, valores e condições de forma simples. Erro: resposta vaga, confusa ou que deixa a dúvida do cliente sem responder.',
  },
  {
    name: 'diarioProximoPasso',
    description: 'Conduzir ao próximo passo',
    instructions:
      'Termina com um próximo passo claro: proposta, pagamento, confirmação ou data de retorno. Erro: deixar a conversa morrer sem combinar o que acontece depois.',
  },
  {
    name: 'diarioObjecoes',
    description: 'Tratar objeções',
    instructions:
      'Quando o cliente acha caro ou hesita, entende o motivo e mostra valor antes de oferecer desconto. Erro: desistir na primeira objeção ou dar desconto sem o cliente pedir.',
  },
  {
    name: 'diarioRegrasProduto',
    description: 'Regras de produto',
    instructions:
      'Escreva aqui as regras de produto que a IA pode cobrar. Enquanto este texto não listar nenhuma regra, não aponte erro de informação de produto.',
  },
];
