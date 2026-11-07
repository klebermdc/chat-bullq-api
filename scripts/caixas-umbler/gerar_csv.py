"""Gera o CSV das caixas abertas da Umbler para o carregar.sql.

Uso: python3 -I gerar_csv.py <arquivo_token_umbler> <saida.csv> [--dias 30]

Só lê a API da Umbler. Entram:
  - toda conversa no "Esperando" da Umbler;
  - conversa aberta com movimento nos últimos N dias (padrão 30).
Só contatos individuais (sem grupos) e só dos canais que existem no Sendtur
(CANAIS abaixo). O resto é contado no resumo e fica de fora.
"""
import csv
import json
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone

API = "https://app-utalk.umbler.com/api"
ORG = "ZmNgWKpQZ8VoxBx4"
PAGINA = 100
PAUSA_S = 0.3
# Número da Umbler -> canal do Sendtur. O 5194-4192 (QR, "recupear") não
# existe no Sendtur e fica de fora.
CANAIS = {"+551151984190": "cmw5rpzzi19pnle069kte31uw"}
# Etiquetas antigas de vendedor que ainda estão em alguns contatos da Umbler.
APELIDOS = {"carol": "Carolina", "rafa": "Rafael"}
CAMPOS = ["umbler_chat_id", "telefone", "nome", "canal_id", "aba", "vendedor", "setor",
          "etiquetas_conversa", "etiquetas_contato", "ultima_entrada", "janela_meta",
          "ultima_msg", "criada_em"]


def chamar(token, caminho, **q):
    q.setdefault("organizationId", ORG)
    url = f"{API}{caminho}?{urllib.parse.urlencode(q, doseq=True)}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read() or "null")


def listar_chats(token, tipo):
    itens, pulo = [], 0
    while True:
        dado = chamar(token, "/v1/chats/", Type=tipo, Skip=pulo, Take=PAGINA)
        lote = dado.get("items", []) if isinstance(dado, dict) else dado
        itens += lote
        if len(lote) < PAGINA:
            return itens
        pulo += PAGINA
        time.sleep(PAUSA_S)


def nomes_etiquetas(lista):
    nomes = {(t.get("name") or "").strip() for t in lista or []}
    return "|".join(sorted({APELIDOS.get(n.lower(), n) for n in nomes if n}))


def linha(chat, aba, membros):
    membro = membros.get((chat.get("organizationMember") or {}).get("id"))
    setor = (chat.get("sector") or {}).get("name") or ""
    contato = chat["contact"]
    ultima = chat.get("lastMessage") or {}
    entrada = contato.get("lastActiveUTC") or (chat.get("eventAtUTC") if ultima.get("source") == "Contact" else "")
    return {
        "umbler_chat_id": chat["id"],
        "telefone": contato.get("phoneNumber") or "",
        "nome": (contato.get("name") or "").strip(),
        "canal_id": CANAIS[chat["channel"]["phoneNumber"]],
        "aba": aba,
        # atendente da conversa; sem atendente, o setor (que na OFP é o vendedor)
        "vendedor": membro or setor,
        "setor": setor,
        "etiquetas_conversa": nomes_etiquetas(chat.get("tags")),
        "etiquetas_contato": nomes_etiquetas(contato.get("tags")),
        "ultima_entrada": entrada or "",
        "janela_meta": contato.get("ctwExpiresAtUTC") or "",
        "ultima_msg": chat.get("eventAtUTC") or "",
        "criada_em": chat.get("createdAtUTC") or "",
    }


def main():
    if len(sys.argv) < 3:
        sys.exit("Uso: python3 -I gerar_csv.py <arquivo_token_umbler> <saida.csv> [--dias 30]")
    token = open(sys.argv[1], encoding="utf-8").read().strip()
    saida = sys.argv[2]
    dias = int(sys.argv[sys.argv.index("--dias") + 1]) if "--dias" in sys.argv else 30
    corte = (datetime.now(timezone.utc) - timedelta(days=dias)).isoformat()

    org = chamar(token, f"/v1/organizations/{ORG}/")
    # Primeiro nome do atendente: o e-mail da Umbler não bate com o do Sendtur
    # (Suelen usa comercial@, Rafael usa marketing@, que no Sendtur é a Danielle).
    membros = {m["id"]: (m.get("displayName") or "").strip().split(" ")[0]
               for m in org.get("organizationMembers", [])}

    fora = Counter()
    por_tel = {}
    for tipo, aba in (("Waiting", "esperando"), ("Open", "entrada")):
        for chat in listar_chats(token, tipo):
            if chat["contact"].get("contactType") != "DirectMessage":
                fora["grupo"] += 1
            elif chat["channel"].get("phoneNumber") not in CANAIS:
                fora[f"canal fora do Sendtur ({chat['channel'].get('name')})"] += 1
            elif aba == "entrada" and (chat.get("eventAtUTC") or "") < corte:
                fora[f"aberta sem movimento há mais de {dias} dias"] += 1
            else:
                item = linha(chat, aba, membros)
                anterior = por_tel.get(item["telefone"])
                # mesmo telefone duas vezes: fica a do Esperando, senão a mais recente
                if anterior is None or (anterior["aba"] != "esperando" and item["ultima_msg"] > anterior["ultima_msg"]):
                    por_tel[item["telefone"]] = item

    with open(saida, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CAMPOS)
        w.writeheader()
        w.writerows(por_tel.values())

    print(f"{len(por_tel)} conversas no CSV ({saida})")
    print("por aba:", dict(Counter(i["aba"] for i in por_tel.values())))
    print("por vendedor:", dict(Counter(i["vendedor"] or "(sem)" for i in por_tel.values()).most_common()))
    print("fora:", dict(fora))


if __name__ == "__main__":
    main()
