# Templates do pulso do atendimento (WhatsApp da gestão)

Usados pelo módulo `src/modules/team-pulse` (config em `organizations.settings.teamPulse`).
Cadastrar na WABA do canal configurado em `teamPulse.channelId` (o mesmo "Comercial" dos avisos de SLA).

- Categoria: **UTILITY**
- Idioma: **pt_BR** (`Portuguese (BR)`)
- Só corpo (sem cabeçalho, rodapé nem botões)
- O corpo termina com frase fixa (a Meta recusa corpo que termina em variável).
- Cada variável é uma linha só: o código tira quebra de linha, tab e 4+ espaços e corta em ~200 caracteres com "…".
- A ordem das variáveis é a de `team-pulse.params.ts`. Mudou o template, muda lá também.

## 1. `pulso_atendimento` (de hora em hora, até antes do fechamento)

Sai no minuto 0 de cada hora, só se pelo menos um atendente está dentro do próprio horário (`working_hours`).

```
*Atendimento às {{1}}*
👥 Equipe no horário: {{2}}
Online: {{3}}
Atenção: {{4}}
⏳ Esperando resposta: {{5}}
Mais antiga esperando: {{6}}
⚠️ SLA estourado na última hora: {{7}}
📥 Leads novos na última hora: {{8}}
Detalhes no painel do Sendtur.
```

| Variável | Conteúdo | Exemplo para a Meta |
|---|---|---|
| `{{1}}` | hora e dia | `15h · qui 19/11` |
| `{{2}}` | contagem de quem está no horário | `3 online · 1 ausente · 1 offline` |
| `{{3}}` | online, com a entrada de hoje | `Pedro (desde 09:02) · Marcella (desde 14:05)` |
| `{{4}}` | ausentes e offline no horário | `Gabriela ausente há 22 min · Rafael offline` |
| `{{5}}` | esperando resposta, por dono | `12 (Pedro 5 · Marcella 4 · sem dono 3)` |
| `{{6}}` | espera aberta mais antiga | `48 min (Pedro)` |
| `{{7}}` | estouros de SLA na última hora | `2 (Pedro 1 · sem dono 1)` |
| `{{8}}` | conversas novas na última hora | `7 (4 com a Aline · 3 na fila)` |

## 2. `fechamento_atendimento` (na `closingHour`, padrão 22h)

Sai sempre na hora do fechamento (com ou sem gente no horário).

```
*Fechamento do atendimento* · {{1}}
Ponto do dia: {{2}}
⏳ Ainda esperando resposta: {{3}}
⚠️ SLA estourado no dia: {{4}}
📥 Leads novos no dia: {{5}}
Detalhes no painel do Sendtur.
```

| Variável | Conteúdo | Exemplo para a Meta |
|---|---|---|
| `{{1}}` | dia | `qui 19/11` |
| `{{2}}` | entrada–saída (último uso) e tempo ativo de quem entrou | `Pedro 09:02–18:11 (ativo 7h05) · Marcella 14:05–21:58 (ativo 6h40)` |
| `{{3}}` | esperando resposta agora, por dono | `3 (Marcella 2 · sem dono 1)` |
| `{{4}}` | estouros de SLA no dia | `5 (Pedro 3 · Marcella 2)` |
| `{{5}}` | conversas novas no dia | `42` |

## Textos vazios

`{{3}}` online vazio = `ninguém`; atenção vazia = `nenhum`; esperas = `nenhuma`; SLA e leads = `nenhum`;
ponto do dia vazio = `ninguém entrou hoje`; equipe vazia (só no teste manual) = `ninguém no horário`.
