# Runbook — reconciliar o checksum de `20260715120000_cadence_revive`

**Rodar UMA vez, em cada ambiente onde essa migração já consta aplicada, ANTES
do primeiro `migrate deploy` que carregue este commit.** Hoje isso é só a prod
(`/opt/chat-ofp`).

## Por que é preciso

A migração `20260715120000_cadence_revive` fazia
`ALTER TYPE "CadenceEnrollmentStatus" ADD VALUE 'PAUSED'` e usava `'PAUSED'` no
predicado do índice único **no mesmo arquivo**. O Prisma roda cada migração numa
transação, e o Postgres proíbe usar um label de enum na mesma transação em que
ele foi criado → **P3009**, o `migrate deploy` do boot falha, o Prisma recusa
subir e a API fica em crash-loop (foi o tombo de 2026-07-20: Caddy de pé,
backend morto, "Network Error" no site).

O fix troca o predicado para `status::text IN (...)`. Os literais viram texto e
nunca resolvem contra o enum, então a restrição não se aplica. A unicidade é
idêntica.

Só que o arquivo **muda**, e o Prisma guarda o sha256 de cada migração aplicada
em `_prisma_migrations.checksum`. Na prod a migração já está marcada como
aplicada com o hash antigo. Alinhar o registro ao arquivo novo evita qualquer
chance de o Prisma reclamar de "migration modified after it was applied".

> Nada é re-executado na prod: o efeito da migração (enum, colunas, índice) já
> está no banco. Isto aqui só atualiza o hash registrado.

## Os hashes

| | |
|---|---|
| antigo (o que está gravado na prod) | `2e200b667fb792dcd1bf2d2bdfd1304c5393e14a2f944f4294a9d89362c9e589` |
| novo (este commit) | `b89518ae740eba5a24568f1e3f5f0926bd856cbd5a6f0642da335debc5efa0a2` |

Confira o novo antes de rodar, direto do arquivo desta branch:

```bash
shasum -a 256 prisma/migrations/20260715120000_cadence_revive/migration.sql
```

## Passos

```bash
ssh -i ~/.ssh/hostinger_vps root@187.77.213.165
cd /opt/chat-ofp

# 1. Confirmar o estado atual (espera-se 1 linha, com o checksum antigo)
docker compose exec -T postgres psql -U postgres -d chatbullq -c \
  "SELECT migration_name, checksum, finished_at
     FROM _prisma_migrations
    WHERE migration_name = '20260715120000_cadence_revive';"

# 2. Alinhar o checksum ao arquivo novo
docker compose exec -T postgres psql -U postgres -d chatbullq -c \
  "UPDATE _prisma_migrations
      SET checksum = 'b89518ae740eba5a24568f1e3f5f0926bd856cbd5a6f0642da335debc5efa0a2'
    WHERE migration_name = '20260715120000_cadence_revive';"

# 3. Só então buildar/subir a API normalmente
docker compose up -d --build api

# 4. Conferir que subiu de verdade — pelo DOMÍNIO, não pelo IP
#    (o Caddy já travou upstream no IP antigo e mascarou deploy que não subiu)
curl -sS -o /dev/null -w '%{http_code}\n' https://api-ofpchat.explotek.pro/api/v1/health
docker compose logs --tail=50 api
```

## Se der errado

O passo 2 é um UPDATE de uma linha numa tabela de metadados — não toca dado de
negócio. Pra desfazer, é só regravar o hash antigo da tabela acima.

Se a API não subir, o sintoma do P3009 é explícito no log: `migrate found failed
migration`. O procedimento de recuperação (aplicar os efeitos na mão em
autocommit + `prisma migrate resolve --applied`) está no histórico do incidente
de 20/07.
