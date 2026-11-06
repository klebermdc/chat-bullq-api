/**
 * O pedido ao juiz da conferência de fato e a leitura da resposta. Puro:
 * quem chama o LLM é o FactCheckService. O juiz devolve JSON estrito com uma
 * nota de 0 a 1 por pergunta; qualquer coisa fora disso vira `null`
 * (e o serviço grava "não conferido").
 */
import { stripThinkBlocks } from '../runner/text-guards';
import { perguntasDaAfirmacao } from './factual-claim';

const PREFIXOS = ['claim', 'supported', 'contradicts'] as const;

export interface PedidoAoJuiz {
  system: string;
  user: string;
}

export function montarPedidoAoJuiz(frases: readonly string[], evidencia: string): PedidoAoJuiz {
  const perguntas = Object.entries(perguntasDaAfirmacao(frases))
    .map(([id, pergunta]) => `${id}: ${pergunta}`)
    .join('\n');
  const system = [
    'Você confere fatos. Recebe EVIDÊNCIAS (o material oficial da empresa e o retorno das consultas feitas)',
    'e perguntas sobre frases que a atendente escreveu ao cliente.',
    'Para cada pergunta, dê uma probabilidade de 0 a 1 (0 = com certeza não, 1 = com certeza sim).',
    'Use só as EVIDÊNCIAS; não use conhecimento próprio para dizer se algo está nelas.',
    'Responda SOMENTE um objeto JSON, sem texto antes ou depois, com uma chave por pergunta.',
    'Exemplo de formato: {"claim_0":0.9,"supported_0":0.1,"contradicts_0":0.0}',
  ].join('\n');
  const user = `═══ EVIDÊNCIAS ═══\n${evidencia}\n\n═══ PERGUNTAS ═══\n${perguntas}`;
  return { system, user };
}

function extrairObjeto(bruto: string): unknown {
  const limpo = stripThinkBlocks(bruto).replace(/```json/gi, '').replace(/```/g, '').trim();
  const candidatos = [limpo, limpo.match(/\{[\s\S]*\}/)?.[0]].filter(
    (c): c is string => typeof c === 'string' && c !== '',
  );
  for (const candidato of candidatos) {
    try {
      return JSON.parse(candidato);
    } catch {
      // tenta o próximo candidato
    }
  }
  return null;
}

function ehNota(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0 && valor <= 1;
}

/** As notas das `quantidadeDeFrases` × 3 perguntas, ou `null` se faltar/sobrar formato. */
export function lerNotasDoJuiz(
  bruto: string,
  quantidadeDeFrases: number,
): Record<string, number> | null {
  const objeto = extrairObjeto(bruto ?? '');
  if (!objeto || typeof objeto !== 'object' || Array.isArray(objeto)) return null;
  const lido = objeto as Record<string, unknown>;
  const chaves = Array.from({ length: quantidadeDeFrases }, (_v, i) =>
    PREFIXOS.map((p) => `${p}_${i}`),
  ).flat();
  if (!chaves.every((chave) => ehNota(lido[chave]))) return null;
  return Object.fromEntries(chaves.map((chave) => [chave, lido[chave] as number]));
}
