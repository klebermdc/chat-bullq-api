# Carteira Umbler: atualização final (virada do sistema)

Na virada, exporte da Umbler a lista final de contatos e rode a atualização.
Ela deixa o Chat igual ao arquivo novo: quem é novo vira contato, e quem trocou de vendedor passa a cair no vendedor novo.

## O arquivo
- CSV com este cabeçalho, nesta ordem:
  `telefone,nome,email,vendedor,vendedores_extras,etapa,tags`
- Os nomes na coluna `vendedor` são os mesmos da primeira carga: Renata, Carol, Suelen, Pedro, Marcella, Rafa, Kleber, Barbara, Gabi, Dani.
- Várias etiquetas numa célula vão separadas por `|` (ex.: `CRM | Guia`).
- Pode vir direto do Excel: o script trata o BOM e as quebras de linha do Windows.
- O telefone pode vir em qualquer formato: `+5511...`, `5511...` ou `(11) 9...`. Sem o 55, o número é tratado como brasileiro.

## Passo a passo
1. **No Mac**, envie o arquivo:
   ```bash
   scp "/caminho/do/arquivo.csv" root@187.77.213.165:/tmp/contatos-final.csv
   ```
2. **Na VPS**, rode a **prévia**. Ela não grava nada:
   ```bash
   bash /opt/chat-ofp/chat-bullq-api/scripts/carteira-umbler/atualizar-carteira.sh /tmp/contatos-final.csv
   ```
   Confira:
   - `novos_na_carteira` e `trocaram_de_vendedor` fazem sentido;
   - na lista por vendedor, `mapeado = f` aparece só para quem saiu das vendas (Gabi). Um nome novo com `f` precisa ser mapeado antes (veja abaixo);
   - no resultado, `com_etiqueta_do_vendedor` é igual a `contatos` em todo vendedor mapeado.
3. **Grave:**
   ```bash
   bash /opt/chat-ofp/chat-bullq-api/scripts/carteira-umbler/atualizar-carteira.sh /tmp/contatos-final.csv --aplicar
   ```
4. Apague o arquivo: `rm /tmp/contatos-final.csv`.

Pode rodar mais de uma vez: a segunda execução não duplica nada.

## O que muda e o que não muda
| Situação no arquivo novo | O que acontece |
|---|---|
| Cliente novo | Entra na carteira e vira contato no Chat, com as etiquetas da planilha e a do vendedor |
| Cliente mudou de vendedor | Passa a cair no vendedor novo; a etiqueta do vendedor antigo sai do contato e entra a do novo |
| Cliente com etiquetas novas | Ganha as etiquetas novas (as antigas continuam) |
| Cliente sumiu do arquivo | **Nada**: continua na carteira e no Chat, com o mesmo vendedor |
| Vendedor sem usuário no Chat (Gabi) | Cliente vira contato **sem etiqueta** e vai para a distribuição normal |

Nada manda mensagem nem dispara automação. Tudo roda numa transação: se der erro, nada é gravado.

**Atenção:** se no Chat você mudou o dono de um cliente direto no banco (em `contatos_legado`), o arquivo novo sobrescreve essa mudança com o vendedor que estiver na Umbler.

## Vendedor novo
Se a prévia mostrar um vendedor com `mapeado = f` que deve receber clientes:
```sql
-- descubra o id do usuário
select id, name, email from users where name ilike '%nome%';
-- mapeie (o texto da esquerda é o nome exatamente como vem na planilha)
insert into contatos_legado_vendedores (vendedor, user_id) values ('NomeNaPlanilha', '<id>');
```
Depois rode a prévia de novo.
