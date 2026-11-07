# Caixas da Umbler no Sendtur

Copia para o Sendtur as conversas que estão abertas na Umbler, com o mesmo vendedor, as mesmas etiquetas e a mesma aba (Caixa de entrada ou Esperando). O objetivo é que, na virada, o atendente encontre no Sendtur a mesma caixa que tinha na Umbler.

## O que entra

- **Toda** conversa do Esperando da Umbler.
- Conversa aberta com movimento nos **últimos 30 dias** (`--dias N` muda o corte).
- Só contatos individuais e só o número oficial **5198-4190**, que no Sendtur é o canal `cmw5rpzzi19pnle069kte31uw`.
- **Ficam de fora:** o 5194-4192 ("Comercial recupear", por QR), que não existe no Sendtur, e os grupos.

## Regras

- **Dono:** o atendente da conversa na Umbler, casado pelo **primeiro nome** com o usuário do Sendtur. Sem atendente, vale o setor, que na OFP é o nome do vendedor. Setor sem vendedor ("Oficial", "OFP") entra sem dono (PENDING).
  - O e-mail não serve para casar: na Umbler, a Suelen usa comercial@ e o Rafael usa marketing@, que no Sendtur é a Danielle.
- **Aba:** quem está no Esperando da Umbler entra com `awaiting_human_reply = true`.
- **Etiquetas:**
  - A conversa recebe as etiquetas dela na Umbler e a do vendedor.
  - O contato recebe as etiquetas que tinha na Umbler, menos as de vendedor, porque essas a carteira já cuida.
  - Os nomes são casados sem acento e sem caixa ("BARBARA" = "Bárbara"). Etiqueta que não existe é criada.
  - Os apelidos antigos "Carol" e "Rafa" são lidos como Carolina e Rafael.
- **Cliente que já tem conversa aberta no Sendtur:** não mexe no dono nem na aba, porque essa conversa já teve atendimento depois da virada. Só acrescenta as etiquetas da Umbler que não são de vendedor.
- **Janela do WhatsApp:**
  - `last_inbound_at` = última atividade do cliente na Umbler.
  - `meta_window_expires_at` = a janela de anúncio que a Umbler informa.
  - Assim o Sendtur sabe se dá para mandar texto livre ou se precisa de template.
- **Pode rodar de novo:** a conversa importada guarda `metadata.umbler_chat_id`, e a mesma conversa da Umbler nunca é criada duas vezes.
- **Não envia nada:** não manda mensagem e não dispara automação, porque nenhum evento vai para o outbox.
- **A conversa importada não tem mensagens no Sendtur.** Na lista ela aparece como "Sem mensagens", na posição da última mensagem da Umbler. O histórico da Umbler aparece ao abrir.

## Como rodar

1. **No Mac**, gerar o CSV. Só lê a API da Umbler:
   ```
   python3 -I gerar_csv.py ~/.umbler_token /tmp/caixas.csv
   ```
2. **Copiar para a VPS:**
   ```
   scp -i ~/.ssh/hostinger_vps /tmp/caixas.csv root@187.77.213.165:/tmp/
   ```
3. **Na VPS, rodar a prévia.** Mostra quanto vai para cada vendedor e cada aba, e não grava nada:
   ```
   bash /opt/chat-ofp/chat-bullq-api/scripts/caixas-umbler/carregar.sh /tmp/caixas.csv
   ```
4. **Gravar:** o mesmo comando com `--aplicar`.
5. **Na manhã da virada**, repetir os passos 1 a 4. O que entrou na Umbler nesse meio-tempo é acrescentado; o que já foi importado é pulado.

## Desfazer

```
bash carregar.sh --desfazer            # prévia
bash carregar.sh --desfazer --aplicar  # apaga
```

- Apaga só as conversas importadas que **ainda não têm nenhuma mensagem no Sendtur**, e os contatos criados por esta importação que ficaram sem conversa.
- Conversa em que alguém já respondeu fica.
- Etiqueta criada fica.

## Ensaio

Rodou num Postgres local com o schema atual e as 2.061 conversas reais do Sendtur de 07/11, usando o CSV daquele dia (1.565 linhas). Resultado:
- 1.513 conversas criadas e 52 já abertas no Sendtur.
- A segunda rodada criou 0.
- O desfazer voltou exatamente às 2.061 conversas.
