// Adaptado de DeskcommCRM (https://github.com/melgarafael/DeskcommCRM), MIT License, Copyright (c) 2026 Rafael Melgaço.
/**
 * Detector de PROMESSA DE HUMANO: a resposta da IA promete envolver uma
 * pessoa (encaminhar/acionar/consultar o consultor, a equipe, o setor) ou
 * afirma que "o consultor vai retornar". Se a IA promete e ninguém foi
 * acionado no run, o cliente fica esperando um retorno que não vem.
 *
 * Sem LLM: regex conservadora sobre texto normalizado (minúsculo, sem acento).
 *  - "verificar seu pedido NO SISTEMA" não é acionar humano: o verbo de
 *    consulta exige o alvo humano ("com o consultor").
 *  - "nossa equipe está sempre à disposição" é institucional: o alvo sozinho
 *    não basta, precisa de verbo de encaminhamento ou de "<alvo> vai <agir>".
 */

/** Alvo humano (já sem acento). Inclui o vocabulário da Sendtur: consultor e vendedor. */
const TARGET_WORDS = [
  'equipe',
  'time',
  'setor',
  'responsavel',
  'responsaveis',
  'pessoal',
  'especialista',
  'especialistas',
  'atendente',
  'atendentes',
  'gerente',
  'supervisor',
  'departamento',
  'consultor',
  'consultora',
  'consultores',
  'consultoras',
  'vendedor',
  'vendedora',
  'vendedores',
  'vendedoras',
] as const;
const TARGET_WORD_SET = new Set<string>(TARGET_WORDS);
const TARGET = `(?:${TARGET_WORDS.join('|')})`;

/** Lacuna curta que não cruza fim de frase: o verbo e o alvo ficam na mesma oração. */
const gap = (n: number): string => `[^.!?\\n]{0,${n}}?`;

/** Os padrões de promessa, montados sobre um alvo substituível (cargos ou cargos + nomes). */
function buildPatterns(target: string): RegExp[] {
  return [
    // (1a) encaminhar/passar/acionar → alvo: "vou passar pro consultor".
    new RegExp(`\\b(?:encaminh|repass|transfer|acion|escal|direcion|pass|cham)\\w*${gap(20)}\\b${target}\\b`),
    // (1a-bis) alvo retomado por pronome, com verbo de resolução: "passo pra eles resolverem".
    new RegExp(
      `\\b(?:encaminh|repass|transfer|acion|escal|direcion|pass|cham)\\w*${gap(30)}` +
        `\\b(?:pra|para|pro|com)\\b${gap(8)}\\b(?:eles|elas)\\b${gap(25)}` +
        `\\b(?:resolv|retorn|respond|liber|analis|verific|cuid|assum|atend|aprov|confirm|contat|ajud)\\w*`,
    ),
    // (1b) consulta + "com" + alvo: "vou verificar com o vendedor".
    new RegExp(`\\b(?:verific|fal|confer|confirm|consult|alinh|valid|chec)\\w*${gap(15)}\\bcom\\b${gap(15)}\\b${target}\\b`),
    // (1c) pedir/solicitar ao alvo: "vou pedir pra equipe liberar".
    new RegExp(`\\b(?:ped|solicit)\\w*${gap(12)}\\b(?:pra|para|pro|ao|aos|a|as|com)\\b${gap(10)}\\b${target}\\b`),
    // (2) "<alvo> vai/pode <agir>": "o consultor vai te retornar". "está à disposição" não casa.
    new RegExp(
      `\\b${target}\\b${gap(20)}\\b(?:vai|vao|ira|irao|pode|podem|poderao)\\b${gap(10)}` +
        `(?:\\b(?:te|lhe|se|nos)\\b\\s*)?(?:resolv|retorn|respond|liber|analis|verific|cuid|assum|atend|entr|aprov|confirm|contat|ajud|cham|lig)\\w*`,
    ),
    // (2b) "quem resolve ... é o nosso consultor".
    new RegExp(
      `\\bquem\\b${gap(15)}\\b(?:resolv|cuid|respond|decid|aprov|liber|atend)\\w*${gap(20)}` +
        `(?:\\b(?:nosso|nossa|nossos|nossas|o|a|os|as)\\b\\s*)?${target}\\b`,
    ),
    // (2c) estado passivo alegado: "está em análise pela equipe".
    new RegExp(
      `\\b(?:est[aá]|ficou|fica|segue)\\b${gap(10)}\\bem\\b\\s+an[aá]lise\\b${gap(20)}` +
        `\\b(?:com|pela|pelo|do|da|na|no)\\b${gap(10)}\\b${target}\\b`,
    ),
    // (2d) repasse alegado sem objeto, frase inteira: "Já encaminhei!", "Pronto, encaminhado!".
    new RegExp(
      `(?:^|[.!?\\n]\\s*)(?:(?:pronto|ok|certo|feito|perfeito)\\s*[,!]?\\s*)?(?:(?:eu\\s+)?(?:ja\\s+)?` +
        `(?:encaminhei|repassei|transferi|acionei|escalei)|(?:ja\\s+)?(?:encaminhad|repassad|transferid|acionad|escalad)[oa])` +
        `(?:\\s+(?:aqui|agora|internamente))?\\s*(?:[.!]|$)`,
    ),
    // (3) deferir a terceiros no subjuntivo: "assim que liberarem eu te aviso".
    new RegExp(
      `\\b(?:assim que|assim q|quando|depois que|logo que|apos)\\b${gap(12)}` +
        `\\b(?:liber|aprov|autoriz|respond|retorn|verific|analis|resolv|confirm)(?:ar|er)em\\b`,
    ),
  ];
}

const PATTERNS: readonly RegExp[] = buildPatterns(TARGET);

/** Minúsculas e sem diacríticos. */
function normalize(body: string): string {
  return body.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function escapeRegex(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reconhecimentos sem conteúdo que podem abrir uma pergunta de consentimento
 * ("Entendi! Quer que eu chame o consultor?"). Lista fechada de propósito:
 * qualquer outra abertura devolve a análise à mensagem inteira.
 */
const RECONHECIMENTOS_SEM_CONTEUDO = new Set([
  'entendi',
  'entendido',
  'certo',
  'claro',
  'ok',
  'combinado',
  'anotado',
  'perfeito',
  'beleza',
  'tudo bem',
  'tudo certo',
  'sem problema',
  'sem problemas',
]);

function ehReconhecimentoSemConteudo(frase: string): boolean {
  return frase
    .split(',')
    .map((p) => p.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim())
    .every((p) => RECONHECIMENTOS_SEM_CONTEUDO.has(p));
}

function ehPerguntaDeConsentimento(frase: string): boolean {
  return (
    frase.endsWith('?') &&
    /^(?:(?:voce|vc)\s+)?(?:quer|gostaria|prefere|deseja|autoriza|posso|podemos)\b/.test(frase) &&
    /\b(?:encaminh|transfer|pass|fal|consult|verific|cham)\w*/.test(frase) &&
    !/\b(?:ja|vou|vamos|vai|vao|ira|irao|transferi|encaminhei|registrei|acabei)\b/.test(frase) &&
    !/\b(?:hoje|amanha|agora|logo|ate|minutos?|horas?|semana|dias?|\d+\s*h|\d{1,2}:\d{2})\b/.test(frase) &&
    !/\b(?:te|lhe)\s+(?:lig|retorn|respond|contat|procur|cham|d[ae])\w*|\bretorn\w*|\bentr\w*\s+em\s+contato/.test(frase)
  );
}

/**
 * Pergunta de consentimento ("quer que eu chame o consultor?") ainda não é
 * operação executada. A isenção vale para a mensagem INTEIRA: uma frase com
 * operação alegada, prazo ou retorno anunciado devolve a análise ao texto todo.
 */
function soPedeConsentimento(text: string): boolean {
  const todas = text
    .split(/(?<=[.!?\n])/)
    .map((f) => f.trim())
    .filter(Boolean);
  const frases =
    todas.length > 1 && ehReconhecimentoSemConteudo(todas[0] ?? '') ? todas.slice(1) : todas;
  return frases.length > 0 && frases.every(ehPerguntaDeConsentimento);
}

/**
 * True se a resposta promete envolver uma pessoa. Vazio = false.
 * `extraHumanNames`: nomes próprios simples que também contam como alvo
 * ("vou confirmar com o Pedro"); frases compostas e cargos já cobertos são ignorados.
 */
export function detectHumanPromise(body: string, extraHumanNames?: readonly string[]): boolean {
  if (body.trim() === '') return false;
  const text = normalize(body);
  if (soPedeConsentimento(text)) return false;
  const names = Array.from(
    new Set(
      (extraHumanNames ?? [])
        .map((w) => normalize(w).trim())
        .filter((w) => /^[a-z]{3,}$/.test(w) && !TARGET_WORD_SET.has(w)),
    ),
  );
  if (names.length === 0) return PATTERNS.some((re) => re.test(text));
  const extendedTarget = `(?:${TARGET_WORDS.join('|')}|${names.map(escapeRegex).join('|')})`;
  return buildPatterns(extendedTarget).some((re) => re.test(text));
}
