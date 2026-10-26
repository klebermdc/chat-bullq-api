# Histórico da Umbler no Sendtur

Conversas da Umbler de 2025–2026 (cerca de 57,9 mil conversas e 2,42 milhões de mensagens, sem os grupos), somente leitura. Ficam nas tabelas `umbler_historico_conversas` e `umbler_historico_mensagens` (migration `20261026120000_umbler_historico`), separadas de `conversations` e `messages`. Por isso não entram em painel, métricas, abas, janela de 24h nem no contexto da IA.

## Como o histórico chega ao cliente certo

- A ligação é pelo **telefone**, não por um contato. O chat calcula todas as formas do telefone do contato aberto (`phoneVariants`: com e sem 55, com e sem o 9º dígito) e busca `telefone = ANY(...)` na organização.
- O histórico aparece em qualquer contato com aquele número: o da carteira importada, um lead novo do anúncio, ou a mesma pessoa em dois canais.
- **Permissão:** herda a checagem da conversa aberta (org, canal e atribuição), porque o histórico não tem canal próprio.

## Carga (na VPS)

1. No backup (`~/dev/backups/umbler-historico-20261023`), gerar `carga/conversas.csv` e `carga/mensagens.csv`:
   ```
   python3 -I preparar_csv.py .
   ```
2. Copiar a pasta `carga/` para a VPS, por exemplo em `/tmp/carga`.
3. Rodar a prévia, que mostra o casamento por telefone e não grava:
   ```
   bash /opt/chat-ofp/chat-bullq-api/scripts/historico-umbler/carregar.sh <org_id> /tmp/carga
   ```
   O `org_id` vem de `SELECT id, name FROM organizations;`.
4. Gravar com `--aplicar`. É idempotente, então dá para rodar de novo com um arquivo mais novo para completar as mensagens que chegaram depois.

## Ensaio local

`ensaio-servico.ts` roda o `UmblerHistoryService` contra um Postgres local carregado pelo `carregar.sql`. É só para teste e não roda em produção.

## Anexos

`arquivo_url` aponta para o S3 da Umbler, que abre sem login. Os links podem sumir quando a conta for cancelada. Copiar os arquivos para o MinIO é um passo separado.
