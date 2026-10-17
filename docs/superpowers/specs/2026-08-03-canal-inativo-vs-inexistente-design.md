# Canal desativado deixa de ser indistinguível de canal inexistente

**Data:** 2026-08-03
**Status:** Aprovado, implementado
**Branch:** `feat/channel-hub-fail-loud`

## Problema

O `error-reporter` já reporta os 4 descartes de webhook do channel-hub
(`WEBHOOK_UNSUPPORTED_TYPE`, `WEBHOOK_NO_LOCATORS`, `WEBHOOK_UNROUTED`,
`WEBHOOK_INVALID_SIGNATURE`) — com dedupe por fingerprint, Telegram e painel
`/bugs`. O sintoma já é visível.

O que continua invisível é **a causa**. O `resolveByLocator` filtrava por
`isActive`:

```ts
const candidates = await this.repository.findActiveByType(type);
return candidates.find((c) => matches(c)) ?? null;
```

Um canal **desativado** não entrava em `candidates`, então virava `null` —
exatamente o mesmo resultado de um canal que nunca existiu. O alerta que sai é
`WEBHOOK_UNROUTED: "sem canal correspondente"`, e quem está de plantão não sabe
se o conserto é **reativar um canal** (1 clique) ou **investigar configuração**
(1 hora). Foi assim que o apagão do Comercial levou horas.

## O que muda

`resolveByLocator` passa a devolver `{ channel, active } | null`, e o gateway
reporta um código novo `WEBHOOK_CHANNEL_INACTIVE` nomeando o canal e dizendo o
que fazer.

**O roteamento não muda:** canal inativo continua NÃO processando a mensagem.

## Decisões

- **Não duplicar o error-reporter.** A primeira versão desta branch trazia um
  `InboundDropReporter` próprio, com auditoria em `webhook_events` e throttle
  no Redis. Quando o error-reporter entrou (fatia do Painel de Bugs), isso
  virou um segundo sistema de relato disparando nos mesmos caminhos — dois
  alertas por descarte, duas tabelas. Descartado em favor do que já existe.
- **`WEBHOOK_CHANNEL_INACTIVE` é um código separado**, não uma variação de
  mensagem do `UNROUTED`, porque o dedupe do error-reporter é por fingerprint:
  código distinto = issue distinta no painel, com o conserto certo.
- **`UNROUTED` não dispara quando o motivo foi canal desativado.** Os dois
  juntos mandariam o plantão investigar a configuração de um canal que está
  correto.
- **Canal ativo nunca é ofuscado por um inativo.** Ao remover o filtro
  `isActive`, um canal desativado que compartilhe locator com um ativo passou a
  poder vencer o `find()` — descartando o inbound do canal que FUNCIONA. Isso
  aparece no fluxo normal de desativar-o-antigo-e-recriar quando um token Meta
  expira. Contido em dois lugares: preferência explícita por ativo na seleção,
  e `orderBy [{isActive:desc},{updatedAt:desc}]` no repositório.

## Alcance

`resolveByLocator` tem um único consumidor (o `webhook-gateway.controller`), e
a mudança de tipo de retorno é pega pelo `tsc`.

## Testes

- `channels.repository.spec.ts` — fixa a forma da query: re-adicionar
  `isActive` ali falha alto. Sem isso, um teste de serviço com repositório
  mockado passaria mesmo com a mudança revertida.
- `channels.service.resolve.spec.ts` — ativo/inativo/nenhum, e o caso do
  ofuscamento com o inativo colocado **primeiro** no array.
- `webhook-gateway.controller.spec.ts` — o alerta nomeia o canal e diz
  "reative"; `UNROUTED` não sai junto; lote com N locators do mesmo canal
  alerta uma vez; caminho feliz não regride.

Mutação verificada: remover a preferência por ativo derruba o teste de
ofuscamento; remover a guarda do `UNROUTED` derruba dois testes.

## Fora de escopo

Retenção/TTL de `webhook_events` (não existe em lugar nenhum, e já era assim
antes). Redação do `rawPayload` — só os headers são redigidos hoje, e no
Zappfy o token chega também no corpo (`event.token`).
