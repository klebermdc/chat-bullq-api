"""Gera os CSVs de carga do histórico Umbler (sem grupos) para COPY no Postgres.

Uso: python3 -I preparar_csv.py <pasta_backup>
Saída: <pasta>/carga/conversas.csv e <pasta>/carga/mensagens.csv
"""
import csv
import json
import os
import re
import sys

ONLY_CONTACT_TYPE = "DirectMessage"


def digits(raw):
    return re.sub(r"\D", "", raw or "")


def member_names(org):
    names = {}
    for m in org.get("organizationMembers") or []:
        label = m.get("name") or m.get("displayName") or m.get("emailAddress") or ""
        names[m["id"]] = label
    return names


def message_text(msg):
    file = msg.get("file") or {}
    parts = [msg.get("headerContent"), msg.get("content"), file.get("caption"), msg.get("footer")]
    text = "\n".join(p for p in parts if p)
    if not text and file.get("transcription"):
        text = f"[transcrição] {file['transcription']}"
    return text


def author(msg, names):
    if msg.get("source") == "Member":
        member = msg.get("sentByOrganizationMember") or {}
        return names.get(member.get("id"), "")
    if msg.get("source") == "Bot":
        return (msg.get("botInstance") or {}).get("botName") or "Bot"
    return ""


def write_conversas(base, out_dir, names):
    kept = {}
    path = os.path.join(out_dir, "conversas.csv")
    with open(os.path.join(base, "chats.jsonl"), encoding="utf-8") as src, \
            open(path, "w", newline="", encoding="utf-8") as dst:
        out = csv.writer(dst)
        out.writerow(["id", "telefone", "contato_nome", "canal_nome", "setor_nome",
                      "etiquetas", "atendentes", "criada_em", "ultima_msg_em"])
        for line in src:
            chat = json.loads(line)
            contact = chat.get("contact") or {}
            phone = digits(contact.get("phoneNumber"))
            if contact.get("contactType") != ONLY_CONTACT_TYPE or not phone or chat["id"] in kept:
                continue
            kept[chat["id"]] = phone
            tags = "{" + ",".join(json.dumps(t["name"], ensure_ascii=False) for t in contact.get("tags") or []) + "}"
            members = "{" + ",".join(json.dumps(names.get(m["id"], m["id"]), ensure_ascii=False)
                                     for m in chat.get("organizationMembers") or []) + "}"
            out.writerow([chat["id"], phone, contact.get("name") or "", (chat.get("channel") or {}).get("name") or "",
                          (chat.get("sector") or {}).get("name") or "", tags, members,
                          chat.get("createdAtUTC") or "", (chat.get("lastMessage") or {}).get("eventAtUTC") or ""])
    return kept


def write_mensagens(base, out_dir, names, kept):
    seen, total = set(), 0
    path = os.path.join(out_dir, "mensagens.csv")
    with open(os.path.join(base, "mensagens.jsonl"), encoding="utf-8") as src, \
            open(path, "w", newline="", encoding="utf-8") as dst:
        out = csv.writer(dst)
        out.writerow(["id", "conversa_id", "enviada_em", "origem", "tipo", "conteudo", "autor",
                      "arquivo_url", "arquivo_nome", "arquivo_tipo", "privada"])
        for line in src:
            msg = json.loads(line)
            chat_id = (msg.get("chat") or {}).get("id")
            if chat_id not in kept or msg["id"] in seen:
                continue
            seen.add(msg["id"])
            file = msg.get("file") or {}
            out.writerow([msg["id"], chat_id, msg["eventAtUTC"], msg.get("source") or "", msg.get("messageType") or "",
                          message_text(msg), author(msg, names), file.get("url") or "",
                          file.get("originalName") or "", file.get("contentType") or "",
                          "t" if msg.get("isPrivate") else "f"])
            total += 1
    return total


def main():
    base = sys.argv[1]
    out_dir = os.path.join(base, "carga")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(base, "organizacao.json"), encoding="utf-8") as fh:
        names = member_names(json.load(fh))
    kept = write_conversas(base, out_dir, names)
    total = write_mensagens(base, out_dir, names, kept)
    print(f"conversas: {len(kept)} | mensagens: {total}")


if __name__ == "__main__":
    main()
