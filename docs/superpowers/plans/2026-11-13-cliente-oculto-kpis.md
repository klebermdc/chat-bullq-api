# Cliente oculto — aba Indicadores (KPIs do mês)

**Goal:** KPIs só com o que o cliente oculto viu (nada da operação real): visão geral do mês e por vendedor. A aba "Indicadores" substitui "Ranking" no web (a rota `/ranking` da API fica, sem uso).

**Branch:** `feat/cliente-oculto-kpis` de `origin/feat/conversation-tabs` (API e web).

## Contrato

`GET /mystery-shopper/kpis?month=YYYY-MM` — `assertViewer` (404 para os demais). `month` opcional (padrão: mês atual no fuso da org; `America/Sao_Paulo` se não houver); formato inválido → 400.

Base: visitas `DONE` com `evaluatedAt` no mês (fuso da org). Mês anterior só para tendência.

```ts
interface MysteryShopperKpis {
  month: string;                       // '2026-11'
  criteria: Array<{ criterion: string; label: string }>; // ordem das colunas (rótulo mais recente)
  overall: {
    visits: number;                    // DONE no mês
    openVisits: number;                // OPEN/EVALUATING criadas no mês
    averageScore: number | null;       // inteiro 0–100
    previousAverageScore: number | null;
    approvedPct: number | null;        // % com totalScore >= 70 (APPROVED_SCORE)
    medianFirstReplyMinutes: number | null;
    within15MinPct: number | null;     // firstHumanReplyMinutes <= FIRST_REPLY_GOOD_MINUTES, sobre as que têm resposta... ver regra
    funnel: Array<{ key: FunnelKey; label: string; reached: number; total: number; pct: number | null }>;
    criteriaAverages: Array<{ criterion: string; label: string; average: number | null; rated: number }>;
    weakestCriterion: { criterion: string; label: string; average: number } | null;
    criticalVisits: Array<{ visitId: string; sellerName: string; reason: 'NO_REPLY' | 'WRONG_INFO'; evaluatedAt: string }>;
  };
  sellers: Array<{
    sellerUserId: string;
    sellerName: string;
    visits: number;
    averageScore: number;
    previousAverageScore: number | null;
    trend: 'UP' | 'DOWN' | 'SAME' | null;   // |diferença| < 3 pontos = SAME; sem mês anterior = null
    isSmallSample: boolean;                 // visits <= SMALL_SAMPLE_VISITS
    byCriterion: Record<string, number | null>; // chave do critério → média 0–2, 1 casa
    medianFirstReplyMinutes: number | null;
    proposalPct: number;
    followUpPct: number;
    topImprovements: string[];              // até 2 "a melhorar" mais repetidos (normaliza trim/minúsculas; empate → mais recente)
  }>;                                       // ordem: averageScore desc
}
type FunnelKey = 'responded' | 'discovery' | 'proposal' | 'objection' | 'closing' | 'followUp';
```

Regras:
- `within15MinPct`: denominador = todas as visitas do mês (sem resposta conta como fora).
- Funil (denominador = visitas do mês, exceto objeção = visitas com nota não nula em `ocultoObjecao`):
  responded = `firstHumanReplyMinutes != null`; discovery = `ocultoDescoberta >= 1`;
  proposal = `metrics.proposalSent || ocultoCotacao >= 1`; objection = `ocultoObjecao >= 1`;
  closing = `ocultoFechamento >= 1`; followUp = `metrics.followUps > 0`.
- `weakestCriterion`: menor média entre critérios com `rated >= 1`.
- `criticalVisits`: `NO_REPLY` = sem resposta humana; `WRONG_INFO` = `ocultoInformacao` = 0. Mais recentes primeiro.
- Percentuais inteiros; `null` quando o denominador é 0.
- Vendedor sem `sellerUserId` fica fora de `sellers` (mas conta no geral).

## Web
Aba "Indicadores" no lugar de "Ranking": seletor de mês (‹ mês ›, não passa do atual), cartões, funil em barras, ponto fraco, erros graves (abrem a visita), tabela por vendedor com mapa de cor 0–2 e ficha ao clicar. Só o viewer vê (mesma gate da página).
